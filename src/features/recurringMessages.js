// src/features/recurringMessages.js
import GuildConfig from '../models/GuildConfig.js';
import cron from 'node-cron';

// AVANT : startRecurringMessages() n'était appelée nulle part → les messages
// récurrents configurés dans le dashboard n'étaient jamais envoyés.
// Elle est maintenant lancée au démarrage (scheduler.js) et rechargée à chaque
// ajout/suppression depuis le dashboard.

const scheduledTasks = new Map();

/**
 * (Re)démarre la planification de tous les messages récurrents.
 * @param {import('discord.js').Client} client
 */
export async function startRecurringMessages(client) {
  // Annuler toutes les tâches précédentes
  for (const task of scheduledTasks.values()) {
    try { (task.destroy ?? task.stop).call(task); } catch { /* ignore */ }
  }
  scheduledTasks.clear();

  const configs = await GuildConfig.find({ 'recurringMessages.0': { $exists: true } }).lean();

  for (const config of configs) {
    const guildId = config.guildId;

    for (const msg of config.recurringMessages) {
      if (!msg.cron || !msg.channelId || !msg.content) continue;
      if (!cron.validate(msg.cron)) {
        console.warn(`[RECURRING] Expression cron invalide ignorée (${msg.cron}) pour la guilde ${guildId}`);
        continue;
      }

      try {
        const task = cron.schedule(msg.cron, async () => {
          try {
            // Le salon est résolu à chaque envoi (il peut avoir été recréé entre-temps)
            const guild = client.guilds.cache.get(guildId);
            const channel = guild?.channels.cache.get(msg.channelId);
            if (!channel?.isTextBased?.()) return;
            await channel.send({ content: msg.content });
          } catch (e) {
            console.error(`[RECURRING] Erreur lors de l'envoi du message dans la guilde ${guildId}:`, e.message);
          }
        }, {
          timezone: 'Europe/Paris', // Ajustez à votre fuseau horaire
        });

        scheduledTasks.set(msg.id, task);
      } catch (e) {
        console.error(`[RECURRING] Erreur de planification pour la guilde ${guildId} (message ID: ${msg.id}):`, e.message);
      }
    }
  }

  console.log(`[RECURRING] ${scheduledTasks.size} message(s) récurrent(s) planifié(s).`);
}
