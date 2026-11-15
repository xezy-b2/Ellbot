// src/utils/monthlyRoles.js
import GuildConfig from '../models/GuildConfig.js';
import UserXP from '../models/UserXP.js';

const LOG = (...a) => console.log('[MONTHLY-ROLES]', ...a);

/**
 * Attribue des rôles aux meilleurs membres du mois et réinitialise l'XP mensuel.
 */
export async function assignMonthlyRoles(client) {
  LOG('Déclenchement de l\'attribution des rôles mensuels.');
  
  const guilds = await GuildConfig.find({ 'monthlyLeaderboard.enabled': true }).lean();

  for (const guildConf of guilds) {
    const guildId = guildConf.guildId;
    const lbConfig = guildConf.monthlyLeaderboard || {};
    const { topRoleIds, excludedRoleIds } = lbConfig;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      LOG(`Guilde ${guildId} introuvable.`);
      continue;
    }

    // AVANT : s'il n'y avait aucun rôle configuré (ou aucun membre récupéré), on faisait
    // `continue` et la remise à zéro mensuelle n'avait JAMAIS lieu.
    const hasRoles = Object.values(topRoleIds || {}).some(Boolean);

    try {
      if (!hasRoles) {
        LOG(`Aucun rôle de classement mensuel configuré pour ${guild.name}.`);
      } else {
      // 1. Récupération des Top Users potentiels de la BDD (Même ceux qui pourraient être exclus)
      const allUsersXP = await UserXP.find({ guildId }).lean();
      
      // Récupérer uniquement les IDs des membres qui ont potentiellement un rôle à retirer/attribuer
      const relevantUserIds = allUsersXP.map(doc => doc.userId);
      
      // 2. Fetch ciblé des membres pertinents
      // Au lieu de fetcher TOUS les membres, nous fetchons uniquement ceux qui ont une entrée UserXP.
      // Cela évite l'erreur de timeout sur les très grandes guildes.
      // AVANT : fetch({ user: [...] }) échoue au-delà de 100 IDs (limite Discord) → aucun rôle
      // n'était attribué sur un serveur actif. On récupère tous les membres puis on filtre.
      await guild.members.fetch().catch(e => LOG(`Erreur fetch membres ${guild.name}:`, e.message));
      const relevantIdSet = new Set(relevantUserIds);
      const relevantMembersCollection = guild.members.cache.filter(m => relevantIdSet.has(m.id));
      
      if (relevantMembersCollection.size === 0) {
          LOG(`Aucun membre pertinent (avec XP) n'a pu être récupéré pour ${guild.name}.`);
      } else {
      
      // 3. Filtrer les membres éligibles (ceux qui ne sont pas exclus)
      const eligibleMembers = relevantMembersCollection.filter(member => 
        !excludedRoleIds?.some(roleId => member.roles.cache.has(roleId))
      );
      
      const eligibleUserIds = [...eligibleMembers.keys()];

      // 4. Trouver les Top Users définitifs parmi les éligibles
      const topUsers = allUsersXP
        .filter(userDoc => eligibleUserIds.includes(userDoc.userId)) // On filtre ceux qui sont éligibles
        .sort((a, b) => b.monthlyMessages - a.monthlyMessages)
        .slice(0, 10); // On garde les 10 meilleurs
      
      // Mappage des rôles configurés (1-3, 4-6, 7-8)
      const roleMapping = topRoleIds; 
      const allMonthlyRoles = Object.values(roleMapping).filter(Boolean); // IDs des rôles à retirer
      
      // 5. Retirer TOUS les anciens rôles mensuels aux membres pertinents éligibles
      // On retire seulement aux membres que nous avons récupérés (relevantMembersCollection)
      LOG(`Retrait des ${allMonthlyRoles.length} rôles pour ${eligibleMembers.size} membres dans ${guild.name}...`);
      for (const member of eligibleMembers.values()) {
        if (!member.roles) continue;
        // On n'appelle l'API que si le membre a vraiment un de ces rôles (évite des centaines de requêtes inutiles)
        const toRemove = allMonthlyRoles.filter(r => member.roles.cache.has(r));
        if (!toRemove.length) continue;
        await member.roles.remove(toRemove).catch(e => {
            if (e.code === 50013) {
                 LOG(`ATTENTION: Le bot n'a pas la permission de retirer un rôle à ${member.user.tag} dans ${guild.name}. Vérifiez la HIÉRARCHIE !`);
            }
        });
      }

      // 6. Attribuer les nouveaux rôles aux meilleurs membres
      LOG(`Attribution des rôles aux ${topUsers.length} meilleurs membres dans ${guild.name}...`);
      for (let i = 0; i < topUsers.length; i++) {
        const userDoc = topUsers[i];
        // Nous récupérons le membre depuis la collection ciblée
        const member = relevantMembersCollection.get(userDoc.userId); 
        
        if (!member || !member.roles) continue;

        const rank = i + 1;
        let roleToAssign = null;
        
        // Logique de rang (Utilisation du mapping 1-3, 4-6, 7-8)
        if (rank >= 1 && rank <= 3) {
          roleToAssign = roleMapping['1-3'];
        } else if (rank >= 4 && rank <= 6) {
          roleToAssign = roleMapping['4-6'];
        } else if (rank >= 7 && rank <= 8) {
          roleToAssign = roleMapping['7-8'];
        }
        
        if (roleToAssign) {
          await member.roles.add(roleToAssign).catch(e => {
            if (e.code === 50013) {
                LOG(`ÉCHEC RÔLE: Le bot n'a pas pu attribuer le rôle ${roleToAssign} à ${member.user.tag} (Rang ${rank}) dans ${guild.name}.`);
                LOG(`  SOLUTION: Le rôle du bot DOIT être positionné au-dessus du rôle cible dans la hiérarchie Discord.`);
            } else {
                LOG(`Erreur inconnue lors de l'attribution du rôle ${roleToAssign} à ${member.user.tag}:`, e.message);
            }
          });
        }
      }

      } // fin else (membres récupérés)
      } // fin else (rôles configurés)

      // 7. Réinitialiser les compteurs (Si configuré)
      if (lbConfig.resetXPOnEnd) {
        // On réinitialise tous les utilisateurs de la guilde, y compris ceux qui sont exclus
        await UserXP.updateMany({ guildId }, { $set: { monthlyMessages: 0 } });
        LOG(`Compteurs mensuels réinitialisés pour ${guild.name}.`);
      } else {
        LOG(`La réinitialisation des compteurs est désactivée pour ${guild.name}.`);
      }

      LOG(`Attribution des rôles et réinitialisation terminées pour ${guild.name}.`);

    } catch (e) {
      LOG(`Erreur fatale lors du traitement de la guilde ${guild.name || guildId}:`, e);
    }
  }
}