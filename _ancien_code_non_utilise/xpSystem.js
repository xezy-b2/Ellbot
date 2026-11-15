import UserXP from '../models/UserXP.js';
import { levelFromXP } from '../utils/xp.js';
import { AttachmentBuilder } from 'discord.js';
import generateRankCard from '../utils/generateRankCard.js';

const COOLDOWN = 60 * 1000; // 1 minute
const XP_PER_MESSAGE = 3;
const LOG = (...a) => console.log('[XP]', ...a);

export async function giveXP(message) {
  if (message.author.bot || !message.guild) return;

  try {
    const author = message.author;
    const guildId = message.guild.id;

    let userXP = await UserXP.findOne({ guildId, userId: author.id });
    const now = Date.now();

    if (!userXP) {
      userXP = new UserXP({ guildId, userId: author.id, xp: XP_PER_MESSAGE });
      await userXP.save();
      return;
    }

    // Vérifie le cooldown
    if (userXP.lastMessageAt && now - userXP.lastMessageAt < COOLDOWN) {
      return;
    }

    const oldLevel = levelFromXP(userXP.xp).level;

    userXP.xp += XP_PER_MESSAGE;
    userXP.lastMessageAt = now;
    await userXP.save();

    const newLevel = levelFromXP(userXP.xp).level;

    if (newLevel > oldLevel) {
      LOG(`${author.tag} est passé au niveau ${newLevel} !`);

      // Utilise le document mis à jour directement
      const imageBuffer = await generateRankCard(author, userXP.toObject());
      const file = new AttachmentBuilder(imageBuffer, { name: 'level-up.png' });
      
      message.channel.send({
        content: `Félicitations, ${author} ! Tu es maintenant au niveau **${newLevel}** ! 🎉`,
        files: [file]
      });
    }

  } catch (e) {
    LOG('Erreur lors de l’attribution d’XP:', e);
  }
}
