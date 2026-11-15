// src/features/birthdays.js
// Anniversaires : /anniversaire pour enregistrer sa date, annonce automatique le jour J
// (à l'heure choisie dans le dashboard, heure de Paris) et rôle « anniversaire » pour la journée.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import Birthday from '../models/Birthday.js';
import GuildConfig from '../models/GuildConfig.js';
import NotifyState from '../models/NotifyState.js';

const LOG = (...a) => console.log('[ANNIV]', ...a);
const TZ = 'Europe/Paris';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Date et heure actuelles à Paris : { year, month, day, hour, key: 'AAAA-MM-JJ' } */
export function parisNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return { ...parts, key: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (m, y = 2024) => new Date(y, m, 0).getDate();
export const isValidDate = (d, m, y) => Number.isInteger(d) && Number.isInteger(m) && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(m, y || 2024);
export const formatDate = (d, m) => `${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`;

/** Anniversaires du jour (les nés un 29 février sont fêtés le 28 les années non bissextiles). */
async function birthdaysToday(guildId, now) {
  const or = [{ day: now.day, month: now.month }];
  if (now.month === 2 && now.day === 28 && !isLeap(now.year)) or.push({ day: 29, month: 2 });
  return Birthday.find({ guildId, $or: or }).lean();
}

/** Prochains anniversaires (pour /anniversaire liste et le dashboard). */
export async function upcomingBirthdays(guildId, limit = 10) {
  const now = parisNow();
  const all = await Birthday.find({ guildId }).lean();
  const daysUntil = (b) => {
    const today = Date.UTC(now.year, now.month - 1, now.day);
    let next = Date.UTC(now.year, b.month - 1, b.day);
    if (next < today) next = Date.UTC(now.year + 1, b.month - 1, b.day);
    return Math.round((next - today) / 86400000);
  };
  return all.map(b => ({ ...b, inDays: daysUntil(b) })).sort((a, b) => a.inDays - b.inDays).slice(0, limit);
}

function fillMessage(template, userId, age) {
  return (template || '🎂 Joyeux anniversaire {user} ! {age}')
    .replaceAll('{user}', `<@${userId}>`)
    .replaceAll('{age}', age ? `(${age} ans)` : '')
    .trim();
}

/** Annonce les anniversaires d'un serveur pour aujourd'hui. { force } = ignorer « déjà fait aujourd'hui ». */
export async function runBirthdaysForGuild(client, conf, { force = false } = {}) {
  const b = conf.birthdays;
  const guild = client.guilds.cache.get(conf.guildId);
  if (!guild || !b?.enabled) return { ok: false, error: 'disabled' };
  const now = parisNow();

  if (!force) {
    const done = await NotifyState.getLastIds(guild.id, 'birthdays:lastRun');
    if (done.includes(now.key)) return { ok: true, count: 0, skipped: true };
  }

  const list = await birthdaysToday(guild.id, now);
  const celebrants = [];
  for (const entry of list) {
    const member = guild.members.cache.get(entry.userId) || await guild.members.fetch(entry.userId).catch(() => null);
    if (member) celebrants.push({ member, entry });
  }

  // Rôle du jour : retiré à ceux dont ce n'est plus l'anniversaire, donné aux autres
  const role = b.roleId ? guild.roles.cache.get(b.roleId) : null;
  if (role?.editable) {
    const ids = new Set(celebrants.map(c => c.member.id));
    await guild.members.fetch().catch(() => null);
    for (const m of role.members.values()) if (!ids.has(m.id)) await m.roles.remove(role, 'Fin de l\'anniversaire').catch(() => {});
    for (const { member } of celebrants) if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Anniversaire').catch(() => {});
  }

  const channel = b.channelId ? guild.channels.cache.get(b.channelId) : null;
  if (channel?.isTextBased?.()) {
    for (const { member, entry } of celebrants) {
      const age = entry.year ? now.year - entry.year : null;
      const embed = new EmbedBuilder()
        .setColor(0xf47fff)
        .setDescription(fillMessage(b.message, member.id, age))
        .setThumbnail(member.displayAvatarURL({ size: 256 }));
      // Les rôles écrits dans le message sont recopiés au-dessus de l'encadré (sinon Discord ne les notifie pas)
      const roles = [...new Set([...String(b.message || '').matchAll(/<@&(\d{17,20})>/g)].map(m => `<@&${m[1]}>`))];
      await channel.send({ content: [`<@${member.id}>`, ...roles].join(' '), embeds: [embed], allowedMentions: { parse: ['roles'], users: [member.id] } })
        .catch(e => LOG(`Envoi impossible (${guild.name}) :`, e.message));
    }
  }

  if (!force) await NotifyState.upsertLastIds(guild.id, 'birthdays:lastRun', [now.key], 3);
  if (celebrants.length) LOG(`${celebrants.length} anniversaire(s) fêté(s) sur ${guild.name}.`);
  return { ok: true, count: celebrants.length };
}

/** Appelée toutes les heures : chaque serveur est traité une fois par jour, dès l'heure choisie passée. */
export async function runBirthdays(client) {
  const now = parisNow();
  const configs = await GuildConfig.find({ 'birthdays.enabled': true }).lean().maxTimeMS(15000);
  for (const conf of configs) {
    if (now.hour < (conf.birthdays.hour ?? 9)) continue;
    try { await runBirthdaysForGuild(client, conf); } catch (e) { LOG('Erreur :', e.message); }
  }
}

// ---------------- Commande /anniversaire ----------------
export async function handleBirthdayCommand(interaction) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'definir') {
    const day = interaction.options.getInteger('jour', true);
    const month = interaction.options.getInteger('mois', true);
    const year = interaction.options.getInteger('annee');
    const thisYear = parisNow().year;
    if (year && (year < 1900 || year > thisYear - 5)) return interaction.reply({ content: '❌ Année invalide.', ...ephemeral });
    if (!isValidDate(day, month, year)) return interaction.reply({ content: '❌ Cette date n\'existe pas.', ...ephemeral });
    await Birthday.findOneAndUpdate({ guildId, userId: interaction.user.id }, { $set: { day, month, year: year || null } }, { upsert: true });
    return interaction.reply({ content: `🎂 C'est noté : ton anniversaire est le **${formatDate(day, month)}**${year ? ` (${year})` : ''}.`, ...ephemeral });
  }

  if (sub === 'supprimer') {
    const r = await Birthday.deleteOne({ guildId, userId: interaction.user.id });
    return interaction.reply({ content: r.deletedCount ? '🗑️ Ton anniversaire a été supprimé.' : 'Tu n\'avais pas enregistré d\'anniversaire.', ...ephemeral });
  }

  if (sub === 'voir') {
    const user = interaction.options.getUser('membre') || interaction.user;
    const b = await Birthday.findOne({ guildId, userId: user.id }).lean();
    if (!b) return interaction.reply({ content: `${user.id === interaction.user.id ? 'Tu n\'as' : `**${user.username}** n'a`} pas encore enregistré d'anniversaire. Utilise \`/anniversaire definir\`.`, ...ephemeral });
    return interaction.reply({ content: `🎂 L'anniversaire de **${user.username}** est le **${formatDate(b.day, b.month)}**.`, ...ephemeral });
  }

  if (sub === 'liste') {
    const list = await upcomingBirthdays(guildId, 10);
    if (!list.length) return interaction.reply({ content: 'Aucun anniversaire enregistré. Ajoute le tien avec `/anniversaire definir` !', ...ephemeral });
    const lines = list.map(b => `**${formatDate(b.day, b.month)}** — <@${b.userId}>${b.inDays === 0 ? ' 🎉 aujourd\'hui !' : b.inDays === 1 ? ' (demain)' : ` (dans ${b.inDays} jours)`}`);
    const embed = new EmbedBuilder().setColor(0xf47fff).setTitle('🎂 Prochains anniversaires').setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
}
