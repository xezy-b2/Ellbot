// src/features/levelRoles.js
// Rôles de récompense par niveau d'XP (configurés dans le dashboard → XP & niveaux).

/** Récompenses triées par niveau, sans doublon de rôle. */
export function normalizeRewards(rewards = []) {
  const seen = new Set();
  return [...rewards]
    .filter(r => r && r.roleId && Number(r.level) >= 1)
    .map(r => ({ level: Math.floor(Number(r.level)), roleId: String(r.roleId) }))
    .sort((a, b) => a.level - b.level)
    .filter(r => (seen.has(r.roleId) ? false : seen.add(r.roleId)));
}

/**
 * Met les rôles du membre en accord avec son niveau.
 * - stack (par défaut) : il garde tous les rôles des niveaux atteints
 * - sinon : seulement le rôle du plus haut niveau atteint
 * Retourne les rôles ajoutés.
 */
export async function syncLevelRoles(member, level, xpConf = {}) {
  const rewards = normalizeRewards(xpConf.roleRewards);
  if (!member || !rewards.length) return [];
  const stack = xpConf.stackRoles !== false;

  const earned = rewards.filter(r => r.level <= level);
  const wanted = new Set(stack ? earned.map(r => r.roleId) : earned.slice(-1).map(r => r.roleId));
  const allRewardIds = rewards.map(r => r.roleId);

  const manageable = (id) => {
    const role = member.guild.roles.cache.get(id);
    return role && role.editable && !role.managed;
  };

  const toAdd = [...wanted].filter(id => !member.roles.cache.has(id) && manageable(id));
  const toRemove = allRewardIds.filter(id => !wanted.has(id) && member.roles.cache.has(id) && manageable(id));

  try {
    if (toAdd.length) await member.roles.add(toAdd, `Récompense de niveau ${level}`);
    if (toRemove.length) await member.roles.remove(toRemove, `Mise à jour des rôles de niveau (${level})`);
  } catch (e) {
    console.error(`[XP] Rôles de niveau impossibles pour ${member.user?.tag} :`, e.message);
    return [];
  }
  return toAdd;
}
