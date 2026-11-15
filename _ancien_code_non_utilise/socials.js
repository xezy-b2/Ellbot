// src/social/pollers.js
import axios from 'axios';
import GuildConfig from './models/GuildConfig.js';
import { config } from './config.js';

// state caches
const twitchStatus = new Map();      // login -> { live: bool, title: string|null }
const youtubeLastIds = new Map();    // channelId -> last video id
const freebiesSeen = new Set();      // guid -> seen

// twitch token cache
let twitchToken = null;
let twitchTokenExpires = 0;

/**
 * Ensure we have a valid Twitch app token (client credentials flow).
 * Returns token string or null if twitch not configured.
 */
async function ensureTwitchToken() {
  const clientId = config?.social?.twitch?.clientId;
  const clientSecret = config?.social?.twitch?.clientSecret;
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (twitchToken && now < twitchTokenExpires) return twitchToken;

  try {
    const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      }
    });
    twitchToken = res.data.access_token;
    // expire a bit earlier than official expiry
    twitchTokenExpires = now + ((res.data.expires_in || 3600) - 60) * 1000;
    return twitchToken;
  } catch (e) {
    console.error('[ensureTwitchToken] failed', e?.response?.data || e?.message || e);
    return null;
  }
}

/**
 * Poll Twitch Helix for live streams of tracked users and notify guilds.
 * - Reads GuildConfig documents matching socials.twitch.enabled = true
 * - Batches up to 100 logins per Helix call
 * - When a login transitions offline->online, sends an embed with thumbnail
 */
async function pollTwitch(client) {
  try {
    const guilds = await GuildConfig.find({ 'socials.twitch.enabled': true }).lean();
    if (!guilds || !guilds.length) return;

    const token = await ensureTwitchToken();
    if (!token) {
      console.log('[pollTwitch] no twitch token available');
      return;
    }

    // collect unique tracked logins (lowercased)
    const uniqueLogins = [...new Set(
      guilds.flatMap(g => (g.socials?.twitch?.tracked || []).map(x => String(x || '').toLowerCase()))
      .filter(Boolean)
    )];

    if (!uniqueLogins.length) return;

    // process in batches of 100 (Helix supports multiple user_login params)
    for (let i = 0; i < uniqueLogins.length; i += 100) {
      const batch = uniqueLogins.slice(i, i + 100);

      let res;
      try {
        res = await axios.get('https://api.twitch.tv/helix/streams', {
          headers: {
            'Client-ID': config.social.twitch.clientId,
            'Authorization': `Bearer ${token}`
          },
          params: {
            user_login: batch
          },
          timeout: 15000
        });
      } catch (err) {
        console.error('[pollTwitch] helix streams fetch failed', err?.response?.data || err?.message || err);
        continue;
      }

      // map login -> stream object (or null)
      const liveMap = new Map(batch.map(l => [l, null]));
      for (const s of (res.data?.data || [])) {
        const login = String(s.user_login || s.user_login).toLowerCase();
        liveMap.set(login, s);
      }

      // iterate each login in this batch
      for (const login of batch) {
        try {
          const prev = twitchStatus.get(login) || { live: false, title: null };
          const wasLive = !!prev.live;
          const stream = liveMap.get(login) || null;
          const isLive = !!stream;

          // newly live -> notify guilds that track this login
          if (!wasLive && isLive && stream) {
            console.log('[pollTwitch] detected live for', login);

            // prepare stream fields
            const userName = stream.user_name || stream.user_login || login;
            const title = stream.title || 'Live Twitch';
            const viewers = stream.viewer_count ?? 0;
            const startedAt = stream.started_at ? new Date(stream.started_at) : new Date();
            let thumbnail = stream.thumbnail_url || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(login)}-{width}x{height}.jpg`;
            thumbnail = thumbnail.replace(/{width}/g, '1280').replace(/{height}/g, '720');
            // Ajoutez cette ligne pour éviter le problème de cache de Discord
            thumbnail += `?t=${Date.now()}`;

            // notify every guild that tracks this login
            for (const g of guilds) {
              try {
                const tracked = (g.socials?.twitch?.tracked || []).map(x => String(x || '').toLowerCase());
                if (!tracked.includes(login)) continue;

                const ch = client.guilds.cache.get(g.guildId)?.channels?.cache.get(g.socials.twitch.channelId);
                if (!ch) continue;
                if (!ch.isTextBased?.()) continue;

                const ping = g.socials.twitch.pingEveryone ? '@everyone ' : undefined;

                const embed = {
                  title: `🔴 ${userName} est en live — ${title}`,
                  url: `https://twitch.tv/${stream.user_login || login}`,
                  description: (g.socials.twitch?.message && g.socials.twitch.message.trim()) ? g.socials.twitch.message.trim() : `Regarde le stream de **${userName}** sur Twitch !`,
                  color: 0xE91916,
                  timestamp: startedAt,
                  fields: [
                    { name: 'Viewers', value: String(viewers), inline: true },
                    { name: 'Jeu', value: stream.game_name || '—', inline: true }
                  ],
                  image: { url: thumbnail }
                };

                // try sending embed, fallback to text if embed fails
                await ch.send({ content: ping || undefined, embeds: [embed] }).catch(async (err) => {
                  console.error('[pollTwitch] send embed failed, sending fallback text', err?.message || err);
                  try {
                    await ch.send({ content: `${ping || ''}🔴 **${userName}** est en live: ${title}\nhttps://twitch.tv/${stream.user_login || login}` }).catch(()=>{});
                  } catch {}
                });

              } catch (e) {
                console.error('[pollTwitch] notify error for guild', g.guildId, e?.message || e);
              }
            }
          }

          // update status map
          twitchStatus.set(login, { live: isLive, title: stream?.title || null });
        } catch (e) {
          console.error('[pollTwitch] per-login error', login, e?.message || e);
        }
      } // end for login
    } // end for batches
  } catch (e) {
    console.error('[pollTwitch] unexpected error', e?.message || e);
  }
}

