// src/logger/deleteLogs.js
// Logs détaillés des messages supprimés (un par un, et suppressions en masse).
import { AttachmentBuilder, AuditLogEvent, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAX_REUPLOAD = 8 * 1024 * 1024; // 8 Mo par fichier
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

// Les entrées « message supprimé » du journal d'audit sont regroupées par Discord :
// on mémorise leur compteur pour repérer celle qui vient d'augmenter.
const auditCounts = new Map(); // entryId -> count

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);
const ts = (date, style = 'f') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

/** Qui a supprimé le message ? (seulement visible si un modo a supprimé le message de quelqu'un d'autre) */
async function findDeleter(message) {
  const guild = message.guild;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return { known: false };
  await sleep(1500); // le journal d'audit met un instant à se mettre à jour
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 }).catch(() => null);
  if (!logs) return { known: false };

  let found = null;
  for (const entry of logs.entries.values()) {
    const prev = auditCounts.get(entry.id);
    const count = entry.extra?.count ?? 1;
    auditCounts.set(entry.id, count);
    const sameTarget = entry.target?.id === message.author?.id && entry.extra?.channel?.id === message.channelId;
    const isNew = prev === undefined ? Date.now() - entry.createdTimestamp < 10000 : count > prev;
    if (!found && sameTarget && isNew) found = entry.executor;
  }
  if (auditCounts.size > 500) auditCounts.clear();
  // Pas d'entrée : l'auteur a supprimé son propre message (Discord ne le journalise pas)
  return { known: true, executor: found };
}

/** Récupère les pièces jointes tant qu'elles sont encore accessibles, pour les garder dans le log. */
async function rescueAttachments(message) {
  const files = [];
  for (const att of message.attachments.values()) {
    if (att.size > MAX_REUPLOAD || files.length >= 4) continue;
    try {
      const res = await fetch(att.proxyURL || att.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      files.push(new AttachmentBuilder(buf, { name: att.name || 'fichier' }));
    } catch { /* le fichier n'est déjà plus disponible */ }
  }
  return files;
}

export async function logDeletedMessage(message, logChannel) {
  // Message supprimé avant le démarrage du bot : Discord ne nous donne que son ID
  if (message.partial || !message.author) {
    const e = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle('🗑️ Message supprimé (contenu inconnu)')
      .setDescription(`Un message a été supprimé dans <#${message.channelId}>.\nIl a été envoyé avant le dernier démarrage du bot : son contenu et son auteur ne sont pas connus.`)
      .setFooter({ text: `ID du message : ${message.id}` })
      .setTimestamp();
    return logChannel.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  }

  const [deleter, files] = await Promise.all([findDeleter(message), rescueAttachments(message)]);
  const author = message.author;

  const content = (message.content || '').trim();
  const description = content
    ? content.slice(0, 3800) + (content.length > 3800 ? '\n*…(tronqué)*' : '')
    : '*Aucun texte*';

  const e = new EmbedBuilder()
    .setColor(0xef4444)
    .setAuthor({ name: `${author.tag} — message supprimé`, iconURL: author.displayAvatarURL({ size: 64 }) })
    .setDescription(description)
    .addFields(
      { name: 'Auteur', value: `<@${author.id}>\n\`${author.id}\``, inline: true },
      { name: 'Salon', value: `<#${message.channelId}>`, inline: true },
      {
        name: 'Supprimé par',
        value: !deleter.known ? 'Inconnu (le bot n\'a pas accès au journal d\'audit)'
          : deleter.executor ? `<@${deleter.executor.id}> (modération)`
          : 'L\'auteur lui-même',
        inline: true,
      },
      { name: 'Envoyé', value: `${ts(message.createdAt)} (${ts(message.createdAt, 'R')})`, inline: true },
    )
    .setFooter({ text: `ID du message : ${message.id}` })
    .setTimestamp();

  if (message.editedAt) e.addFields({ name: 'Modifié', value: ts(message.editedAt, 'R'), inline: true });

  // Message auquel il répondait
  if (message.reference?.messageId) {
    const link = `https://discord.com/channels/${message.guildId}/${message.reference.channelId || message.channelId}/${message.reference.messageId}`;
    e.addFields({ name: 'En réponse à', value: `[Voir le message](${link})`, inline: true });
  }

  // Pièces jointes, autocollants, embeds
  if (message.attachments.size) {
    const list = [...message.attachments.values()].map(a => `• ${a.name} (${fmtSize(a.size)})`).join('\n');
    const saved = files.length ? `\n✅ ${files.length} fichier(s) récupéré(s) ci-dessous` : '\n⚠️ Fichiers plus disponibles';
    e.addFields({ name: `Pièces jointes (${message.attachments.size})`, value: (list + saved).slice(0, 1024) });
  }
  if (message.stickers?.size) e.addFields({ name: 'Autocollant', value: [...message.stickers.values()].map(s => s.name).join(', ').slice(0, 1024), inline: true });
  if (!content && message.embeds?.length) e.addFields({ name: 'Contenu', value: `${message.embeds.length} encadré(s) (lien, image…)`, inline: true });

  // Première image récupérée affichée directement dans le log
  const firstImage = files.find(f => IMAGE_EXT.test(f.name || ''));
  if (firstImage) e.setImage(`attachment://${firstImage.name}`);

  return logChannel.send({ embeds: [e], files, allowedMentions: { parse: [] } }).catch(() => {});
}

/** Suppression en masse (/clear, ou un modo qui supprime plusieurs messages d'un coup). */
export async function logBulkDelete(messages, channel, logChannel) {
  const list = [...messages.values()].filter(m => !m.partial && m.author).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let executor = null;
  if (channel.guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    await sleep(1500);
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.MessageBulkDelete, limit: 5 }).catch(() => null);
    const entry = logs?.entries.find(en => en.target?.id === channel.id && Date.now() - en.createdTimestamp < 30000);
    executor = entry?.executor ?? null;
  }

  // Résumé par auteur
  const byAuthor = new Map();
  for (const m of list) byAuthor.set(m.author.id, (byAuthor.get(m.author.id) || 0) + 1);
  const summary = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, n]) => `<@${id}> : ${n}`).join('\n') || '—';

  // Transcription complète en fichier texte
  const lines = list.map(m => {
    const date = new Date(m.createdTimestamp).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const atts = m.attachments.size ? ` [${[...m.attachments.values()].map(a => a.name).join(', ')}]` : '';
    return `[${date}] ${m.author.tag} : ${m.content || '(sans texte)'}${atts}`;
  });
  const unknown = messages.size - list.length;
  if (unknown) lines.push(`… et ${unknown} message(s) plus ancien(s) dont le contenu n'est pas connu du bot.`);
  const file = new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `messages-supprimes-${channel.name}.txt` });

  const e = new EmbedBuilder()
    .setColor(0xb91c1c)
    .setTitle(`🧹 ${messages.size} messages supprimés`)
    .addFields(
      { name: 'Salon', value: `<#${channel.id}>`, inline: true },
      { name: 'Par', value: executor ? `<@${executor.id}>` : 'Inconnu', inline: true },
      { name: 'Auteurs', value: summary.slice(0, 1024) },
    )
    .setFooter({ text: 'Le détail complet est dans le fichier joint.' })
    .setTimestamp();

  return logChannel.send({ embeds: [e], files: [file], allowedMentions: { parse: [] } }).catch(() => {});
}
