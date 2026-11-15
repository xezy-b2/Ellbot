// src/features/welcomeGoodbye.js
import {
  ChannelType,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionsBitField,
} from 'discord.js';
import GuildConfig from '../models/GuildConfig.js';
import { composeWelcomeImageEx, resolveImageSrc } from '../utils/imageComposer.js';

// ---------------- Utils ----------------
function resolveTextChannel(guild, channelId) {
  if (!channelId) return null;
  const ch = guild.channels.cache.get(channelId);
  if (!ch) return null;
  // prefer using isTextBased if available
  if (typeof ch.isTextBased === 'function' ? !ch.isTextBased() : ch.type !== ChannelType.GuildText) return null;

  const me = guild?.members?.me;
  if (!me) return null;
  const perms = ch.permissionsFor(me);
  if (!perms) return null;
  if (!perms.has(PermissionsBitField.Flags.ViewChannel)) return null;
  if (!perms.has(PermissionsBitField.Flags.SendMessages)) return null;
  if (!perms.has(PermissionsBitField.Flags.EmbedLinks)) return null;
  if (!perms.has(PermissionsBitField.Flags.AttachFiles)) return null;
  return ch;
}

function hexToInt(hex, fallback) {
  if (hex && /^#?[0-9A-Fa-f]{6}$/.test(hex)) return parseInt(String(hex).replace('#', ''), 16);
  return fallback;
}

const safe = s => (typeof s === 'string' ? s : '') || '';

// ---------------- Template helper ----------------
/**
 * Replace placeholders in templates.
 * Supported keys:
 *  - {user.mention} / {member.mention}
 *  - {user.username} / {member.username}
 *  - {user.tag} / {member.tag}
 *  - {user.displayName} / {member.displayName}
 *  - {user} -> mention
 *  - {member} -> mention
 *  - {server.name}
 *  - {membercount}
 */
function formatTemplate(template = '', memberLike = {}, guildLike = {}) {
  if (!template) return '';

  const m = {
    id: memberLike?.id || memberLike?.user?.id || '',
    username: memberLike?.username || memberLike?.user?.username || '',
    discriminator: memberLike?.discriminator || memberLike?.user?.discriminator || '',
    tag: memberLike?.tag || (memberLike?.user ? `${memberLike.user.username}#${memberLike.user?.discriminator || '0000'}` : ''),
    displayName: memberLike?.displayName || memberLike?.nickname || memberLike?.username || memberLike?.user?.username || '',
    mention: memberLike?.mention || (memberLike?.id ? `<@${memberLike.id}>` : '')
  };

  const g = {
    name: guildLike?.name || '',
    memberCount: Number(guildLike?.memberCount ?? guildLike?.membercount ?? 0)
  };

  return String(template).replace(/{([a-zA-Z0-9_.]+)}/g, (_, key) => {
    switch (key) {
      case 'user.mention': case 'member.mention': return m.mention;
      case 'user.username': case 'member.username': return m.username;
      case 'user.tag': case 'member.tag': return m.tag;
      case 'user.displayName': case 'member.displayName': return m.displayName;

      case 'user': case 'member': return m.mention || m.username || '';

      case 'server.name': return g.name;
      case 'membercount': return String(g.memberCount);

      default:
        return `{${key}}`;
    }
  });
}

// ---------------- Embeds ----------------
function buildWelcomeEmbed(conf, guild, member) {
  const s = conf?.welcome || {};
  const color = hexToInt(s.color, 0x5865F2);
  const title = (safe(s.title).trim() || 'Ho ! Un nouveau membre !').slice(0, 256);

  const raw = safe(s.message) || 'Bienvenue {member} sur {server.name} !';
  const desc = formatTemplate(raw, member, guild).slice(0, 4096);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc);

  // Author / Footer / Thumbnail can be added here if needed
  return embed;
}

