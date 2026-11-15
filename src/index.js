// src/index.js
import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials, ActivityType, AttachmentBuilder, MessageFlags } from 'discord.js';
import { exec } from 'child_process';
import { startDashboard } from './dashboard/server.js';
import { sendWelcome, sendGoodbye } from './features/welcomeGoodbye.js';
import GuildConfig from './models/GuildConfig.js';
import { config } from './config.js';
import connectDB from './database.js';
import { registerApplicationCommands, coreCommands, moderationCommands, reactionRoleCommand } from './commands/register.js';
import { handleModerationInteraction } from './commands/moderation.js';
import { handleCoreInteraction } from './commands/core.js';
import { handleReactionRoleInteraction } from './features/reactionRoles.js';
import { startSchedulers } from './scheduler.js';
import { bindLogHandlers } from './logger/logEvents.js';
import UserXP from './models/UserXP.js';
import { levelFromXP } from './utils/xp.js';
import generateRankCard from './utils/generateRankCard.js';
import { handleTicketInteraction, handleTicketCloseInteraction, handleTicketClaimInteraction } from './features/tickets.js';
import { handleAutomod } from './features/automod.js';
import { syncLevelRoles } from './features/levelRoles.js';
import { reportError, reportInfo } from './utils/alerts.js';
import { getGuildConfig } from './utils/configCache.js';

const XP_COOLDOWN = 60;
const XP_PER_MESSAGE = 3;
const PREFIX = config.prefix || '!';

// Salon où seul l'emoji 💩 est autorisé (laisser vide pour désactiver)
const ID_SALON_POOP = process.env.POOP_CHANNEL_ID || '1451295114814034103';

// Utilisateurs autorisés à utiliser !shutdown / !restart en plus du propriétaire du bot
const ALLOWED_ADMIN_IDS = (process.env.BOT_ADMIN_IDS || '706520558581579827')
  .split(',').map(s => s.trim()).filter(Boolean);

// Nom du process PM2 à redémarrer avec !restart
const PM2_PROCESS_NAME = process.env.PM2_PROCESS_NAME || 'index';

const BOT_TOKEN = process.env.DISCORD_TOKEN || config.token;
if (!BOT_TOKEN) {
  console.error('[BOOT] DISCORD_TOKEN manquant. Renseigne DISCORD_TOKEN dans le fichier .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration, // nécessaire pour l'événement guildBanAdd (logs des bans)
    // GuildPresences retiré : rien dans le code ne s'en sert, et c'est l'intent le plus gourmand
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User, Partials.Reaction],
});

bindLogHandlers(client);

// 'ready' est déprécié dans discord.js 14.22+ → Events.ClientReady ('clientReady')
client.once(Events.ClientReady, async () => {
  console.log(`[BOOT] Connecté en tant que ${client.user.tag}`);
  client.user.setActivity('ton serveur', { type: ActivityType.Watching });

  try { await client.application.fetch(); } catch (e) { console.error('[BOOT] application.fetch', e.message); }

  await startDashboard(client);
  await registerApplicationCommands(client);
  startSchedulers(client);
  reportInfo('✅ Bot démarré', `Connecté en tant que **${client.user.tag}** sur ${client.guilds.cache.size} serveur(s).`);
});

client.on(Events.Error, (e) => { console.error('[DISCORD] Erreur client :', e); reportError('Client Discord', e); });
client.on(Events.ShardDisconnect, (ev) => {
  if (ev?.code === 1000) return; // arrêt volontaire (!restart, !shutdown)
  reportError('Déconnexion de Discord', `Code ${ev?.code ?? '?'} — reconnexion automatique en cours.`);
});

// AVANT : sendGoodbye(member) alors que la fonction attend (guild, member)
// → la config était cherchée avec l'ID du membre et les messages de départ n'étaient jamais envoyés.
client.on(Events.GuildMemberAdd, (member) => sendWelcome(member.guild, member).catch(e => console.error('[WELCOME]', e)));
client.on(Events.GuildMemberRemove, (member) => sendGoodbye(member.guild, member).catch(e => console.error('[GOODBYE]', e)));

// ---------- Interactions ----------
const coreCommandNames = new Set(coreCommands.map(c => c.name));
const moderationCommandNames = new Set(moderationCommands.map(c => c.name));

