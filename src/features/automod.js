// src/features/automod.js
import { PermissionFlagsBits } from 'discord.js';

// AVANT : l'automod était appelé dans le gestionnaire des menus déroulants avec une
// variable `message` inexistante → il ne s'exécutait jamais. Il est maintenant appelé
// depuis messageCreate (src/index.js). Les parties "anti-liens" et "anti-spam"
// étaient vides : elles sont implémentées ici.

const LOG = (...a) => console.log('[AUTOMOD]', ...a);

// Historique des messages récents par utilisateur, pour l'anti-spam (en mémoire)
const recentMessages = new Map(); // key guildId:userId -> number[] (timestamps)
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, list] of recentMessages) {
    const kept = list.filter(t => t > cutoff);
    if (kept.length) recentMessages.set(key, kept); else recentMessages.delete(key);
  }
}, 60 * 1000).unref();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// \b ne gère pas les lettres accentuées : on utilise des frontières Unicode
function checkBadWords(content, badWordsList) {
  const text = String(content || '');
  for (const raw of badWordsList || []) {
    const word = String(raw || '').trim();
    if (!word) continue;
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(word)}($|[^\\p{L}\\p{N}_])`, 'iu');
    if (regex.test(text)) return true;
  }
  return false;
}

const URL_REGEX = /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/gi;
const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;

function hasForbiddenLink(content, antiLinks) {
  const text = String(content || '');
  if (INVITE_REGEX.test(text)) return !antiLinks.allowInvites;

  const allowed = (antiLinks.allowedDomains || []).map(d => String(d).toLowerCase());
  const urls = text.match(URL_REGEX) || [];
  for (const u of urls) {
    let host = '';
    try { host = new URL(u.startsWith('http') ? u : `https://${u}`).hostname.toLowerCase(); } catch { return true; }
    const ok = allowed.some(d => host === d || host.endsWith(`.${d}`));
    if (!ok) return true;
  }
  return false;
}

async function logToModChannel(message, automod, text) {
  if (!automod.modLogChannelId) return;
  const ch = message.guild.channels.cache.get(automod.modLogChannelId);
  if (ch?.isTextBased?.()) await ch.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}

async function warnUser(message, reason) {
  const warn = await message.channel
    .send({ content: `⚠️ ${message.author}, ${reason}`, allowedMentions: { users: [message.author.id] } })
    .catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 8000);
}

async function punish(message, action, seconds, reason) {
  const member = message.member;
  if (!member) return;
  if (action === 'mute' && member.moderatable) {
    await member.timeout(Math.max(10, seconds || 600) * 1000, `Automod : ${reason}`).catch(e => LOG('timeout error', e.message));
  } else if (action === 'kick' && member.kickable) {
    await member.kick(`Automod : ${reason}`).catch(e => LOG('kick error', e.message));
  }
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 * @param {object} guildConfig  document GuildConfig déjà chargé (lean ou non)
 */
export async function handleAutomod(client, message, guildConfig) {
  const automod = guildConfig?.automod;
  if (!automod?.enabled) return false;
  if (!message.guild || message.author?.bot || !message.member) return false;

  // Les admins / modérateurs ne sont pas filtrés
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if ((automod.ignoredChannels || []).includes(message.channelId)) return false;
  if (message.member.roles.cache.some(role => (automod.ignoredRoles || []).includes(role.id))) return false;

  const tag = message.author.tag;

  // 1. Mots interdits
  if (automod.badWords?.enabled && checkBadWords(message.content, automod.badWords.list)) {
    const action = automod.badWords.action || 'delete_warn';
    await message.delete().catch(() => {});
    if (action === 'delete_warn') await warnUser(message, 'ce message contenait un mot interdit.');
    if (action === 'mute' || action === 'kick') await punish(message, action, automod.antiSpam?.punishmentTime, 'mot interdit');
    await logToModChannel(message, automod, `🛡️ **Auto-modération** : message de ${tag} supprimé dans ${message.channel} (mot interdit, action : ${action}).`);
    return true;
  }

  // 2. Liens / invitations
  if (automod.antiLinks?.enabled && hasForbiddenLink(message.content, automod.antiLinks)) {
    await message.delete().catch(() => {});
    await warnUser(message, 'les liens ne sont pas autorisés ici.');
    await logToModChannel(message, automod, `🔗 **Auto-modération** : lien supprimé de ${tag} dans ${message.channel}.`);
    return true;
  }

  // 3. Anti-spam : plus de `limit` messages en `timeframe` secondes
  if (automod.antiSpam?.enabled) {
    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    const windowMs = Math.max(1, automod.antiSpam.timeframe || 7) * 1000;
    const list = (recentMessages.get(key) || []).filter(t => now - t < windowMs);
    list.push(now);
    recentMessages.set(key, list);

    if (list.length > Math.max(2, automod.antiSpam.limit || 5)) {
      recentMessages.delete(key); // évite de sanctionner en boucle
      const action = automod.antiSpam.action || 'warn';
      if (action === 'none') return false;
      if (action === 'warn') await warnUser(message, 'merci de ne pas spammer.');
      else await punish(message, action, automod.antiSpam.punishmentTime, 'spam');
      await logToModChannel(message, automod, `🚫 **Auto-modération** : spam détecté de ${tag} dans ${message.channel} (action : ${action}).`);
      return true;
    }
  }

  return false;
}
