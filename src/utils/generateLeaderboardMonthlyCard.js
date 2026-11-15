import { FONT } from './fonts.js';
// src/utils/generateLeaderboardMonthlyCard.js

import { createCanvas, loadImage } from 'canvas';

// Configuration des dimensions et du style du Canvas
const CANVAS_WIDTH = 900;
const LINE_HEIGHT = 80;
const PADDING_TOP = 100;
const FONT_FAMILY = FONT;

// Fonction utilitaire pour dessiner les avatars ronds
const drawRoundedImage = (ctx, img, x, y, r) => {
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, x, y, r * 2, r * 2);
};

/**
 * Génère un Canvas à partir des données de classement.
 * @param {Array<Object>} detailedUsers - Liste des utilisateurs avec tag et avatarURL.
 * @param {string} monthName - Nom du mois (ex: "Septembre 2025").
 * @returns {Buffer} - Le buffer de l'image PNG.
 */
export default async function generateLeaderboardMonthlyCard(detailedUsers, monthName) {
    // Hauteur dynamique : PADDING_TOP (Titre) + (Nombre d'entrées * Hauteur de ligne) + Marge
    const CANVAS_HEIGHT = PADDING_TOP + (detailedUsers.length * LINE_HEIGHT) + 40; 

    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // --- 1. Fond Global ---
    ctx.fillStyle = '#2c2f33'; 
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // --- 2. Titre ---
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`🏆 CLASSEMENT DU MOIS DE ${monthName.toUpperCase()} 🏆`, CANVAS_WIDTH / 2, 40);

    // --- 3. En-tête de Colonne ---
    ctx.fillStyle = '#8a8a8a'; 
    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('RANG', 30, PADDING_TOP - 20);
    ctx.fillText('UTILISATEUR', 150, PADDING_TOP - 20);
    ctx.textAlign = 'right';
    ctx.fillText('MESSAGES', CANVAS_WIDTH - 30, PADDING_TOP - 20);


    // --- 4. Dessiner chaque entrée ---
    let y = PADDING_TOP;
    for (let i = 0; i < detailedUsers.length; i++) {
        const user = detailedUsers[i];
        const rank = i + 1;

        // a. Ligne de fond (alternée)
        ctx.fillStyle = rank % 2 !== 0 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, y, CANVAS_WIDTH, LINE_HEIGHT);

        // b. Médaille / Rang
        let medal = `#${rank}`;
        let medalColor = '#FFFFFF';
        if (rank === 1) { medal = '🥇'; medalColor = '#FFD700'; } 
        else if (rank === 2) { medal = '🥈'; medalColor = '#C0C0C0'; } 
        else if (rank === 3) { medal = '🥉'; medalColor = '#CD7F32'; } 

        ctx.fillStyle = medalColor;
        ctx.font = `32px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText(rank <= 3 ? medal : `#${rank}`, 60, y + 50);

        // c. Avatar
        const avatarSize = 50;
        const avatarX = 130;
        const avatarY = y + (LINE_HEIGHT - avatarSize) / 2;
        
        ctx.save();
        if (user.avatarURL) {
            try {
                const avatar = await loadImage(user.avatarURL);
                drawRoundedImage(ctx, avatar, avatarX, avatarY, avatarSize / 2);
            } catch (e) {
                // Ignore si l'avatar ne peut pas être chargé
            }
        }
        ctx.restore(); 
        
        // d. Nom de l'utilisateur
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `26px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        let username = user.tag || `Utilisateur #${user.userId.slice(-4)}`;
        
        if (username.length > 25) { 
            username = username.substring(0, 25) + '...';
        }
        ctx.fillText(username, avatarX + avatarSize + 20, y + 50);


        // e. Messages
        ctx.fillStyle = '#65C0FF'; 
        ctx.font = `36px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${user.monthlyMessages}`, CANVAS_WIDTH - 30, y + 50);

        y += LINE_HEIGHT;
    }

    return canvas.toBuffer('image/png');
}