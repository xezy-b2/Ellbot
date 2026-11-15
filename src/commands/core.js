// src/commands/core.js
import { 
    InteractionType, AttachmentBuilder, EmbedBuilder, PermissionsBitField, UserFlags, 
    ChannelType, time, 
    // Imports pour les Modals
    ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle,
    // Imports pour les Boutons de Preview
    ButtonBuilder, ButtonStyle,
    MessageFlags
} from 'discord.js';
import { levelFromXP } from '../utils/xp.js';
import UserXP from '../models/UserXP.js';
import GuildConfig from '../models/GuildConfig.js';
import generateRankCard from '../utils/generateRankCard.js';
import { postReactionRolePanel } from '../features/reactionRoles.js';
import { composeWelcomeImageEx, resolveImageSrc } from '../utils/imageComposer.js';
import generateLeaderboardCard from '../utils/generateLeaderboardCard.js';

// Anti-abus /rep : un même membre ne peut noter la même personne qu'une fois toutes les 12 h
const REP_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const repCooldowns = new Map(); // "giverId:targetId" -> timestamp

// Convertit "#FF0000" / "ff0000" en entier, sinon valeur par défaut
function parseHexColor(input, fallback = 0x0099ff) {
    const m = String(input || '').trim().match(/^#?([0-9A-Fa-f]{6})$/);
    return m ? parseInt(m[1], 16) : fallback;
}

const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim());

const LOG = (...a) => console.log('[CORE]', ...a);

// ⭐ Cache en mémoire pour stocker les données d'embed temporairement
// Map<cacheKey: string, data: object>
const embedDataCache = new Map();

// ------------------------------------------------------------------
// Constantes des Badges Discord
// ------------------------------------------------------------------
const userBadges = {
    // Discord Staff
    DiscordEmployee: '🛠️', 
    
    // Partenaires et Développeurs
    PartneredServerOwner: '<:discord_partner:123456789012345678>', 
    ActiveDeveloper: '<:discordactivedeveloperbadge:1422607220796817519>', 
    
    // HypeSquad
    HypeSquadEvents: '<:hypesquad_events:123456789012345678>',  
    HypeSquadOnlineHouse1: '<:bravery:123456789012345678>',  
    HypeSquadOnlineHouse2: '<:brilliance:123456789012345678>', 
    HypeSquadOnlineHouse3: '<:balance:123456789012345678>',  
    
    // Bug Hunters
    BugHunterLevel1: '<:bug_hunter_level_1:123456789012345678>',
    BugHunterLevel2: '🐞', 
    
    // Autres
    PremiumEarlySupporter: '<:early_supporter:123456789012345678>', 
    CertifiedModerator: '<:certified_moderator:123456789012345678>', 
    PremiumSubscriber: '💎',

    // Drapeaux généralement invisibles ou non pertinents à afficher
    TeamUser: '', 
    BotHTTPInteractions: '',
};

const catGifs = [
    'https://media.giphy.com/media/JIX9t2Cw0O9WMTCCIk/giphy.gif', // Cat working
    'https://media.giphy.com/media/VbnUQpnihPSIgIXuZv/giphy.gif', // Cat wave
    'https://media.giphy.com/media/mlvseq9yvZhAH4B6Ks/giphy.gif', // Cat sleeping
    'https://media.giphy.com/media/jpUW0pQ2R2y0I/giphy.gif', // Cat hug
    'https://media.giphy.com/media/vFKQLsJzT8t6M/giphy.gif', // Cat typing
    'https://media.giphy.com/media/BCu4w2R4dJ7Hq/giphy.gif', // Cat angry
    'https://media.giphy.com/media/CqVNwqzW6LgQ0/giphy.gif', // Cat stretching
    'https://media.giphy.com/media/2FazA2XbWv21m/giphy.gif', // Cat funny face
];

