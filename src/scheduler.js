import { runSocialNotifications } from './jobs/socialNotifier.js';
import { runFreeGames } from './jobs/freeGames.js';
import { runTwitchNotifier } from './jobs/twitchNotifier.js';
import cron from 'node-cron';
import { sendMonthlyLeaderboard } from './utils/monthlylearderboard.js';
import { assignMonthlyRoles } from './utils/monthlyRoles.js';
import { startRecurringMessages } from './features/recurringMessages.js';
import { reportError } from './utils/alerts.js';
import { runBirthdays } from './features/birthdays.js';

const LOG = (...a) => console.log('[SCHED]', ...a);

let started = false;

/**
 * Lance les tâches de fond :
 * - Social (YouTube) : toutes les 5 minutes
 * - Free Games : toutes les 2 heures
 * - Twitch : géré par runTwitchNotifier (qui a déjà son propre intervalle de 2 min)
 * - Classement mensuel : le 1er du mois à minuit (Paris)
 * - Messages récurrents
 */
export function startSchedulers(client) {
  if (started) return; // évite de tout lancer deux fois
  started = true;

  // Social
  const socialTick = async () => {
    try {
      await runSocialNotifications(client);
    } catch (e) {
      LOG('social error', e.message);
    }
  };
  socialTick();
  setInterval(socialTick, 5 * 60 * 1000);

  // Free games
  const gamesTick = async () => {
    try {
      await runFreeGames(client);
    } catch (e) {
      LOG('games error', e.message);
    }
  };
  gamesTick();
  setInterval(gamesTick, 2 * 60 * 60 * 1000);

  // Twitch
  // AVANT : on appelait runTwitchNotifier toutes les 2 minutes, alors que cette fonction
  // crée elle-même un setInterval de 2 minutes. Résultat : un nouvel intervalle en plus
  // toutes les 2 minutes (720 par jour) → appels à l'API Twitch qui s'accumulent sans fin.
  // On l'appelle maintenant UNE seule fois.
  runTwitchNotifier(client).catch(e => LOG('twitch error', e.message));

  // Messages récurrents (n'étaient jamais démarrés avant)
  startRecurringMessages(client).catch(e => LOG('recurring error', e.message));

  // Anniversaires : vérifié toutes les heures (et au démarrage, pour rattraper un redémarrage)
  const birthdayTick = () => runBirthdays(client).catch(e => { LOG('birthdays error', e.message); reportError('Anniversaires', e); });
  birthdayTick();
  cron.schedule('1 * * * *', birthdayTick, { timezone: 'Europe/Paris' });

  // CLASSEMENT MENSUEL - le 1er de chaque mois à minuit (heure de Paris)
  cron.schedule('0 0 1 * *', async () => {
    LOG('Lancement de la tâche de classement mensuel...');
    try {
      await sendMonthlyLeaderboard(client);
      await assignMonthlyRoles(client); // attribue les rôles puis remet les compteurs à zéro si configuré
      LOG('Tâche de classement mensuel et attribution des rôles terminées avec succès.');
    } catch (e) {
      LOG('Erreur critique lors du classement mensuel:', e);
      reportError('Classement mensuel', e);
    }
  }, {
    timezone: 'Europe/Paris'
  });

  LOG('Les tâches planifiées sont démarrées.');
}