async function replyError(interaction, content) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch { /* l'interaction a peut-être expiré */ }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      await handleCoreInteraction(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      if (commandName === reactionRoleCommand.name) {
        await handleReactionRoleInteraction(interaction);
      } else if (coreCommandNames.has(commandName)) {
        await handleCoreInteraction(interaction);
      } else if (moderationCommandNames.has(commandName)) {
        await handleModerationInteraction(interaction);
      } else {
        await interaction.reply({ content: 'Commande inconnue.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === 'ticket-open') await handleTicketInteraction(interaction);
      else if (id === 'ticket-claim') await handleTicketClaimInteraction(interaction);
      else if (['ticket-close', 'ticket-close-confirm', 'ticket-close-cancel'].includes(id)) await handleTicketCloseInteraction(interaction);
      else if (id.startsWith('rr-btn-')) await handleReactionRoleInteraction(interaction);
      else if (id.startsWith('embed-edit-preview_') || id.startsWith('embed-send-preview_')) await handleCoreInteraction(interaction);
      // Les boutons pfc_* sont gérés par le collector de la commande /pfc
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'rr_select') await handleReactionRoleInteraction(interaction);
      else if (interaction.customId === 'ticket-open-select') await handleTicketInteraction(interaction);
      return;
    }
    // AVANT : handleAutomod(client, message, …) était appelé ici, dans le bloc des menus
    // déroulants, avec une variable `message` qui n'existe pas → ReferenceError à chaque menu,
    // et l'automod ne tournait jamais. Il est maintenant dans messageCreate.
  } catch (e) {
    console.error('[INTERACTION] Erreur :', e);
    reportError(`Interaction ${interaction.commandName || interaction.customId || interaction.type}`, e);
    await replyError(interaction, '❌ Une erreur est survenue lors de l\'exécution de cette action.');
  }
});

// ---------- Messages ----------
function fillLevelUpTemplate(template, author, level) {
  // replaceAll : avant, seule la première occurrence de chaque variable était remplacée
  return template
    .replaceAll('{user.mention}', `<@${author.id}>`)
    .replaceAll('{user.username}', author.username)
    .replaceAll('{user}', `<@${author.id}>`)
    .replaceAll('{level}', String(level));
}

