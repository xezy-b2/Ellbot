import './fonts.js';
// src/utils/generateLeaderboardCard.js
import { createCanvas, loadImage } from 'canvas';
import { levelFromXP } from './xp.js';

// --- CONFIGURATION (Non modifiée) ---
const FONT_FAMILY = '"DejaVu Sans"';
const WIDTH = 900;
const ITEM_HEIGHT = 70;
const PADDING = 20;

// ... (Gestion de la police)

// Couleurs (Design inspiré de Discord)
const COLOR_BG = '#2C2F33'; 
const COLOR_ACCENT = '#5865F2'; 
const COLOR_TEXT = '#FFFFFF';
const COLOR_SUBTEXT = '#B9BBBE';

const MEDALS = ['🥇', '🥈', '🥉'];


/**
 * Génère une carte de classement (Leaderboard) en image.
 * @param {Client} client Le client Discord pour fetcher les utilisateurs.
 * @param {Array<object>} topUsers Liste des documents UserXP triés.
 * @param {string} title Titre du classement.
 * @param {'xp'|'messages'} type Indique la donnée à afficher (xp ou monthlyMessages).
 * @param {string | null} backgroundUrl URL de l'image de fond personnalisée. <-- NOUVEAU PARAMÈTRE
 * @returns {Buffer} Le buffer de l'image générée.
 */
export default async function generateLeaderboardCard(client, topUsers, title, type, backgroundUrl = null) {
    const HEIGHT = 100 + (topUsers.length * ITEM_HEIGHT) + PADDING; 
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    
    // --- 1. Arrière-plan (Image personnalisée ou couleur unie) ---
    if (backgroundUrl) {
        try {
            const background = await loadImage(backgroundUrl);
            // Dessine l'image en fond, en la recouvrant si nécessaire (cover)
            const hRatio = WIDTH / background.width;
            const vRatio = HEIGHT / background.height;
            const ratio = Math.max(hRatio, vRatio);
            
            const centerShiftX = (WIDTH - background.width * ratio) / 2;
            const centerShiftY = (HEIGHT - background.height * ratio) / 2;

            ctx.drawImage(background, 0, 0, background.width, background.height,
                          centerShiftX, centerShiftY, background.width * ratio, background.height * ratio);
            
            // Ajout d'un overlay sombre pour améliorer la lisibilité du texte
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; // 70% de noir semi-transparent
            ctx.fillRect(0, 0, WIDTH, HEIGHT);

        } catch (e) {
            console.error(`[Canvas] Erreur de chargement du fond (${backgroundUrl}):`, e.message);
            // Si l'image échoue, utiliser la couleur par défaut
            ctx.fillStyle = COLOR_BG;
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
        }
    } else {
        // Arrière-plan par défaut
        ctx.fillStyle = COLOR_BG;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // --- 2. Titre et le reste du dessin (inchangé) ---
    // ... (Le reste du code pour dessiner le titre, la ligne de séparation et les entrées du classement)
    
    // ⚠️ Assurez-vous d'avoir conservé le reste de la fonction de la réponse précédente ici !
    
    ctx.font = `36px ${FONT_FAMILY}, sans-serif`;
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText(title, WIDTH / 2, 55);

    // Ligne de séparation sous le titre
    ctx.strokeStyle = COLOR_ACCENT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(PADDING, 75);
    ctx.lineTo(WIDTH - PADDING, 75);
    ctx.stroke();

    // --- 3. Dessin des utilisateurs ---
    let y = 100;

    for (let i = 0; i < topUsers.length; i++) {
        const userDoc = topUsers[i];
        const rank = i + 1;
        
        let valueText = '';
        let subText = '';

        if (type === 'xp') {
            const { level } = levelFromXP(userDoc.xp || 0);
            valueText = `${(userDoc.xp || 0).toLocaleString('fr-FR')} XP`;
            subText = `Niveau ${level}`;
        } else if (type === 'messages') {
            valueText = `${(userDoc.monthlyMessages || 0).toLocaleString('fr-FR')} messages`;
            subText = userDoc.totalMessages ? `Total: ${userDoc.totalMessages.toLocaleString('fr-FR')} messages` : '';
        }

        // AVANT : si l'utilisateur n'existait plus, l'objet de secours n'avait pas
        // displayAvatarURL() → /top et /classement plantaient complètement.
        const user = await client.users.fetch(userDoc.userId).catch(() => null);
        const username = user?.displayName || user?.username || 'Utilisateur inconnu';
        const avatarUrl = user ? user.displayAvatarURL({ extension: 'png', size: 64 }) : 'https://cdn.discordapp.com/embed/avatars/0.png';


        // --- A. Ombrage de la ligne (Alterné) ---
        ctx.fillStyle = rank % 2 === 0 ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(0, y, WIDTH, ITEM_HEIGHT);


        // --- B. Rang et Médaille ---
        const rankX = PADDING + 10;
        ctx.fillStyle = MEDALS[i] ? COLOR_TEXT : COLOR_SUBTEXT;
        ctx.font = `24px ${FONT_FAMILY}, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(MEDALS[i] || `#${rank}`, rankX, y + 45);


        // --- C. Avatar (avec masquage circulaire) ---
        try {
            const avatar = await loadImage(avatarUrl);
            const avatarSize = 50;
            const avatarX = rankX + 70;
            const avatarY = y + (ITEM_HEIGHT - avatarSize) / 2; 

            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
        } catch (e) {
            // Placeholder si l'avatar ne charge pas
            ctx.fillStyle = COLOR_SUBTEXT;
            ctx.fillRect(rankX + 70, y + 10, 50, 50);
        }


        // --- D. Nom de l'utilisateur ---
        const nameX = rankX + 70 + 60;
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `24px ${FONT_FAMILY}, sans-serif`;
        ctx.textAlign = 'left';
        
        const maxNameWidth = WIDTH - nameX - 300; 
        let displayedName = username;
        if (ctx.measureText(username).width > maxNameWidth) {
            displayedName = username.substring(0, 20) + '...'; 
        }
        ctx.fillText(displayedName, nameX, y + 35);


        // --- E. Valeur principale (XP ou Messages) ---
        ctx.fillStyle = COLOR_ACCENT;
        ctx.font = `26px ${FONT_FAMILY}, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(valueText, WIDTH - PADDING, y + 35);


        // --- F. Sous-valeur (Niveau ou Total Messages) ---
        if (subText) {
            ctx.fillStyle = COLOR_SUBTEXT;
            ctx.font = `18px ${FONT_FAMILY}, sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(subText, WIDTH - PADDING, y + 55);
        }

        y += ITEM_HEIGHT;
    }

    return canvas.toBuffer('image/png');
}