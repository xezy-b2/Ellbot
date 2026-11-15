import { FONT } from './fonts.js';
import { UPLOADS_DIR } from '../paths.js';
import { createCanvas, loadImage } from 'canvas';
import { levelFromXP } from './xp.js';
import path from 'path';
import fs from 'fs';

// Fonction pour un style plus simple
function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Génère une image de carte de classement pour un utilisateur.
 * @param {import('discord.js').User} user
 * @param {object} doc Le document de la base de données de l'utilisateur.
 * @param {object} options Options supplémentaires.
 * @returns {Promise<Buffer>}
 */
export default async function generateRankCard(user, doc, options = {}) {
  const { guildConfig } = options;
  // Fond perso du membre (/xp-card-background) en priorité, sinon celui du serveur
  const cardBackgroundUrl = doc?.cardBackground || guildConfig?.xp?.cardBackgroundUrl;

  const width = 800;
  const height = 200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // --- Fond de carte ---
  // Accepte : /uploads/xxx.png (upload dashboard) ou une URL http(s)
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, width, height);
  if (cardBackgroundUrl) {
    try {
      let src = null;
      if (/^https?:\/\//i.test(cardBackgroundUrl)) {
        src = cardBackgroundUrl;
      } else {
        const imagePath = path.join(UPLOADS_DIR, path.basename(cardBackgroundUrl));
        if (fs.existsSync(imagePath)) src = imagePath;
        else console.error('[RANK CARD] Fond introuvable :', imagePath);
      }
      if (src) {
        const background = await loadImage(src);
        ctx.drawImage(background, 0, 0, width, height);
      }
    } catch (error) {
      console.error('[RANK CARD] Erreur lors du chargement du fond :', error.message);
    }
  }

  // Fond translucide
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, width, height);


  // Définir une valeur par défaut de 0 si doc.xp est undefined
  const xp = doc?.xp || 0;
  const { level, intoLevel, nextCost } = levelFromXP(xp);

  const username = user.displayName || user.username || 'Utilisateur';
  const levelText = `Niveau ${level}`;
  const xpText = `${intoLevel} / ${nextCost} XP`;
  // AVANT : "Rang: #1" était écrit en dur pour tout le monde
  const rankText = Number.isInteger(options.rank) ? `Rang: #${options.rank}` : '';
  const ratio = nextCost > 0 ? intoLevel / nextCost : 0;

  // --- Informations utilisateur ---
  ctx.font = `30px ${FONT}`;
  ctx.fillStyle = '#e5e7eb';
  ctx.fillText(username, 230, 60);

  // --- Niveau ---
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(levelText, 230, 95);

  // --- Rang et XP ---
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = '#e5e7eb';
  if (rankText) ctx.fillText(rankText, 230, 125);
  ctx.fillText(xpText, 230, 155);

  // Progress Bar
  const barWidth = 550;
  const barHeight = 20;
  const barX = 230;
  const barY = 175;
  
  // Fond de la barre
  ctx.fillStyle = '#555';
  roundedRect(ctx, barX, barY, barWidth, barHeight, 10);
  ctx.fill();

  // Barre de progression
  const progressWidth = barWidth * ratio;
  ctx.fillStyle = '#5865F2';
  roundedRect(ctx, barX, barY, progressWidth, barHeight, 10);
  ctx.fill();

  // Avatar
  // AVANT : si l'avatar ne se chargeait pas, toute la carte plantait (et le message de level-up avec)
  try {
    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 256 }));
    ctx.beginPath();
    ctx.arc(110, height / 2, 80, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 30, height / 2 - 80, 160, 160);
  } catch (e) {
    console.error('[RANK CARD] Avatar non chargé :', e.message);
  }

  return canvas.toBuffer('image/png');
}