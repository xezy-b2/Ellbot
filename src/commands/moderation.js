// src/commands/moderation.js
import { InteractionType, PermissionsBitField, time, MessageFlags } from 'discord.js';
import ms from 'ms';

const LOG = (...a) => console.log('[MOD]', ...a);

export async function handleModerationInteraction(interaction) {
  if (interaction.type !== InteractionType.ApplicationCommand) return;
  const { commandName } = interaction;
  
  // AVANT : toutes les commandes exigeaient « Gérer le serveur » en plus de leur permission
  // propre → un modérateur avec « Expulser » ne pouvait pas /kick. Chaque commande
  // vérifie maintenant uniquement la permission dont elle a besoin.

  try {
    switch (commandName) {
      case 'clear': {
        const amount = interaction.options.getInteger('amount');
        // 'channel' est optionnel, si non fourni, on utilise le salon actuel
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        
        // --- 1. VÉRIFICATION DES PERMISSIONS ---
        // Vérifie si l'utilisateur peut supprimer des messages dans le salon cible
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
          return interaction.reply({ 
            flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de **Gérer les messages** pour utiliser cette commande.' 
          });
        }
        
        // Vérifie si le BOT peut supprimer des messages
        if (!channel.permissionsFor(interaction.client.user).has(PermissionsBitField.Flags.ManageMessages)) {
          return interaction.reply({ 
            flags: MessageFlags.Ephemeral, content: `❌ Je n'ai pas la permission de **Gérer les messages** dans le salon ${channel}.` 
          });
        }

        // Vérification de la quantité
        if (amount < 1 || amount > 100) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Tu dois entrer un nombre entre **1 et 100**.' });
        }
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Affiche le message de chargement

        try {
          // --- 2. SUPPRESSION ---
          // Discord.js gère la limite de 100 messages max
          const deletedMessages = await channel.bulkDelete(amount, true);
          
          const deletedCount = deletedMessages.size;
          
          // --- 3. CONFIRMATION ---
          await interaction.editReply({ 
            content: `✅ J'ai supprimé **${deletedCount}** message${deletedCount > 1 ? 's' : ''} dans le salon ${channel}.` 
          });

        } catch (e) {
          // Gère l'erreur courante des messages trop anciens (plus de 14 jours)
          if (e.message.includes('older than 14 days')) {
            return interaction.editReply({ content: '⚠️ Impossible de supprimer les messages de plus de 14 jours. Seuls les messages récents peuvent être effacés en masse.' });
          }
          // Gère les autres erreurs
          console.error(`Erreur lors du clear dans ${channel.id}:`, e);
          return interaction.editReply({ content: '❌ Une erreur inconnue est survenue lors de la suppression des messages.' });
        }
        break;
      }
      
      case 'ban': {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'Aucune raison fournie.';

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de bannir des membres.' });
        }
        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je n\'ai pas la permission de bannir des membres.' });
        }
        
        if (user.id === interaction.user.id || user.id === interaction.client.user.id) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Action impossible sur cet utilisateur.' });
        }
        const memberToBan = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (memberToBan && memberToBan.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous ne pouvez pas bannir un membre qui a un rôle égal ou supérieur au vôtre.' });
        }
        if (memberToBan && memberToBan.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je ne peux pas bannir ce membre car son rôle est égal ou supérieur au mien.' });
        }
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await interaction.guild.members.ban(user.id, { 
                reason: reason, 
            });
            await interaction.editReply({ content: `✅ **${user.tag}** a été banni. Raison: **${reason}**` });
        } catch (error) {
            LOG('Erreur lors du bannissement:', error);
            await interaction.editReply({ content: '❌ Une erreur est survenue lors du bannissement.' });
        }
        break;
      }

      case 'kick': {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'Aucune raison fournie.';

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission d\'expulser des membres.' });
        }
        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je n\'ai pas la permission d\'expulser des membres.' });
        }

        const memberToKick = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!memberToKick) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Membre introuvable ou déjà expulsé.' });
        }

        if (memberToKick.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous ne pouvez pas expulser un membre qui a un rôle égal ou supérieur au vôtre.' });
        }
        if (memberToKick.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je ne peux pas expulser ce membre car son rôle est égal ou supérieur au mien.' });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          await memberToKick.kick(reason);
          await interaction.editReply({ content: `✅ **${user.tag}** a été expulsé. Raison: **${reason}**` });
        } catch (error) {
          LOG('Erreur lors de l\'expulsion:', error);
          await interaction.editReply({ content: '❌ Une erreur est survenue lors de l\'expulsion.' });
        }
        break;
      }
      
      case 'unban': {
        const userId = (interaction.options.getString('user_id') || '').trim();
        if (!/^\d{17,20}$/.test(userId)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ ID utilisateur invalide.' });
        }
        const reason = interaction.options.getString('reason') || 'Aucune raison fournie.';

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de débannir des membres.' });
        }
        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je n\'ai pas la permission de débannir des membres.' });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const ban = await interaction.guild.bans.fetch(userId).catch(() => null);

          if (!ban) {
            await interaction.editReply({ content: `❌ L'utilisateur avec l'ID **${userId}** n'est pas banni.` });
            return;
          }

          await interaction.guild.bans.remove(userId, reason);
          await interaction.editReply({ content: `✅ L'utilisateur **${ban.user.tag}** (ID: \`${userId}\`) a été débanni. Raison: **${reason}**` });

        } catch (error) {
          LOG('Erreur lors du débannissement:', error);
          await interaction.editReply({ content: '❌ Une erreur est survenue lors du débannissement.' });
        }
        break;
      }

      case 'timeout': {
        const user = interaction.options.getUser('user', true);
        const durationStr = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason') || 'Aucune raison fournie.';

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de mettre en sourdine des membres.' });
        }
        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je n\'ai pas la permission de mettre en sourdine des membres.' });
        }

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
          await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Membre introuvable.' });
          return;
        }

        // Conversion de la durée en millisecondes
        const durationMs = ms(durationStr);
        if (isNaN(durationMs) || durationMs < 1000 || durationMs > 2419200000) { // max 28 jours (2419200000 ms)
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Durée invalide. Veuillez utiliser un format comme `1h`, `30m`, `5s`. La durée maximale est 28 jours.' });
        }

        // Véfirication de hiérarchie
        if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous ne pouvez pas mettre en sourdine un membre qui a un rôle égal ou supérieur au vôtre.' });
        }
        if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Je ne peux pas mettre en sourdine ce membre car son rôle est égal ou supérieur au mien.' });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          await member.timeout(durationMs, reason);
          const endTime = new Date(Date.now() + durationMs);
          const relativeTime = time(endTime, 'R'); // Affiche le temps écoulé (ex: 'dans 10 minutes')

          await interaction.editReply({ 
            content: `✅ **${user.tag}** a été mis en sourdine pour **${durationStr}** (jusqu'à ${relativeTime}). Raison: **${reason}**` 
          });

        } catch (error) {
          LOG('Erreur lors du timeout:', error);
          await interaction.editReply({ content: '❌ Une erreur est survenue lors du timeout.' });
        }
        break;
      }
      
      case 'untimeout': {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de gérer les timeouts.' });
        }
        const user = interaction.options.getUser('user', true);
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
          await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Membre introuvable.' });
          return;
        }
        if (!member.isCommunicationDisabled()) {
          await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Ce membre n\'est pas actuellement en timeout.' });
          return;
        }
        const ok = await member.timeout(null).then(() => true).catch(() => false);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: ok ? `✅ Timeout retiré pour **${user.tag}**.` : '❌ Impossible de retirer le timeout (hiérarchie des rôles ?).' });
        break;
      }

      case 'slowmode': {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Vous n\'avez pas la permission de gérer les salons.' });
        }
        const channel = interaction.options.getChannel('channel', true);
        const seconds = Math.min(21600, Math.max(0, interaction.options.getInteger('seconds', true)));
        await channel.setRateLimitPerUser(seconds);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `🐢 Le mode lent du salon ${channel} a été mis à **${seconds}** secondes.` });
        break;
      }
      
      default:
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Commande de modération inconnue.' });
        break;
    }
  } catch (e) {
    LOG('Erreur dans le gestionnaire de modération:', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Une erreur est survenue lors de l\'exécution de cette commande.' });
    } else if (interaction.deferred) {
      await interaction.editReply({ content: 'Une erreur est survenue lors de l\'exécution de cette commande.' });
    }
  }
}