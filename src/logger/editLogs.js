// src/logger/editLogs.js
// Logs détaillés des messages modifiés : avant / après, changements surlignés,
// pièces jointes retirées récupérées, lien direct vers le message.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';

const MAX_REUPLOAD = 8 * 1024 * 1024;
const ts = (date, style = 'f') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);

// Empêche le Markdown du message de casser la mise en forme du log
const escapeMd = (t) => String(t).replace(/([\\*_~`|>])/g, '\\$1');

/**
 * Différence mot à mot : retiré en ~~barré~~, ajouté en **gras**.
 * Retourne null si le texte est trop long pour un calcul raisonnable.
 */
export function wordDiff(before, after) {
  const a = String(before).split(/(\s+)/).filter(Boolean);
  const b = String(after).split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 250000) return null;

  // Plus longue sous-séquence commune (programmation dynamique)
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts = [];
  const push = (type, text) => {
    const last = parts.at(-1);
    if (last && last.type === type) last.text += text; else parts.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('add', b[j]); j++; }
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);

  return parts.map(p => {
    if (p.type === 'same') return escapeMd(p.text);
    const core = p.text.trim();
    if (!core) return p.text;
    const lead = p.text.match(/^\s*/)[0];
    const trail = p.text.match(/\s*$/)[0];
    return `${lead}${p.type === 'del' ? `~~${escapeMd(core)}~~` : `**${escapeMd(core)}**`}${trail}`;
  }).join('');
}

const clip = (t, max) => (t.length > max ? t.slice(0, max - 15) + '\n*…(tronqué)*' : t);

async function rescue(attachments) {
  const files = [];
  for (const att of attachments) {
    if (att.size > MAX_REUPLOAD || files.length >= 4) continue;
    try {
      const res = await fetch(att.proxyURL || att.url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) files.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name: att.name || 'fichier' }));
    } catch { /* déjà indisponible */ }
  }
  return files;
}

export async function logEditedMessage(oldMsg, msg, logChannel) {
  const before = oldMsg.partial || oldMsg.content == null ? null : oldMsg.content;
  const after = msg.content ?? '';

  // Pièces jointes retirées pendant la modification
  const removed = oldMsg.attachments ? [...oldMsg.attachments.values()].filter(a => !msg.attachments.has(a.id)) : [];

  const contentChanged = before === null ? true : before !== after;
  if (!contentChanged && !removed.length) return; // ex. simple aperçu de lien ajouté par Discord

  const files = removed.length ? await rescue(removed) : [];
  const author = msg.author;

  const e = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setAuthor({ name: `${author.tag} — message modifié`, iconURL: author.displayAvatarURL({ size: 64 }) })
    .setURL(msg.url)
    .setFooter({ text: `ID du message : ${msg.id}` })
    .setTimestamp(msg.editedAt || new Date());

  if (before === null) {
    e.setDescription(`*Message envoyé avant le dernier démarrage du bot : l'ancien texte n'est pas connu.*\n\n**Nouveau texte :**\n${clip(escapeMd(after) || '*vide*', 3600)}`);
  } else if (contentChanged) {
    const diff = wordDiff(before, after);
    if (diff && diff.length <= 3900) {
      e.setDescription(`**Changements :** ~~retiré~~ · **ajouté**\n\n${diff}`);
    }
    e.addFields(
      { name: 'Avant', value: clip(escapeMd(before) || '*vide*', 1024) },
      { name: 'Après', value: clip(escapeMd(after) || '*vide*', 1024) },
    );
  }

  e.addFields(
    { name: 'Auteur', value: `<@${author.id}>\n\`${author.id}\``, inline: true },
    { name: 'Salon', value: `<#${msg.channelId}>`, inline: true },
    { name: 'Message', value: `[Aller au message](${msg.url})`, inline: true },
    { name: 'Envoyé', value: `${ts(msg.createdAt)} (${ts(msg.createdAt, 'R')})`, inline: true },
  );

  if (removed.length) {
    const list = removed.map(a => `• ${a.name} (${fmtSize(a.size)})`).join('\n');
    const saved = files.length ? `\n✅ ${files.length} fichier(s) récupéré(s) ci-dessous` : '\n⚠️ Fichiers plus disponibles';
    e.addFields({ name: `Pièces jointes retirées (${removed.length})`, value: (list + saved).slice(0, 1024) });
    const img = files.find(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name || ''));
    if (img) e.setImage(`attachment://${img.name}`);
  }

  // Texte trop long pour l'embed : version complète en fichier
  if (before !== null && (before.length > 1000 || after.length > 1000)) {
    files.push(new AttachmentBuilder(Buffer.from(`--- AVANT ---\n${before}\n\n--- APRÈS ---\n${after}\n`, 'utf8'), { name: `modification-${msg.id}.txt` }));
  }

  return logChannel.send({ embeds: [e], files, allowedMentions: { parse: [] } }).catch(() => {});
}