async function handleXP(message, guildConfig) {
  const { guildId, author } = message;

  // Compteurs de messages : mise à jour atomique, à CHAQUE message
  // (avant, les messages envoyés pendant le cooldown n'étaient pas comptés : on sortait avant le save)
  const userXP = await UserXP.findOneAndUpdate(
    { guildId, userId: author.id },
    { $inc: { monthlyMessages: 1, totalMessages: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const now = Date.now();
  const lastMessageAt = userXP.lastMessageAt ? userXP.lastMessageAt.getTime() : 0;
  if ((now - lastMessageAt) < XP_COOLDOWN * 1000) return;

  const oldLevel = levelFromXP(userXP.xp).level;
  const updated = await UserXP.findOneAndUpdate(
    { _id: userXP._id },
    { $inc: { xp: XP_PER_MESSAGE }, $set: { lastMessageAt: new Date(now) } },
    { new: true }
  );
  const newLevel = levelFromXP(updated.xp).level;
  if (newLevel <= oldLevel) return;

  if (updated.level !== newLevel) await UserXP.updateOne({ _id: updated._id }, { $set: { level: newLevel } });

  // Rôles de récompense
  const newRoles = await syncLevelRoles(message.member, newLevel, guildConfig.xp);

  // Annonce : réglage du dashboard ; s'il n'a jamais été touché, comportement d'origine
  // (annonce uniquement si un salon de level-up est choisi)
  const levelUpChannelId = guildConfig.xp.messageChannelId;
  const announce = guildConfig.xp.announceLevelUp ?? !!levelUpChannelId;
  if (!announce) return;
  const channel = levelUpChannelId ? message.guild.channels.cache.get(levelUpChannelId) : message.channel;
  if (!channel?.isTextBased?.()) return;

  const template = guildConfig.xp.levelUpMessage || 'Félicitations, {user.mention} ! Tu es maintenant au niveau **{level}** ! 🎉';
  let content = fillLevelUpTemplate(template, author, newLevel);
  if (newRoles.length) content += `\n🎁 Nouveau rôle : ${newRoles.map(id => `<@&${id}>`).join(', ')}`;

  let files = [];
  try {
    const imageBuffer = await generateRankCard(author, updated, { guildConfig });
    files = [new AttachmentBuilder(imageBuffer, { name: 'rank.png' })];
  } catch (e) {
    console.error('[XP] Carte de rang impossible à générer :', e.message);
  }
  await channel.send({ content, files, allowedMentions: { users: [author.id] } }).catch(e => console.error('[XP] Envoi level-up :', e.message));
}

function isBotAdmin(userId) {
  const owner = client.application?.owner;
  // Le propriétaire peut être un utilisateur ou une équipe (Team)
  const ownerIds = owner?.members ? [...owner.members.keys()] : (owner?.id ? [owner.id] : []);
  return ownerIds.includes(userId) || ALLOWED_ADMIN_IDS.includes(userId);
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    if (ID_SALON_POOP && message.channel.id === ID_SALON_POOP) {
      if (message.content.trim() !== '💩') {
        if (message.deletable) await message.delete().catch(() => {});
        return; // pas d'XP ni de commandes dans ce salon
      }
    }

    // Config lue depuis le cache mémoire (plus de requête MongoDB à chaque message)
    const guildConfig = await getGuildConfig(message.guild.id);

    // --- Auto-modération ---
    if (guildConfig?.automod?.enabled) {
      const removed = await handleAutomod(client, message, guildConfig).catch(e => {
        console.error('[AUTOMOD] Erreur :', e);
        return false;
      });
      if (removed) return;
    }

    // --- XP ---
    // AVANT : pendant le cooldown XP on faisait `return` → les commandes !ping, !restart…
    // ne répondaient pas si on avait parlé dans la dernière minute.
    if (guildConfig?.xp?.enabled) {
      await handleXP(message, guildConfig).catch(e => console.error('[XP] Erreur :', e));
    }

    // --- Commandes avec préfixe ---
    if (!message.content.startsWith(PREFIX)) return;

    const [rawName] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const name = (rawName || '').toLowerCase();
    if (!name) return;

    const found = (guildConfig?.customCommands || []).find(c => c.name?.toLowerCase() === name);
    if (found?.response) {
      // N'importe quel membre peut déclencher une commande perso : on bloque @everyone/@here
      await message.reply({ content: found.response, allowedMentions: { parse: ['users'], repliedUser: false } });
      return;
    }

    if (name === 'ping') {
      const sent = await message.reply('Pong!');
      setTimeout(() => sent.edit(`Pong! 🏓 (${client.ws.ping} ms)`).catch(() => {}), 200);
      return;
    }

    if (name === 'shutdown') {
      if (!isBotAdmin(message.author.id)) return message.reply('Tu n\'as pas la permission d\'utiliser cette commande.');
      await message.reply('Arrêt en cours...');
      setTimeout(async () => {
        await client.destroy();
        process.exit(0);
      }, 1000);
      return;
    }

    // Redémarrage : via PM2 en local, sinon on quitte et l'hébergeur (Railway) relance le bot
    if (name === 'restart') {
      if (!isBotAdmin(message.author.id)) return message.reply('Tu n\'as pas la permission d\'utiliser cette commande.');
      await message.reply('🔄 Redémarrage **initié**... Le bot sera de retour en ligne dans quelques instants.');
      const underPm2 = process.env.pm_id !== undefined;
      if (!underPm2) {
        // Code de sortie ≠ 0 : Railway redémarre automatiquement le service (politique « On Failure »)
        setTimeout(async () => { await client.destroy(); process.exit(1); }, 1000);
        return;
      }
      setTimeout(() => {
        exec(`pm2 restart ${PM2_PROCESS_NAME}`, (error) => {
          if (error) {
            console.error(`Erreur lors du redémarrage: ${error}`);
            message.channel.send('❌ Une erreur est survenue lors du lancement du redémarrage PM2.').catch(() => {});
          }
        });
      }, 1000);
      return;
    }
  } catch (e) {
    console.error('[MSG] Handler error:', e);
    reportError('Traitement d\'un message', e);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
  reportError('Promesse non gérée', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  reportError('Exception non gérée', err);
});

// On se connecte à MongoDB AVANT Discord (avant, les deux démarraient en parallèle
// et une erreur de connexion à la base n'était jamais gérée).
try {
  await connectDB();
} catch (e) {
  console.error('[BOOT] Connexion MongoDB impossible :', e.message);
  reportError('Démarrage : connexion MongoDB impossible', e);
  await new Promise(r => setTimeout(r, 2000)); // laisse le temps à l'alerte de partir
  process.exit(1);
}
await client.login(BOT_TOKEN);
