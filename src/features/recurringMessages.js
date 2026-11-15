// src/features/recurringMessages.js
import GuildConfig from '../models/GuildConfig.js';
import cron from 'node-cron';

export const TIMEZONE = 'Europe/Paris';

// id du message -> tâche planifiée
const scheduledTasks = new Map();

const pad = (n) => String(n).padStart(2, '0');
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Transforme le planning saisi dans le dashboard en expression cron.
 * Retourne { cron, schedule } ou { error: 'code' }.
 */
export function buildSchedule(input = {}) {
  const mode = ['hourly', 'daily', 'weekly', 'monthly', 'custom'].includes(input.mode) ? input.mode : 'daily';
  const timeMatch = String(input.time || '09:00').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const [hh, mm] = timeMatch ? [Number(timeMatch[1]), Number(timeMatch[2])] : [9, 0];
  const time = `${pad(hh)}:${pad(mm)}`;
  const days = [...new Set([].concat(input.days ?? []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const monthDay = Math.min(28, Math.max(1, Number(input.monthDay) || 1));
  const everyHours = Math.min(23, Math.max(1, Number(input.everyHours) || 1));
  const schedule = { mode, time, days, monthDay, everyHours };

  let expr;
  switch (mode) {
    case 'hourly': expr = everyHours === 1 ? `${mm} * * * *` : `${mm} */${everyHours} * * *`; break;
    case 'daily': expr = `${mm} ${hh} * * *`; break;
    case 'weekly':
      if (!days.length) return { error: 'days' };
      expr = `${mm} ${hh} * * ${days.join(',')}`;
      break;
    case 'monthly': expr = `${mm} ${hh} ${monthDay} * *`; break;
    default:
      expr = String(input.cron || '').trim().replace(/\s+/g, ' ');
  }
  if (!expr || !cron.validate(expr)) return { error: 'cron' };
  return { cron: expr, schedule };
}

/**
 * Pour les anciens messages créés avec un cron brut : retrouve le planning
 * correspondant quand c'est un cas simple (chaque jour, semaine, mois, X heures).
 */
export function inferSchedule(msg) {
  if (msg.schedule?.mode && msg.schedule.mode !== 'custom') return msg.schedule;
  const c = String(msg.cron || '').trim().split(/\s+/);
  const base = { mode: 'custom', time: '09:00', days: [], monthDay: 1, everyHours: 1 };
  if (c.length !== 5) return base;
  const [mi, h, dom, mon, dow] = c;
  const isNum = (v, max) => /^\d+$/.test(v) && Number(v) <= max;
  if (!isNum(mi, 59) || mon !== '*') return base;
  if (h === '*' && dom === '*' && dow === '*') return { ...base, mode: 'hourly', time: `00:${pad(mi)}` };
  const every = h.match(/^\*\/(\d+)$/);
  if (every && dom === '*' && dow === '*') return { ...base, mode: 'hourly', time: `00:${pad(mi)}`, everyHours: Number(every[1]) };
  if (!isNum(h, 23)) return base;
  const time = `${pad(h)}:${pad(mi)}`;
  if (dom === '*' && dow === '*') return { ...base, mode: 'daily', time };
  if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) return { ...base, mode: 'weekly', time, days: dow.split(',').map(Number) };
  if (isNum(dom, 28) && Number(dom) >= 1 && dow === '*') return { ...base, mode: 'monthly', time, monthDay: Number(dom) };
  return base;
}

/** Phrase lisible du planning, ex. « Chaque lundi et jeudi à 09:00 ». */
export function describeSchedule(msg) {
  const s = inferSchedule(msg);
  const time = s.time || '09:00';
  switch (s.mode) {
    case 'hourly': {
      const minute = time.split(':')[1] || '00';
      return s.everyHours > 1 ? `Toutes les ${s.everyHours} heures, à la minute ${minute}` : `Toutes les heures, à la minute ${minute}`;
    }
    case 'daily': return `Chaque jour à ${time}`;
    case 'weekly': {
      const names = (s.days || []).map(d => DAY_NAMES[d]);
      if (names.length === 7) return `Chaque jour à ${time}`;
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0];
      return `Chaque ${list} à ${time}`;
    }
    case 'monthly': return `Le ${s.monthDay === 1 ? '1er' : s.monthDay} de chaque mois à ${time}`;
    default: return `Cron personnalisé : ${msg.cron}`;
  }
}

/** Prochain envoi prévu (Date) ou null si en pause / non planifié. */
export function getNextRunFor(id) {
  const task = scheduledTasks.get(id);
  try { return task?.getNextRun?.() || null; } catch { return null; }
}

/**
 * Envoie un message récurrent tout de suite et enregistre la date d'envoi.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function sendRecurringNow(client, guildId, msg) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(msg.channelId);
  if (!channel?.isTextBased?.()) return { ok: false, error: 'channel' };
  try {
    await channel.send({ content: msg.content });
    await GuildConfig.updateOne(
      { guildId, 'recurringMessages.id': msg.id },
      { $set: { 'recurringMessages.$.lastSentAt': new Date() } }
    ).catch(() => {});
    return { ok: true };
  } catch (e) {
    console.error(`[RECURRING] Erreur d'envoi dans la guilde ${guildId}:`, e.message);
    return { ok: false, error: e.code === 50013 || e.code === 50001 ? 'perms' : 'send' };
  }
}

/**
 * (Re)démarre la planification de tous les messages récurrents.
 * Appelée au démarrage et après chaque modification depuis le dashboard.
 * @param {import('discord.js').Client} client
 */
export async function startRecurringMessages(client) {
  for (const task of scheduledTasks.values()) {
    try { (task.destroy ?? task.stop).call(task); } catch { /* ignore */ }
  }
  scheduledTasks.clear();

  console.log('[RECURRING] Chargement des messages récurrents…');
  const configs = await GuildConfig.find({ 'recurringMessages.0': { $exists: true } }).lean().maxTimeMS(15000);

  for (const config of configs) {
    const guildId = config.guildId;

    for (const msg of config.recurringMessages) {
      if (msg.enabled === false) continue; // en pause
      if (!msg.cron || !msg.channelId || !msg.content) continue;
      if (!cron.validate(msg.cron)) {
        console.warn(`[RECURRING] Expression cron invalide ignorée (${msg.cron}) pour la guilde ${guildId}`);
        continue;
      }

      try {
        const task = cron.schedule(msg.cron, () => sendRecurringNow(client, guildId, msg), { timezone: TIMEZONE });
        scheduledTasks.set(msg.id, task);
      } catch (e) {
        console.error(`[RECURRING] Erreur de planification pour la guilde ${guildId} (message ID: ${msg.id}):`, e.message);
      }
    }
  }

  console.log(`[RECURRING] ${scheduledTasks.size} message(s) récurrent(s) planifié(s).`);
}
