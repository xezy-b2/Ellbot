import GuildConfig from '../models/GuildConfig.js';
import { EmbedBuilder } from 'discord.js';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from '../paths.js';

const LOG = (...a) => console.log('[TWITCH]', ...a);

const TWITCH_API_URL = 'https://api.twitch.tv/helix';
const CACHE_FILE = path.join(DATA_DIR, 'twitch_cache.json');
const LIMIT_FILE = path.join(DATA_DIR, 'twitch_limits.json');
const TOKEN_CACHE = {
    accessToken: null,
    expiresAt: 0,
};

const MAX_NOTIFICATIONS_PER_DAY = 5;
const TWITCH_API_BATCH_SIZE = 100; // Limite de l'API Twitch par requête

let limits = {};
let streamCache = {};
let isRunning = false; // Verrou anti-exécution parallèle

// ─── Persistance ──────────────────────────────────────────────────────────────

async function loadData(file) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        if (e.code !== 'ENOENT') {
            LOG(`Erreur lors du chargement de ${file}: ${e.message}`);
        }
        return {};
    }
}

async function saveData(file, data) {
    try {
        await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        LOG(`Erreur lors de la sauvegarde dans ${file}: ${e.message}`);
    }
}

// ─── Limite de notifications ───────────────────────────────────────────────────

/**
 * Vérifie si une notification peut être envoyée pour un streamer.
 * N'incrémente le compteur QUE si la notification sera réellement envoyée.
 * Retourne true si on peut notifier, false sinon.
 */
function canNotify(username) {
    const today = new Date().toISOString().split('T')[0];

    if (!limits[username] || limits[username].date !== today) {
        limits[username] = { count: 0, date: today };
    }

    if (limits[username].count >= MAX_NOTIFICATIONS_PER_DAY) {
        LOG(`Limite atteinte pour '${username}' (${limits[username].count}/${MAX_NOTIFICATIONS_PER_DAY}).`);
        return false;
    }

    return true;
}

function incrementNotifyCount(username) {
    limits[username].count++;
}

// ─── API Twitch ────────────────────────────────────────────────────────────────

