// src/utils/alerts.js
// Envoie les erreurs importantes dans un salon Discord via un webhook.
// Configuration : variable ALERT_WEBHOOK_URL (Paramètres du salon → Intégrations → Webhooks).
// Un webhook fonctionne même si la connexion du bot à Discord est en panne.

const WEBHOOK = process.env.ALERT_WEBHOOK_URL || '';
const VALID = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(WEBHOOK);

const recent = new Map();        // empreinte → dernier envoi (anti-doublon 10 min)
const DEDUPE_MS = 10 * 60 * 1000;
const MAX_PER_HOUR = 15;
let sentTimes = [];

if (WEBHOOK && !VALID) console.warn('[ALERTS] ALERT_WEBHOOK_URL ne ressemble pas à une URL de webhook Discord : alertes désactivées.');

function errorText(err) {
  if (!err) return 'Erreur inconnue';
  if (err instanceof Error) return `${err.name}: ${err.message}\n${(err.stack || '').split('\n').slice(1, 6).join('\n')}`;
  return typeof err === 'string' ? err : JSON.stringify(err, null, 2);
}

async function post(body) {
  if (!VALID) return;
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Alertes du bot', allowed_mentions: { parse: [] }, ...body }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn('[ALERTS] Envoi du webhook impossible :', e.message);
  }
}

/** Signale une erreur (au plus une fois par 10 min pour la même erreur, 15 par heure max). */
export function reportError(context, err) {
  if (!VALID) return;
  const text = errorText(err);
  const key = `${context}|${text.split('\n')[0]}`;
  const now = Date.now();
  if (now - (recent.get(key) || 0) < DEDUPE_MS) return;
  sentTimes = sentTimes.filter(t => now - t < 60 * 60 * 1000);
  if (sentTimes.length >= MAX_PER_HOUR) return;
  recent.set(key, now);
  sentTimes.push(now);
  for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);

  post({
    embeds: [{
      title: `🚨 Erreur : ${String(context).slice(0, 200)}`,
      description: '```\n' + text.slice(0, 3800) + '\n```',
      color: 0xf23f43,
      timestamp: new Date().toISOString(),
    }],
  });
}

/** Message d'information (démarrage, redémarrage…). */
export function reportInfo(title, description = '') {
  post({ embeds: [{ title: String(title).slice(0, 256), description: String(description).slice(0, 4000), color: 0x23a55a, timestamp: new Date().toISOString() }] });
}

export const alertsEnabled = VALID;