// ------------------------------------------------------------------
// ⭐ FONCTION UTILITAIRE : Créer le Modal (réutilisé pour l'édition)
function createEmbedCreatorModal(channelId, initialValues = {}) {
    const modal = new ModalBuilder()
        .setCustomId(`embedCreatorModal_${channelId}`) 
        .setTitle('Créateur d\'Embed Avancé');

    const titleInput = new TextInputBuilder()
        .setCustomId('titleInput')
        .setLabel('Titre de l\'embed')
        .setPlaceholder('Quel titre souhaitez-vous donner à votre embed ? (Optionnel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false) 
        .setMaxLength(256)
        .setValue(initialValues.title || '');

    const descriptionInput = new TextInputBuilder()
        .setCustomId('descriptionInput')
        .setLabel('Description de l\'embed')
        .setPlaceholder('Quelle description souhaitez-vous donner à votre embed ? (Obligatoire)')
        .setStyle(TextInputStyle.Paragraph) 
        .setRequired(true) 
        .setMaxLength(4000)
        .setValue(initialValues.description || '');

    const footerInput = new TextInputBuilder()
        .setCustomId('footerInput')
        .setLabel('Footer de l\'embed')
        .setPlaceholder('Texte de pied de page (Optionnel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(2048)
        .setValue(initialValues.footerText || '');
        
    const colorInput = new TextInputBuilder()
        .setCustomId('colorInput')
        .setLabel('Couleur de l\'embed (ex: #FF0000)')
        .setPlaceholder('Laisser vide pour la couleur par défaut (Optionnel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7)
        .setValue(initialValues.colorOption || '');

    const imageInput = new TextInputBuilder()
        .setCustomId('imageInput')
        .setLabel('Image principale (URL)')
        .setPlaceholder('Lien vers l\'image principale (Optionnel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(initialValues.imageUrl || '');

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(footerInput),
        new ActionRowBuilder().addComponents(colorInput),
        new ActionRowBuilder().addComponents(imageInput),
    );
    return modal;
}


// ⭐ FONCTION UTILITAIRE : Convertit les champs en Embed et données JSON
function createEmbedAndData(interaction) {
    const channelId = interaction.customId.split('_')[1];
    
    // Récupérer les valeurs des champs
    const title = interaction.fields.getTextInputValue('titleInput') || '';
    const description = interaction.fields.getTextInputValue('descriptionInput') || '';
    const footerText = interaction.fields.getTextInputValue('footerInput') || '';
    const colorOption = interaction.fields.getTextInputValue('colorInput') || '';
    const imageUrl = interaction.fields.getTextInputValue('imageInput') || '';

    // Validation et conversion robuste de la couleur
    let color = 0x0099ff; 
    let colorHex = colorOption; 
    
    if (colorOption) {
        const hexMatch = colorOption.match(/^#?([0-9A-Fa-f]{6})$/);
        
        if (hexMatch) {
            color = parseInt(hexMatch[1], 16);
            colorHex = `#${hexMatch[1].toUpperCase()}`;
        } else {
            colorHex = ''; 
            color = 0x0099ff;
        }
    }
    
    if (!description) {
         throw new Error('La description est obligatoire.');
    }

    const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(color); 

    if (title) embed.setTitle(title);
    if (footerText) embed.setFooter({ text: footerText });
    if (imageUrl) {
        if (!isHttpUrl(imageUrl)) throw new Error("L'URL de l'image doit commencer par http(s)://");
        embed.setImage(imageUrl);
    }

    return {
        embed,
        // Données sérialisées
        data: {
            c: channelId,   // Channel ID
            t: title,       // Title
            d: description, // Description
            f: footerText,  // Footer Text (texte du footer propre)
            x: colorHex,    // Color Hex (pour l'édition)
            i: imageUrl,    // Image URL
        }
    };
}


// ------------------------------------------------------------------
// ⭐ FONCTION POUR TRAITER LA SOUMISSION DU MODAL (PREVIEW) - STRATÉGIE CACHE
async function handleEmbedCreatorModalSubmit(interaction) {
    LOG('Tentative de traitement du Modal [handleEmbedCreatorModalSubmit]...'); 
    
    try {
        const { embed, data } = createEmbedAndData(interaction);
        
        const userId = interaction.user.id; 
        
        // 1. Générer une clé unique pour le cache (e.g., timestamp + user ID)
        // La clé doit inclure le User ID pour la vérification ultérieure
        const cacheKey = `${Date.now()}_${userId}`;
        
        // 2. Stocker les données dans le cache
        embedDataCache.set(cacheKey, data);
        
        // 3. Définir un délai d'expiration pour le cache (e.g., 10 minutes)
        // Ceci est important pour éviter les fuites de mémoire.
        setTimeout(() => {
            embedDataCache.delete(cacheKey);
            LOG(`Données d'embed expirées et retirées du cache pour la clé: ${cacheKey}`);
        }, 10 * 60 * 1000); // 10 minutes

        // Crée les boutons pour la prévisualisation, en utilisant la clé de cache
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`embed-edit-preview_${cacheKey}`) // Inclut la clé de cache
                    .setLabel('Modifier')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setCustomId(`embed-send-preview_${cacheKey}`) // Inclut la clé de cache
                    .setLabel('Envoyer Définitivement')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🚀')
            );

        // Pas de tag secret dans l'embed/content !
        
        const previewContent = `**Aperçu de l'Embed pour le canal <#${data.c}> :**\n*(Ce message et les données de modification expireront dans 10 minutes.)*`;
        
        await interaction.reply({ 
            content: previewContent,
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral });

    } catch (e) {
        LOG('Erreur dans le Modal Submit (Preview/Création):', e);
        
        const errorContent = e.message.includes('description') ?
             '❌ La description de l\'embed est obligatoire.' :
             e.message.includes('URL') ? `❌ ${e.message}` :
             '❌ Une erreur est survenue lors de la création de l\'aperçu.';
        
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ flags: MessageFlags.Ephemeral, content: errorContent });
        } else {
             await interaction.editReply({ content: errorContent });
        }
    }
}
// ------------------------------------------------------------------