function buildGoodbyeEmbed(conf, guild, member) {
  const s = conf?.goodbye || {};
  const color = hexToInt(s.color, 0xE74C3C);
  const title = (safe(s.title).trim() || 'À bientôt').slice(0, 256);

  const raw = safe(s.message) || '{member} a quitté {server.name}.';
  const desc = formatTemplate(raw, member, guild).slice(0, 4096);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp(new Date());

  const avatarUrl = member?.user?.displayAvatarURL ? member.user.displayAvatarURL({ size: 256 }) : undefined;
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return embed;
}

// ---------------- Sends ----------------
export async function sendWelcome(guild, member) {
  try {
    const conf = await GuildConfig.findOne({ guildId: guild.id }).lean().catch(() => null);
    const s = conf?.welcome || {};
    if (!s.enabled) return;

    const channel = resolveTextChannel(guild, s.channelId);
    if (!channel) return;

    // Pings hors-embed
    const pings = [];
    if (s.pingEveryone) pings.push('@everyone');
    // default behavior: if pingUser is omitted, keep existing behavior (true by default in config)
    if (s.pingUser !== false) pings.push(`<@${member.id}>`);
    const content = pings.join(' ').trim() || undefined;

    // Embed (titre/couleur/texte)
    const embed = buildWelcomeEmbed(conf, guild, member);

    // ---- Résoudre l'image de fond pour Canvas (PAS pour Discord embed) ----
    let backgroundSrc = null;
    if (s.imageSourceType === 'upload' && s.uploadedImagePath) {
      backgroundSrc = resolveImageSrc(s.uploadedImagePath);
    } else if (s.imageSourceType === 'url' && s.imageUrl) {
      backgroundSrc = resolveImageSrc(s.imageUrl);
    }

    // ---- Générer le visuel via Canvas → Buffer PNG ----
    const avatarUrlForCanvas = member?.user?.displayAvatarURL
      ? member.user.displayAvatarURL({ extension: 'png', size: 512 })
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    const canvasMessage = formatTemplate(s.message || '', member, guild);

    let buffer = null;
    try {
      buffer = await composeWelcomeImageEx({
        width: 1200,
        height: 500,
        backgroundSrc,
        overlayWelcomeText: s.overlayWelcomeText !== false,
        overlayTextColor: s.overlayTextColor || '#FFFFFF',
        overlayTextShadow: s.overlayTextShadow !== false,
        serverName: guild.name,
        avatarUrl: avatarUrlForCanvas,
        showAvatar: s.showAvatarOnImage !== false,
        message: canvasMessage,
        username: member?.user?.username || member?.username || 'Utilisateur',
        memberCount: guild.memberCount ?? 0
      });
    } catch (e) {
      // si compose échoue, on log et continue sans image
      console.error('[WELCOME] composeWelcomeImageEx error:', e);
      buffer = null;
    }

    // Attacher l'image uniquement si on a un buffer
    const files = [];
    if (buffer && Buffer.isBuffer(buffer)) {
      const file = new AttachmentBuilder(buffer, { name: 'welcome.png' });
      embed.setImage('attachment://welcome.png');
      files.push(file);
    }

    const sent = await channel.send({ content, embeds: [embed], files });

    // Auto-suppression si configurée
    const minutes = Number(s.deleteAfterMinutes ?? 0);
    if (Number.isFinite(minutes) && minutes > 0) {
      setTimeout(() => sent.delete().catch(() => {}), minutes * 60 * 1000);
    }
  } catch (err) {
    console.error('[WELCOME] Error:', err);
  }
}

export async function sendGoodbye(guild, member) {
  try {
    const conf = await GuildConfig.findOne({ guildId: guild.id }).lean().catch(() => null);
    const s = conf?.goodbye || {};
    if (!s.enabled) return;

    const channel = resolveTextChannel(guild, s.channelId);
    if (!channel) return;

    const embed = buildGoodbyeEmbed(conf, guild, member);

    const pings = [];
    if (s.pingEveryone) pings.push('@everyone');
    if (s.pingUser !== false) pings.push(member?.id ? `<@${member.id}>` : '');
    const content = pings.join(' ').trim() || undefined;

    await channel.send({ content, embeds: [embed] });
  } catch (e) {
    console.error('[GOODBYE] Error:', e);
  }
}
