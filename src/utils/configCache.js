// src/utils/configCache.js
// Petit cache mémoire de la configuration des serveurs.
// AVANT : chaque message envoyé sur Discord déclenchait une lecture MongoDB.
// Le cache est vidé automatiquement à chaque sauvegarde (voir GuildConfig.js),
// donc une modification dans le dashboard est prise en compte immédiatement.
import GuildConfig from '../models/GuildConfig.js';

const TTL = 5 * 60 * 1000;
const cache = new Map(); // guildId -> { value, at }

export async function getGuildConfig(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await GuildConfig.findOne({ guildId }).lean();
  cache.set(guildId, { value, at: Date.now() });
  return value;
}

export function invalidateGuildConfig(guildId) {
  if (guildId) cache.delete(String(guildId));
  else cache.clear();
}