// ------------------------------------------------------------------
// ⭐ FONCTION : Gérer les interactions de boutons de l'Embed Creator - LECTURE VIA CACHE
async function handleEmbedCreatorButtonInteraction(interaction) {
    
    // 1. Déterminer l'action et la clé de cache
    // Utilise la regex pour s'assurer que le reste du customId est la clé
    const [action, cacheKey] = interaction.customId.split(/_(.+)/); 

    if (!cacheKey) {
        // C'est une erreur critique, mais on ne peut pas deferUpdate/editReply ici, il faut reply
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Erreur de données: La clé de cache est manquante. Veuillez relancer la commande `/embed-modal`.' });
    }
    
    const data = embedDataCache.get(cacheKey);

    if (!data) {
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Erreur de données: Les données de l\'embed ont expiré ou sont introuvables. Veuillez relancer la commande `/embed-modal`.' });
    }
    
    // Vérification de l'auteur
    const userIdFromCacheKey = cacheKey.split('_').pop(); 
    const isAuthor = interaction.user.id === userIdFromCacheKey;
    
    if (!isAuthor) {
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Seul l\'auteur de la commande peut interagir avec ces boutons.' });
    }
    
    // -----------------------------------------------------------
    // CAS 1: Modification (showModal) - Réponse INITIALE
    // -----------------------------------------------------------
    if (action === 'embed-edit-preview') { 
        try {
            // Utilise les données récupérées du cache pour pré-remplir le modal
            const modal = createEmbedCreatorModal(data.c, {
                title: data.t, description: data.d, footerText: data.f, colorOption: data.x, imageUrl: data.i,
            });
            // showModal est une réponse initiale valide. Ne PAS appeler deferUpdate avant.
            await interaction.showModal(modal); 
            return;
        } catch (e) {
            console.error('[CORE] Erreur lors de l\'affichage du Modal d\'édition:', e);
            // Si showModal échoue, on doit utiliser une réponse de secours
            if (!interaction.replied && !interaction.deferred) {
                 return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Une erreur est survenue lors de l\'ouverture du formulaire d\'édition.' });
            }
        }
    }

    // -----------------------------------------------------------
    // CAS 2: Envoi (send) - Nécessite un defer/editReply car l'envoi est asynchrone
    // -----------------------------------------------------------
    if (action === 'embed-send-preview') {
        
        // Tente de deferUpdate D'ABORD pour répondre dans les 3 secondes.
        try {
            await interaction.deferUpdate();
        } catch (e) {
            console.error('[CORE] ECHEC DU DEFER IMMÉDIAT (Échec de l\'interaction côté Discord):', e.message);
            // Si le defer échoue, on ne peut pas continuer.
            return; 
        }

        try {
            const targetChannel = interaction.guild.channels.cache.get(data.c);
            if (!targetChannel || !targetChannel.isTextBased()) {
                embedDataCache.delete(cacheKey); 
                return interaction.editReply({ content: '❌ Salon de destination introuvable ou invalide. Les données ont été supprimées du cache.' });
            }

            const color = parseHexColor(data.x);
            
            // Construit l'embed FINAL avec les données propres
            const embedToSend = new EmbedBuilder().setDescription(data.d).setColor(color);
            if (data.t) embedToSend.setTitle(data.t);
            if (data.f) embedToSend.setFooter({ text: data.f }); 
            if (data.i) embedToSend.setImage(data.i);

            // Vérification des permissions
            const botPermissions = targetChannel.permissionsFor(interaction.client.user);
            if (!botPermissions.has(PermissionsBitField.Flags.SendMessages) || !botPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
                embedDataCache.delete(cacheKey);
                return interaction.editReply({ content: `❌ Le bot n'a pas la permission d'envoyer des messages ou d'intégrer des liens/embeds dans le salon ${targetChannel}.`, components: [], });
            }

            await targetChannel.send({ embeds: [embedToSend] });
            
            // Nettoyage final du cache après envoi réussi
            embedDataCache.delete(cacheKey);
            
            // Met à jour le message de prévisualisation en succès
            await interaction.editReply({ 
                content: `✅ Embed envoyé avec succès dans ${targetChannel} !\n*(Le message de prévisualisation est maintenant terminé.)*`, 
                embeds: [embedToSend],
                components: [] 
            });
            
        } catch (e) {
            console.error('[CORE] Erreur lors de l\'envoi de l\'embed (après defer):', e);
            // Important : Supprimer le cache même en cas d'erreur ici.
            embedDataCache.delete(cacheKey);
            
            // On utilise editReply car nous avons déjà deferUpdate
            await interaction.editReply({ content: '❌ Une erreur est survenue lors de l\'envoi de l\'embed. Veuillez réessayer ou vérifier les permissions.', components: [] });
        }
    }
}
// ------------------------------------------------------------------


