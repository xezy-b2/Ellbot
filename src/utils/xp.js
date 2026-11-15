// src/utils/xp.js
export function costForLevel(n) {
  return 5 * n * n + 50 * n + 100; // progression non-linéaire
}

export function levelFromXP(totalXP) {
  let lvl = 0, xp = Math.max(0, totalXP);
  while (true) {
    const cost = costForLevel(lvl);
    if (xp >= cost) { xp -= cost; lvl++; }
    else break;
  }
  return { level: lvl, intoLevel: xp, nextCost: costForLevel(lvl) };
}

export function progressBar(current, max, width = 20) {
  max = Math.max(1, max);
  const ratio = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}
