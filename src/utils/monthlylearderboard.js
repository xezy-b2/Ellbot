// src/utils/monthlylearderboard.js

import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import UserXP from '../models/UserXP.js';
import GuildConfig from '../models/GuildConfig.js';
import generateLeaderboardMonthlyCard from './generateLeaderboardMonthlyCard.js'; // ⬅️ IMPORT MIS À JOUR

const LOG = (...a) => console.log('[LB]', ...a);

/**
 * Envoie le classement mensuel du serveur sous forme de Canvas.
 * NOTE : L'attribution des rôles et la réinitialisation des compteurs sont gérées par assignMonthlyRoles.js
 */
export async function sendMonthlyLeaderboard(client) {
  LOG('Déclenchement de l\'envoi des classements mensuels (Canvas).');
  try {
    const guilds = await GuildConfig.find({ 'monthlyLeaderboard.enabled': true }).lean();

    for (const guildConf of guilds) {
      const guild = client.guilds.cache.get(guildConf.guildId);
      if (!guild) continue;
      
      try {
      const lb = guildConf.monthlyLeaderboard;
      const channel = lb.channelId ? guild.channels.cache.get(lb.channelId) : null;
      if (!channel || !channel.isTextBased()) continue;

      // 1. Gérer les exclusions de rôles
      // AVANT : lb.leaderboardRoles?.excludedRoleIds (chemin inexistant) → les rôles exclus étaient ignorés
      const excludedRoleIds = lb.excludedRoleIds || [];
      await guild.members.fetch().catch(e => LOG(`Erreur fetch membres guilde ${guild.id}: ${e.message}`));
      
      const membersToConsider = guild.members.cache.filter(member => 
        !excludedRoleIds.some(roleId => member.roles.cache.has(roleId))
      );

      // 2. Trouver les meilleurs membres (Top 10)
      const topUsers = await UserXP.find({
        guildId: guild.id,
        userId: { $in: membersToConsider.map(m => m.id) }
      })
      .sort({ monthlyMessages: -1 })
      .limit(10)
      .lean();

      // 3. Enrichir les données avec le Tag et l'Avatar de Discord
      const detailedUsers = await Promise.all(topUsers.map(async (userXP) => {
          const discordUser = await client.users.fetch(userXP.userId).catch(() => null);
          return {
              ...userXP, 
              tag: discordUser ? discordUser.tag : `Utilisateur #${userXP.userId.slice(-4)}`,
              avatarURL: discordUser ? discordUser.displayAvatarURL({ extension: 'png', size: 128 }) : null,
          };
      }));

      // 4. Préparer le nom du mois pour le titre
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const lastMonthName = lastMonth.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

      // 5. Génération du Canvas
      const leaderboardBuffer = await generateLeaderboardMonthlyCard(detailedUsers, lastMonthName); // ⬅️ NOUVEAU NOM
      
      // 6. Envoi du message avec l'image
      const file = new AttachmentBuilder(leaderboardBuffer, { name: 'classement_mensuel.png' });
      
      const contentMessage = lb.monthlyMessage?.trim() || 'Voici le classement du mois !';
      
      await channel.send({
          content: contentMessage,
          files: [file],
          allowedMentions: { parse: ['users', 'roles'] },
      });

      LOG(`Classement mensuel Canvas envoyé dans #${channel.name} (${guild.name}).`);
      } catch (e) {
        // Une erreur sur un serveur ne doit pas empêcher l'envoi sur les autres
        LOG(`Erreur pour la guilde ${guildConf.guildId}:`, e);
      }
    }
  } catch (e) {
    LOG('Erreur critique lors de l\'envoi du classement mensuel:', e);
  }
}