export async function handleCoreInteraction(interaction) {
  
    // ⭐ Gérer la soumission de Modal 
    if (interaction.type === InteractionType.ModalSubmit) {
        // Redirection vers le gestionnaire de Modal
        if (interaction.customId.startsWith('embedCreatorModal_')) {
            await handleEmbedCreatorModalSubmit(interaction);
            return; 
        }
        return;
    }
    
    // ⭐ Gérer les interactions de boutons de l'embed creator 
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('embed-edit-preview_') || interaction.customId.startsWith('embed-send-preview_')) {
            await handleEmbedCreatorButtonInteraction(interaction);
            return;
        }
    }
    
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    const { commandName } = interaction;

    try {
        switch (commandName) {
            
            case 'help': {
                const embed = new EmbedBuilder()
                    .setTitle('Commandes principales')
                    .setDescription(`Voici la liste des commandes principales que tu peux utiliser.`)
                    .setColor(0x0099ff)
                    .addFields(
                        { name: '/help', value: 'Affiche la liste des commandes.' },
                        { name: '/ping', value: 'Vérifie si le bot est en ligne.' },
                        { name: '/server', value: 'Affiche les informations sur le serveur.' },
                        { name: '/user [membre]', value: 'Affiche les informations sur un utilisateur.' },
                        { name: '/rank [membre]', value: 'Affiche ton niveau et ton XP.' },
                        { name: '/top', value: 'Affiche le classement des membres (par XP total).' },
                        { name: '/classement', value: 'Affiche le classement mensuel (par messages).' },
                        { name: '/say [message]', value: 'Fait dire quelque chose au bot dans le salon actuel.' },
                        { name: '/embed [titre] [description]', value: 'Envoie un embed personnalisé.' },
                        { name: '/embed-modal', value: 'Ouvre un formulaire pour créer un embed avancé.' }, 
                        { name: '/xp-add [membre] [montant]', value: 'Ajoute de l\'XP à un membre (admin).' },
                        { name: '/xp-set [membre] [montant]', value: 'Définit l\'XP d\'un membre (admin).' },
                        { name: '/xp-simulate [membre] [points]', value: 'Simule l\'ajout d\'XP sur la carte de rang.' },
                        { name: '/xp-role-rewards', value: 'Affiche la liste des rôles de récompense par niveau.' },
                    )
                    .setFooter({ text: 'Voir les commandes de modération pour plus de commandes.' });
                    
                await interaction.reply({ embeds: [embed] });
                break;
            }
                
            case 'ping': {
                await interaction.reply({ content: `Pong! Latence: ${interaction.client.ws.ping}ms`, flags: MessageFlags.Ephemeral });
                break;
            }

            case 'server': {
                const guild = interaction.guild;
                const owner = await guild.fetchOwner();

                const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`Informations sur ${guild.name}`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: 'Propriétaire', value: owner.user.tag, inline: true },
                    { name: 'Membres', value: guild.memberCount.toString(), inline: true },
                    { name: 'Salons', value: guild.channels.cache.size.toString(), inline: true },
                    { name: 'Date de création', value: time(guild.createdAt, 'F'), inline: false }
                )
                .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
                break;
            }
            
case 'cat-gif': {
                await interaction.deferReply(); // Répond immédiatement pour éviter l'expiration
                
                try {
                    // Requête à The Cat API pour un GIF aléatoire
                    const response = await fetch('https://api.thecatapi.com/v1/images/search?mime_types=gif');
                    
                    if (!response.ok) {
                        throw new Error(`Erreur API: ${response.statusText}`);
                    }
                    
                    const data = await response.json();
                    
                    if (!data || data.length === 0 || !data[0].url) {
                        return interaction.editReply({ 
                            content: '❌ L\'API n\'a pas renvoyé de GIF de chat valide. Réessayez.' 
                        });
                    }
                    
                    const catGifUrl = data[0].url;
                    
                    // Envoie directement le lien du GIF
                    await interaction.editReply({ 
                        content: `🐈 Miaou ! Voici un GIF de chat pour toi !\n${catGifUrl}` 
                    });

                } catch (e) {
                    LOG('Erreur lors de la récupération du GIF de chat via API:', e);
                    await interaction.editReply({ 
                        content: '❌ Une erreur est survenue lors de la connexion à l\'API des chats. Essayez plus tard.' 
                    });
                }
                break;
            }