/* ---------------- YouTube polling (RSS feeds) ---------------- */

function parseXml(text) {
  const entries = [];
  const itemRegex = /<entry>([\s\S]*?)<\/entry>/g;
  const get = (src, tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(src);
    return m ? m[1] : null;
  };
  let m;
  while ((m = itemRegex.exec(text))) {
    const e = m[1];
    entries.push({
      id: get(e,'id'),
      title: get(e,'title'),
      link: (get(e,'link')||'').match(/href="([^"]+)"/)?.[1] || null,
      published: get(e,'published')
    });
  }
  return entries;
}

async function pollYouTube(client) {
  try {
    const guilds = await GuildConfig.find({ 'socials.youtube.enabled': true }).lean();
    if (!guilds || !guilds.length) return;

    const ids = [...new Set(guilds.flatMap(g => g.socials?.youtube?.tracked || []))];
    if (!ids.length) return;

    for (const channelId of ids) {
      try {
        const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, { timeout: 10000 });
        const entries = parseXml(res.data);
        if (!entries || !entries.length) continue;
        const latest = entries[0];
        if (youtubeLastIds.get(channelId) === latest.id) continue;
        youtubeLastIds.set(channelId, latest.id);

        for (const g of guilds) {
          if (!(g.socials?.youtube?.tracked || []).includes(channelId)) continue;
          try {
            const ch = client.guilds.cache.get(g.guildId)?.channels?.cache.get(g.socials.youtube.channelId);
            if (!ch || !ch.isTextBased?.()) continue;
            const ping = g.socials.youtube.pingEveryone ? '@everyone ' : '';
            await ch.send({ content: `${ping}📺 Nouvelle vidéo/Live YouTube: **${latest.title}**\n${latest.link}` }).catch(()=>{});
          } catch (e) {
            console.error('[pollYouTube] notify error', g.guildId, e?.message || e);
          }
        }
      } catch (err) {
        // ignore problematic channels but log occasionally
        // console.warn('[pollYouTube] fetch failed for', channelId, err?.message || err);
      }
    }
  } catch (e) {
    console.error('[pollYouTube] unexpected error', e?.message || e);
  }
}

/* ---------------- Freebies / RSS polling ---------------- */

function parseRss(text) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const get = (src, tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(src);
    return m ? m[1] : null;
  };
  let m;
  while ((m = itemRegex.exec(text))) {
    const e = m[1];
    items.push({
      guid: get(e,'guid') || get(e,'link'),
      title: get(e,'title'),
      link: get(e,'link')
    });
  }
  return items;
}

async function pollFreebies(client) {
  try {
    const guilds = await GuildConfig.find({ 'socials.freebies.enabled': true }).lean();
    if (!guilds || !guilds.length) return;

    const feeds = new Set();
    for (const g of guilds) (g.socials?.freebies?.feeds || []).forEach(f => feeds.add(f));
    if (!feeds.size) return;

    for (const url of feeds) {
      try {
        const res = await axios.get(url, { timeout: 10000 });
        const items = parseRss(res.data);
        for (const item of items.slice(0, 5)) {
          if (!item.guid || freebiesSeen.has(item.guid)) continue;
          if (!/free|gratuit/i.test(item.title || '')) continue;
          freebiesSeen.add(item.guid);
          for (const g of guilds) {
            if (!g.socials?.freebies?.feeds?.includes(url)) continue;
            try {
              const ch = client.guilds.cache.get(g.guildId)?.channels?.cache.get(g.socials.freebies.channelId);
              if (!ch || !ch.isTextBased?.()) continue;
              const ping = g.socials.freebies.pingEveryone ? '@everyone ' : '';
              await ch.send({ content: `${ping}🎁 Offre gratuite détectée: **${item.title}**\n${item.link}` }).catch(()=>{});
            } catch (e) {
              console.error('[pollFreebies] notify error', g.guildId, e?.message || e);
            }
          }
        }
      } catch (err) {
        // ignore per-feed errors
      }
    }
  } catch (e) {
    console.error('[pollFreebies] unexpected error', e?.message || e);
  }
}

/* ---------------- Starter ---------------- */

export function startSocialPollers(client) {
  // initial immediate run (don't wait for first interval)
  pollTwitch(client).catch(()=>{});
  pollYouTube(client).catch(()=>{});
  pollFreebies(client).catch(()=>{});

  // intervals
  setInterval(() => pollTwitch(client).catch(()=>{}), 120_000);      // every 2 minutes
  setInterval(() => pollYouTube(client).catch(()=>{}), 300_000);     // every 5 minutes
  setInterval(() => pollFreebies(client).catch(()=>{}), 1_800_000);  // every 30 minutes
}

/* ---------------- Exports for testing/debugging ---------------- */
export {
  twitchStatus,
  youtubeLastIds,
  freebiesSeen,
  ensureTwitchToken,
  pollTwitch,
  pollYouTube,
  pollFreebies
};