async function getAccessToken(clientId, clientSecret) {
    if (TOKEN_CACHE.accessToken && TOKEN_CACHE.expiresAt > Date.now()) {
        return TOKEN_CACHE.accessToken;
    }

    try {
        const response = await axios.post(
            `https://id.twitch.tv/oauth2/token`,
            null,
            { params: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' } }
        );
        const { access_token, expires_in } = response.data;
        TOKEN_CACHE.accessToken = access_token;
        TOKEN_CACHE.expiresAt = Date.now() + (expires_in - 300) * 1000;
        LOG('Nouveau token Twitch récupéré.');
        return access_token;
    } catch (e) {
        LOG(`Erreur token Twitch: ${e.response?.data?.message ?? e.message}`);
        return null;
    }
}

async function fetchTwitchAPI(endpoint, clientId, accessToken) {
    try {
        const response = await axios.get(`${TWITCH_API_URL}/${endpoint}`, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        return response.data;
    } catch (e) {
        LOG(`Erreur API Twitch [${endpoint}]: ${e.response?.data?.message ?? e.message}`);
        return null;
    }
}

/**
 * Découpe un tableau en lots de `size` et effectue plusieurs requêtes si nécessaire.
 * Concatène tous les résultats dans un seul tableau.
 */
async function fetchTwitchAPIBatched(buildEndpoint, items, clientId, accessToken) {
    const results = [];
    for (let i = 0; i < items.length; i += TWITCH_API_BATCH_SIZE) {
        const batch = items.slice(i, i + TWITCH_API_BATCH_SIZE);
        const data = await fetchTwitchAPI(buildEndpoint(batch), clientId, accessToken);
        if (data?.data) results.push(...data.data);
    }
    return results;
}

// ─── Logique principale ────────────────────────────────────────────────────────

async function getStreamStatus(client, config) {
    if (isRunning) {
        LOG('Cycle précédent toujours en cours, skip.');
        return;
    }
    isRunning = true;

    const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = config;

    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
        LOG('Variables TWITCH_CLIENT_ID ou TWITCH_CLIENT_SECRET manquantes.');
        isRunning = false;
        return;
    }

    const accessToken = await getAccessToken(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
    if (!accessToken) {
        isRunning = false;
        return;
    }

    try {
        const guildConfigs = await GuildConfig.find({
            'social.twitch.enabled': true,
            'social.twitch.channelId': { $exists: true, $ne: null },
            'social.twitch.usernames': { $exists: true, $not: { $size: 0 } },
        }).lean();

        if (guildConfigs.length === 0) {
            LOG('Aucune guilde avec Twitch activé.');
            return;
        }

        // Dédupliquer tous les usernames en minuscules
        const allUsernames = [
            ...new Set(
                guildConfigs
                    .flatMap(gc => gc.social.twitch.usernames.map(u => String(u || '').trim().toLowerCase()))
                    // un nom vide (virgule en trop) faisait échouer toute la requête Twitch
                    .filter(u => /^[a-z0-9_]{3,25}$/.test(u))
            ),
        ];

        if (allUsernames.length === 0) {
            LOG('Aucun streamer à surveiller.');
            return;
        }

        // Récupérer les infos utilisateurs par lots
        const usersData = await fetchTwitchAPIBatched(
            batch => `users?login=${batch.join('&login=')}`,
            allUsernames,
            TWITCH_CLIENT_ID,
            accessToken
        );

        if (usersData.length === 0) {
            LOG('Aucun utilisateur Twitch trouvé.');
            return;
        }

        const userIdToInfo = new Map(usersData.map(u => [u.id, u]));
        const loginToInfo = new Map(usersData.map(u => [u.login.toLowerCase(), u]));
        const userIds = usersData.map(u => u.id);

        // Récupérer les streams actifs par lots
        const streamsData = await fetchTwitchAPIBatched(
            batch => `streams?user_id=${batch.join('&user_id=')}`,
            userIds,
            TWITCH_CLIENT_ID,
            accessToken
        );

        const liveStreamMap = new Map(streamsData.map(s => [s.user_id, s]));

        // Traiter chaque streamer
        for (const username of allUsernames) {
            const userInfo = loginToInfo.get(username);
            if (!userInfo) {
                LOG(`Streamer introuvable sur Twitch : '${username}'`);
                continue;
            }

            const streamInfo = liveStreamMap.get(userInfo.id);
            const isLive = !!streamInfo;

            if (isLive) {
                const cachedStreamId = streamCache[username]?.streamId;

                // Nouveau stream (ou premier démarrage)
                if (cachedStreamId !== streamInfo.id) {
                    if (!canNotify(username)) continue;

                    // Guildes concernées par ce streamer
                    const relevantGuilds = guildConfigs.filter(gc =>
                        gc.social.twitch.usernames.map(u => u.toLowerCase()).includes(username)
                    );

                    let atLeastOneSent = false;

                    for (const gc of relevantGuilds) {
                        const channel = await client.channels.fetch(gc.social.twitch.channelId).catch(() => null);
                        if (!channel) {
                            LOG(`Canal introuvable pour la guilde ${gc.guildId}`);
                            continue;
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(`🔴 ${streamInfo.user_name} est en direct sur Twitch !`)
                            .setURL(`https://twitch.tv/${username}`)
                            .setDescription(`**${streamInfo.title || 'Sans titre'}**`)
                            .addFields(
                                { name: 'Jeu', value: streamInfo.game_name || 'Non spécifié', inline: true },
                                { name: 'Spectateurs', value: streamInfo.viewer_count.toString(), inline: true }
                            )
                            .setThumbnail(userInfo.profile_image_url || null);
                        if (streamInfo.thumbnail_url) {
                            embed.setImage(
                                streamInfo.thumbnail_url.replace('{width}x{height}', '1280x720') +
                                `?t=${Date.now()}`
                            );
                        }

                        if (/^#[0-9a-fA-F]{6}$/.test(gc.social.twitch.embedColor || '')) {
                            embed.setColor(gc.social.twitch.embedColor);
                        }

                        let messageContent = gc.social.twitch.pingEveryone ? '@everyone' : '';
                        if (gc.social.twitch.message) {
                            messageContent += (messageContent ? '\n' : '') + gc.social.twitch.message;
                        }

                        try {
                            await channel.send({
                                content: messageContent || undefined,
                                embeds: [embed],
                                allowedMentions: { parse: gc.social.twitch.pingEveryone ? ['everyone'] : [] },
                            });
                            atLeastOneSent = true;
                            LOG(`Notification envoyée → guilde ${gc.guildId} pour '${username}'`);
                        } catch (err) {
                            LOG(`Erreur d'envoi → guilde ${gc.guildId}: ${err.message}`);
                        }
                    }

                    // On ne met à jour cache/limits qu'après avoir effectivement notifié
                    if (atLeastOneSent) {
                        incrementNotifyCount(username);
                        streamCache[username] = { streamId: streamInfo.id };
                        await saveData(CACHE_FILE, streamCache);
                        await saveData(LIMIT_FILE, limits);
                    }
                }
            } else {
                // Stream terminé → on purge le cache
                if (streamCache[username]) {
                    LOG(`'${username}' est hors ligne. Nettoyage du cache.`);
                    delete streamCache[username];
                    await saveData(CACHE_FILE, streamCache);
                }
            }
        }
    } catch (e) {
        LOG(`Erreur générale dans getStreamStatus: ${e.message}`);
    } finally {
        isRunning = false;
    }
}

// ─── Point d'entrée ────────────────────────────────────────────────────────────

let started = false;

export async function runTwitchNotifier(client) {
    // Sécurité : un seul intervalle, même si la fonction est rappelée
    if (started) return;
    started = true;
    LOG('Démarrage du notificateur Twitch...');

    // Chargement initial des données persistées
    [limits, streamCache] = await Promise.all([loadData(LIMIT_FILE), loadData(CACHE_FILE)]);

    // Premier check immédiat (awaité pour voir les erreurs)
    await getStreamStatus(client, process.env);

    // Puis toutes les 2 minutes
    setInterval(() => getStreamStatus(client, process.env), 2 * 60 * 1000);
}