case 'pfc': {
    const opponent = interaction.options.getUser('adversaire');
    const author = interaction.user;

    if (opponent.id === author.id) {
        return interaction.reply({ content: "Vous ne pouvez pas jouer contre vous-même !", flags: MessageFlags.Ephemeral });
    }
    if (opponent.bot) {
        return interaction.reply({ content: "Les bots sont trop forts pour vous, choisissez un humain !", flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
        .setTitle('🎮 Défi Pierre-Feuille-Ciseaux')
        .setDescription(`${author} défie ${opponent} !\n\n**Appuyez sur un bouton pour faire votre choix.**`)
        .setColor(0x0099ff)
        .setFooter({ text: 'Le jeu expire dans 30 secondes.' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pfc_pierre').setLabel('Pierre').setEmoji('🪨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('pfc_feuille').setLabel('Feuille').setEmoji('📄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('pfc_ciseaux').setLabel('Ciseaux').setEmoji('✂️').setStyle(ButtonStyle.Primary),
    );

    const response = await interaction.reply({ 
        content: `${opponent}, vous avez été défié !`, 
        embeds: [embed], 
        components: [row] 
    });

    // Stockage temporaire des choix
    const choices = new Map();
    const emojis = { pierre: '🪨', feuille: '📄', ciseaux: '✂️' };

    const filter = i => (i.user.id === author.id || i.user.id === opponent.id) && i.customId.startsWith('pfc_');
    const collector = response.createMessageComponentCollector({ filter, time: 30000 });

    collector.on('collect', async i => {
        const choice = i.customId.split('_')[1];
        
        if (choices.has(i.user.id)) {
            return i.reply({ content: "Vous avez déjà fait votre choix !", flags: MessageFlags.Ephemeral });
        }

        choices.set(i.user.id, choice);
        await i.reply({ content: `Tu as choisi ${emojis[choice]} ! En attente de l'autre joueur...`, flags: MessageFlags.Ephemeral });

        if (choices.size === 2) {
            collector.stop('finished');
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && choices.size < 2) {
            return interaction.editReply({ content: "Le temps est écoulé ! Le duel est annulé.", components: [], embeds: [] });
        }

        if (reason === 'finished') {
            const authorChoice = choices.get(author.id);
            const opponentChoice = choices.get(opponent.id);

            let result = "";
            if (authorChoice === opponentChoice) {
                result = "🤝 **Égalité !**";
            } else if (
                (authorChoice === 'pierre' && opponentChoice === 'ciseaux') ||
                (authorChoice === 'feuille' && opponentChoice === 'pierre') ||
                (authorChoice === 'ciseaux' && opponentChoice === 'feuille')
            ) {
                result = `🏆 **${author.username} gagne !**`;
            } else {
                result = `🏆 **${opponent.username} gagne !**`;
            }

            const finalEmbed = new EmbedBuilder()
                .setTitle('🏁 Résultats du Duel')
                .addFields(
                    { name: author.username, value: emojis[authorChoice], inline: true },
                    { name: 'VS', value: '⚡', inline: true },
                    { name: opponent.username, value: emojis[opponentChoice], inline: true }
                )
                .setDescription(result)
                .setColor(0x2ecc71);

            await interaction.editReply({ content: 'Duel terminé !', embeds: [finalEmbed], components: [] });
        }
    });
    break;
}

            case 'user': {
                const target = interaction.options.getUser('membre') || interaction.user;
                const fetchedUser = await interaction.client.users.fetch(target.id, { force: true });
                const member = interaction.guild.members.cache.get(fetchedUser.id);

                const userXP = await UserXP.findOne({ guildId: interaction.guild.id, userId: target.id }).lean();
                const reputationCount = userXP?.reputation || 0; 
                if (!member) {
                    return interaction.reply({ content: 'Impossible de trouver ce membre sur le serveur ou le membre a quitté le serveur.', flags: MessageFlags.Ephemeral });
                }

                const roles = member.roles.cache
                    .filter(role => role.name !== '@everyone')
                    .map(role => role.toString())
                    .join(', ') || 'Aucun rôle';

                let badges = fetchedUser.flags?.toArray()
                    .filter(flag => userBadges[flag]) 
                    .map(flag => userBadges[flag])
                    .join(' ') || '';

                if (member.premiumSince) {
                    badges = `${badges} ${'<:discordboost3:1422610262661402826> '}`; 
                }
                
                badges = badges.trim() || 'Aucun badge';

                const embed = new EmbedBuilder()
                    .setColor(member.displayHexColor || 0x0099ff)
                    .setTitle(`Informations pour ${fetchedUser.username}`)
                    .setAuthor({ name: fetchedUser.username, iconURL: fetchedUser.displayAvatarURL({ dynamic: true }) })
                    .setThumbnail(fetchedUser.displayAvatarURL({ dynamic: true }) || null)
                    .addFields(
                        { name: 'Nom d\'utilisateur', value: `${fetchedUser.username}`, inline: true },
                        { name: 'ID', value: `${fetchedUser.id}`, inline: true },
                        { name: 'Réputation (Trades)', value: `✨ **${reputationCount}** points`, inline: true },
                        { name: 'Badges', value: badges, inline: false },
                        { name: 'Rôles', value: roles, inline: false },
                        {
                            name: 'A rejoint le serveur',
                            value: `${time(member.joinedAt, 'F')} (${time(member.joinedAt, 'R')})`,
                            inline: true,
                        },
                        {
                            name: 'Compte créé',
                            value: `${time(fetchedUser.createdAt, 'F')} (${time(fetchedUser.createdAt, 'R')})`,
                            inline: true,
                        }
                    )
                    .setTimestamp()
                    .setFooter({ text: `ID: ${fetchedUser.id}` });

                await interaction.reply({ embeds: [embed] });
                break;
            }
            
            case 'rank': {
                await interaction.deferReply();
                const target = interaction.options.getUser('membre') || interaction.user;
                const guildId = interaction.guild.id;

                const userXP = await UserXP.findOne({ guildId, userId: target.id }).lean();
                const guildConfig = await GuildConfig.findOne({ guildId }).lean();

                if (!userXP) {
                    return interaction.editReply({ content: `**${target.tag || target.username}** n'a pas encore de données d'XP.`, });
                }

                // Vrai rang (avant : "#1" écrit en dur pour tout le monde)
                const rank = 1 + await UserXP.countDocuments({ guildId, xp: { $gt: userXP.xp || 0 } });
                const rankCard = await generateRankCard(target, userXP, { guildConfig, rank });
                const file = new AttachmentBuilder(rankCard, { name: 'rank-card.png' });

                await interaction.editReply({ files: [file] });
                break;
            }

            case 'top': {
                await interaction.deferReply();
                
                const topUsers = await UserXP.find({ guildId: interaction.guild.id })
                    .sort({ xp: -1 }) 
                    .limit(10)
                    .lean();

                if (topUsers.length === 0) {
                    return interaction.editReply({ content: 'Aucune donnée d\'XP trouvée pour ce serveur.', });
                }

                const imageBuffer = await generateLeaderboardCard(
                    interaction.client, 
                    topUsers, 
                    'Classement XP Général', 
                    'xp' 
                ); 
                const file = new AttachmentBuilder(imageBuffer, { name: 'leaderboard-xp.png' });

                await interaction.editReply({ files: [file] });
                break;
            }
            
            case 'classement': {
                await interaction.deferReply();
                
                const topUsers = await UserXP.find({ guildId: interaction.guildId })
                    .sort({ monthlyMessages: -1 }) 
                    .limit(10)
                    .lean();

                if (topUsers.length === 0) {
                    return interaction.editReply({ content: 'Aucune donnée de message trouvée pour ce mois.', });
                }

                const imageBuffer = await generateLeaderboardCard(
                    interaction.client, 
                    topUsers, 
                    'Classement Mensuel (Messages)', 
                    'messages' 
                ); 
                const file = new AttachmentBuilder(imageBuffer, { name: 'leaderboard-messages.png' });

                await interaction.editReply({ files: [file] });
                break;
            }

            case 'xp-add': {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.' });
                }
                const target = interaction.options.getUser('membre', true);
                const amount = interaction.options.getInteger('montant', true);
                const guildId = interaction.guild.id;

                let userXP = await UserXP.findOneAndUpdate(
                    { guildId, userId: target.id },
                    { $inc: { xp: amount } },
                    { upsert: true, new: true }
                );
                // Pas d'XP négative ; on garde le niveau stocké cohérent
                const fixedXP = Math.max(0, userXP.xp);
                userXP = await UserXP.findOneAndUpdate(
                    { _id: userXP._id },
                    { $set: { xp: fixedXP, level: levelFromXP(fixedXP).level } },
                    { new: true }
                );

                await interaction.reply({ content: `✅ **${amount} XP** ajoutés à **${target.tag || target.username}**. XP total: ${userXP.xp}.`, flags: MessageFlags.Ephemeral });
                break;
            }

            case 'xp-set': {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.' });
                }
                const target = interaction.options.getUser('membre', true);
                const amount = interaction.options.getInteger('montant', true);
                const guildId = interaction.guild.id;
                
                if (amount < 0) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Le montant doit être positif.' });
                }
                const { level: newLevel } = levelFromXP(amount);

                await UserXP.findOneAndUpdate(
                    { guildId, userId: target.id },
                    { $set: { xp: amount, level: newLevel } },
                    { upsert: true, new: true }
                );

                await interaction.reply({ content: `✅ XP de **${target.username}** défini à **${amount}**. Niveau: ${newLevel}.`, flags: MessageFlags.Ephemeral });
                break;
            }

            case 'xp-simulate': {
                await interaction.deferReply();
                const targetUser = interaction.options.getUser('membre', true);
                const points = interaction.options.getInteger('points', true);
                const guildId = interaction.guild.id;

                const userXP = await UserXP.findOne({ guildId, userId: targetUser.id }).lean() || { xp: 0 };
                const simulatedXP = { xp: userXP.xp + points };
                const guildConfig = await GuildConfig.findOne({ guildId }).lean();
                
                const imageBuffer = await generateRankCard(targetUser, simulatedXP, { guildConfig: guildConfig });
                const file = new AttachmentBuilder(imageBuffer, { name: 'simulation.png' });
                
                await interaction.editReply({ content: `Simuler un gain de **${points} XP** donnerait à **${targetUser.tag || targetUser.username}** :`, files: [file] });
                break;
            }

            case 'xp-role-rewards': {
                const guildConf = await GuildConfig.findOne({ guildId: interaction.guild.id }).lean();
                const rewards = guildConf?.features?.xpRoles || []; 
                
                if (rewards.length === 0) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Il n\'y a pas de récompenses de rôle par niveau configurées.' });
                }
                
                const description = rewards.sort((a, b) => a.level - b.level).map(r => {
                    return `**Niveau ${r.level}** : <@&${r.roleId}>`;
                }).join('\n');
                
                const embed = new EmbedBuilder()
                    .setTitle('Récompenses de rôles par niveau')
                    .setDescription(description)
                    .setColor('Blue');
                    
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'xp-init': {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.' });
                }

                const targetUser = interaction.options.getUser('membre', true);
                const guildId = interaction.guildId;

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                let userDoc = await UserXP.findOne({ guildId, userId: targetUser.id });

                if (userDoc) {
                    return interaction.editReply({ 
                        content: `⚠️ **${targetUser.tag}** existe déjà dans la base de données XP. (XP: ${userDoc.xp}, Messages: ${userDoc.totalMessages || 0}).` 
                    });
                }
                
                userDoc = new UserXP({
                    guildId,
                    userId: targetUser.id,
                    xp: 0,
                    level: 0,
                    totalMessages: 0,
                    monthlyMessages: 0,
                    lastMessageAt: new Date(0), 
                    cardBackground: null, 
                });

                await userDoc.save();

                await interaction.editReply({ 
                    content: `✅ **${targetUser.tag}** a été ajouté à la base de données XP avec succès (0 XP, 0 Message).` 
                });
                break;
            }

            case 'rep': { 
                const target = interaction.options.getUser('membre', true);
                const type = interaction.options.getString('type', true); 
                const reason = interaction.options.getString('raison') || 'Aucune raison fournie.';
                const guildId = interaction.guild.id;
                
                const amount = type === 'POSITIVE' ? 1 : -1;
                const emoji = type === 'POSITIVE' ? '✅' : '❌';
                const actionText = type === 'POSITIVE' ? 'ajouté à' : 'retiré de';

                if (target.id === interaction.user.id) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous ne pouvez pas vous donner de réputation à vous-même.' });
                }
                if (target.bot) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Impossible de donner de la réputation à un bot.' });
                }
                const repKey = `${guildId}:${interaction.user.id}:${target.id}`;
                const lastRep = repCooldowns.get(repKey) || 0;
                if (Date.now() - lastRep < REP_COOLDOWN_MS) {
                    const nextAt = Math.floor((lastRep + REP_COOLDOWN_MS) / 1000);
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `⏳ Tu as déjà noté ce membre récemment. Réessaie <t:${nextAt}:R>.` });
                }
                repCooldowns.set(repKey, Date.now());

                const userDoc = await UserXP.findOneAndUpdate(
                    { guildId, userId: target.id },
                    { $inc: { reputation: amount } }, 
                    { upsert: true, new: true }
                ).lean();

                await interaction.reply({
                    content: `${emoji} **${amount > 0 ? '+' : ''}${amount} Réputation** ${actionText} **${target.tag || target.username}** pour : *${reason}*. Sa réputation totale est maintenant de **${userDoc.reputation}**!`,
                    allowedMentions: { parse: [] },
                });
                break;
            }
            
            case 'say': {
                const message = interaction.options.getString('message', true);
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de gérer les messages pour faire dire quelque chose au bot.' });
                }
                // Sans la permission « Mentionner @everyone », le bot ne doit pas pinger tout le serveur à ta place
                const canPingEveryone = interaction.member.permissions.has(PermissionsBitField.Flags.MentionEveryone);
                await interaction.channel.send({
                    content: message.slice(0, 2000),
                    allowedMentions: { parse: canPingEveryone ? ['users', 'roles', 'everyone'] : ['users'] },
                });
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Message envoyé.' });
                break;
            }
            
            case 'embed-modal': {
                const targetChannel = interaction.options.getChannel('salon', true);
                
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de gérer les messages pour envoyer un embed.' });
                }
                
                const modal = createEmbedCreatorModal(targetChannel.id, {});

                await interaction.showModal(modal);

                break;
            }

            case 'embed': {
                const title = interaction.options.getString('titre'); 
                const description = interaction.options.getString('description', true);
                
                const colorOption = interaction.options.getString('couleur');
                const footerText = interaction.options.getString('footer');
                const imageUrl = interaction.options.getString('image');
                const thumbnailUrl = interaction.options.getString('miniature');
                
                const authorName = interaction.options.getString('auteur_nom');
                const authorIconUrl = interaction.options.getString('auteur_icone');
                const footerIconUrl = interaction.options.getString('footer_icone');
                
                // AVANT : une couleur invalide (ex: "rouge") faisait planter la commande
                const color = parseHexColor(colorOption);
                for (const u of [imageUrl, thumbnailUrl, authorIconUrl, footerIconUrl]) {
                    if (u && !isHttpUrl(u)) {
                        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Les URLs (image, miniature, icônes) doivent commencer par http(s)://' });
                    }
                }

                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de gérer les messages pour envoyer un embed.' });
                }
                
                const embed = new EmbedBuilder()
                    .setDescription(description)
                    .setColor(color);
                    
                if (title) {
                    embed.setTitle(title); 
                }

                if (authorName) {
                    embed.setAuthor({ 
                        name: authorName, 
                        iconURL: authorIconUrl || undefined 
                    });
                }

                if (footerText) {
                    embed.setFooter({ 
                        text: footerText,
                        iconURL: footerIconUrl || undefined 
                    }); 
                }

                if (imageUrl) {
                    embed.setImage(imageUrl);
                }

                if (thumbnailUrl) {
                    embed.setThumbnail(thumbnailUrl);
                }
                
                await interaction.channel.send({ embeds: [embed] });
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Embed envoyé.' });
                break;
            }

            case 'nick': {
                const target = interaction.options.getMember('membre', true);
                const nickname = interaction.options.getString('surnom') || null;
                
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de gérer les surnoms.' });
                }
                
                if (interaction.member.roles.highest.position <= target.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous ne pouvez pas modifier le surnom d\'un membre ayant un rôle égal ou supérieur au vôtre.' });
                }
                
                const changed = await target.setNickname(nickname).then(() => true).catch(() => false);
                if (!changed) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je ne peux pas modifier le surnom de ce membre (hiérarchie des rôles ou propriétaire du serveur).' });
                }

                await interaction.reply({ 
                    flags: MessageFlags.Ephemeral, content: nickname 
                        ? `✅ Surnom de **${target.user.tag || target.user.username}** changé en **${nickname}**.` 
                        : `✅ Surnom de **${target.user.tag || target.user.username}** réinitialisé.` 
                });
                break;
            }
            
            case 'avatar': {
                const target = interaction.options.getUser('cible') || interaction.user;
                
                const embed = new EmbedBuilder()
                    .setTitle(`Avatar de ${target.username}`)
                    .setImage(target.displayAvatarURL({ size: 1024, dynamic: true }))
                    .setColor(0x0099ff);
                    
                await interaction.reply({ embeds: [embed] });
                break;
            }
            
            // Commande enregistrée sous le nom « welcome-preview » mais le code s'appelait
            // « send-welcome » → elle répondait « Commande inconnue ». Les paramètres passés
            // à composeWelcomeImageEx ne correspondaient pas non plus (fond jamais affiché).
            case 'welcome-preview': {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous devez être administrateur pour tester le panneau de bienvenue.' });
                }

                const channel = interaction.options.getChannel('salon') || interaction.channel;
                if (!channel?.isTextBased()) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Veuillez choisir un salon textuel valide.' });
                }
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id }).lean();
                const welcomeConf = guildConfig?.welcome || {};

                let backgroundSrc = null;
                if (welcomeConf.imageSourceType === 'upload' && welcomeConf.uploadedImagePath) backgroundSrc = resolveImageSrc(welcomeConf.uploadedImagePath);
                else if (welcomeConf.imageSourceType === 'url' && welcomeConf.imageUrl) backgroundSrc = resolveImageSrc(welcomeConf.imageUrl);

                const welcomeImage = await composeWelcomeImageEx({
                    width: 1200,
                    height: 500,
                    backgroundSrc,
                    overlayWelcomeText: welcomeConf.overlayWelcomeText !== false,
                    overlayTextColor: welcomeConf.overlayTextColor || '#FFFFFF',
                    overlayTextShadow: welcomeConf.overlayTextShadow !== false,
                    serverName: interaction.guild.name,
                    avatarUrl: interaction.user.displayAvatarURL({ size: 512, extension: 'png' }),
                    showAvatar: welcomeConf.showAvatarOnImage !== false,
                    message: welcomeConf.message || '',
                    username: interaction.user.username,
                    memberCount: interaction.guild.memberCount,
                });

                const file = new AttachmentBuilder(welcomeImage, { name: 'welcome-preview.png' });
                const embed = new EmbedBuilder()
                    .setTitle((welcomeConf.title || 'Bienvenue !').slice(0, 256))
                    .setDescription((welcomeConf.message || 'Bienvenue sur le serveur !').slice(0, 4096))
                    .setImage('attachment://welcome-preview.png')
                    .setColor(parseHexColor(welcomeConf.color, 0x5865f2))
                    .setFooter({ text: 'Aperçu — les variables {member}, {server.name}… sont remplacées lors d\'une vraie arrivée' });

                await channel.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
                await interaction.editReply({ content: `Aperçu du panneau de bienvenue envoyé dans ${channel}.` });
                break;
            }

            case 'xp-delete': {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.' });
                }
                const targetUser = interaction.options.getUser('membre', true);
                const res = await UserXP.deleteOne({ guildId: interaction.guildId, userId: targetUser.id });
                await interaction.reply({
                    flags: MessageFlags.Ephemeral, content: res.deletedCount
                        ? `🗑️ Les données XP de **${targetUser.username}** ont été supprimées.`
                        : `ℹ️ **${targetUser.username}** n'a pas de données XP.`,
                });
                break;
            }

            case 'xp-card-background': {
                const url = interaction.options.getString('url');
                if (url && !isHttpUrl(url)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ L\'URL doit commencer par http(s)://' });
                }
                await UserXP.findOneAndUpdate(
                    { guildId: interaction.guildId, userId: interaction.user.id },
                    { $set: { cardBackground: url || null } },
                    { upsert: true }
                );
                await interaction.reply({
                    flags: MessageFlags.Ephemeral, content: url ? '✅ Fond de ta carte de rang mis à jour ! Essaie `/rank`.' : '✅ Fond de ta carte de rang réinitialisé.',
                });
                break;
            }

            case 'logs-test': {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.' });
                }
                const conf = await GuildConfig.findOne({ guildId: interaction.guildId }).lean();
                const logs = conf?.logs;
                if (!logs?.enabled || !logs.channelId) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Les logs ne sont pas activés ou aucun salon n\'est configuré (dashboard → Logs).' });
                }
                const logChannel = interaction.guild.channels.cache.get(logs.channelId);
                if (!logChannel?.isTextBased()) {
                    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Le salon de logs configuré est introuvable.' });
                }
                await logChannel.send({
                    embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle('🧪 Test des logs').setDescription(`Message de test envoyé par ${interaction.user}.`).setTimestamp()],
                    allowedMentions: { parse: [] },
                });
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Message de test envoyé dans ${logChannel}.` });
                break;
            }

            default:
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Commande inconnue.' });
                break;
        }
    } catch (e) {
        LOG('Erreur lors de l\'exécution de la commande:', e);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Une erreur est survenue lors de l\'exécution de cette commande.' });
        } else if (interaction.deferred) {
            await interaction.editReply({ content: 'Une erreur est survenue lors de l\'exécution de cette commande.' });
        }
    }
}