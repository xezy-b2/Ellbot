# Corrections apportées au bot

## ⚠️ À faire de ton côté (important)

1. **Change le mot de passe de ta base MongoDB Atlas.** Il était écrit en clair dans `migrate.js`. Mets ensuite la nouvelle URL dans `MONGODB_URI`.
2. **Ne réutilise pas le mot de passe qui était dans `hash.js`** (il était écrit en clair). `hash.js`, `migrate.js` et `passwords.json` ont été supprimés : aucun code ne s'en servait.
3. Ajoute `SESSION_SECRET=` (une longue chaîne aléatoire) dans ton `.env`. Voir `.env.example`.
4. Lance `npm install` : des dépendances ont changé (ajout de `ms`, suppression de paquets inutilisés).
5. Redémarre le bot (`pm2 restart index`).

## 🔴 Failles de sécurité

| Problème | Correction |
|---|---|
| **N'importe quel utilisateur Discord** connecté au dashboard pouvait modifier la config de **n'importe quel serveur** du bot (seule la page d'affichage vérifiait le rôle admin, pas les sauvegardes). Il pouvait aussi faire envoyer des messages (avec `@everyone`) par le bot. | Toutes les routes `/dashboard/:guildId/...` exigent maintenant d'être **administrateur de ce serveur**. |
| `GET /social/test` : un simple lien piégé faisait envoyer une notification par le bot. | Route GET supprimée (POST seulement). |
| Upload d'images : seul le type annoncé par le navigateur était vérifié. On pouvait donc déposer un fichier `.html` servi par le dashboard. | Liste blanche d'extensions (png/jpg/gif/webp). |
| Le chemin d'image de bienvenue venait d'un champ caché modifiable, donc on pouvait lire n'importe quel fichier du disque. | Seuls les chemins sous `uploads/` sont acceptés. |
| `/rr/save` pouvait modifier le panneau d'un autre serveur (recherche par ID sans filtre serveur). | Filtre `guildId` ajouté. |
| Sessions en mémoire, secret par défaut `change-this`. | Sessions stockées dans MongoDB, cookie `httpOnly` + `sameSite`, avertissement si pas de secret. Helmet + limite de requêtes activés (ils étaient installés mais pas utilisés). |
| `/say` permettait de faire pinger `@everyone` par le bot sans en avoir la permission. Les commandes perso (`!xxx`), déclenchables par n'importe qui, pouvaient aussi pinger tout le serveur. | Les mentions sont filtrées. |
| `/rep` illimité : on pouvait mettre -1 en boucle à quelqu'un. | 1 vote par personne cible toutes les 12 h. Impossible de noter un bot. |

## 🟠 Fonctionnalités qui ne marchaient pas

- **Messages de départ jamais envoyés** : `sendGoodbye(member)` au lieu de `sendGoodbye(guild, member)`.
- **Sauvegarder Welcome effaçait Goodbye** (et inversement) : les deux formulaires postaient au même endroit.
- **Titre et couleur Goodbye jamais sauvegardés** : ils manquaient dans le schéma Mongoose.
- **« Mentionner le membre » (welcome) impossible à désactiver.**
- **Logs : la sauvegarde échouait** dès qu'une case était cochée : la valeur `"on"` était refusée par Mongoose.
- **Automod jamais exécuté** : il était appelé dans le gestionnaire des menus déroulants avec une variable `message` inexistante. Les parties anti-liens et anti-spam étaient vides. Il fonctionne maintenant et a un **onglet dans le dashboard**.
- **Messages récurrents jamais envoyés** : la fonction de planification n'était appelée nulle part. Une expression cron invalide est maintenant refusée avec un message clair.
- **Twitch : fuite qui grossissait toutes les 2 minutes.** Le notificateur créait un nouvel intervalle à chaque passage, soit 720 de plus par jour, avec des appels API qui s'accumulaient. Une virgule en trop dans la liste des streamers faisait aussi échouer toute la requête.
- **Classement mensuel** : les rôles exclus étaient ignorés (mauvais chemin dans la config). Les rôles n'étaient jamais attribués au-delà de 100 membres avec XP (limite Discord). La remise à zéro mensuelle n'avait jamais lieu si aucun rôle n'était configuré.
- **Commandes enregistrées mais sans code** (« Commande inconnue ») : `/welcome-preview`, `/xp-delete`, `/xp-card-background`, `/logs-test`, `/reaction-role`. Elles sont maintenant implémentées.
- **Commandes avec du code mais pas enregistrées** : `/avatar`, `/nick`, `/unban`. Elles sont maintenant ajoutées.
- **Modération** : toutes les commandes exigeaient « Gérer le serveur » en plus de leur permission propre, donc un modo avec « Expulser » ne pouvait pas `/kick`.
- **XP** : les messages envoyés pendant le cooldown d'1 min n'étaient pas comptés dans le classement. Les commandes `!ping`, `!restart`… ne répondaient pas si on avait parlé dans la dernière minute.
- **/top et /classement plantaient** si un membre du classement avait supprimé son compte.
- **Carte de rang** : « Rang #1 » était écrit en dur pour tout le monde, le fond par URL ne marchait pas, et un avatar non chargé faisait planter la carte et le message de level-up.
- **Tickets** : le numéro pouvait être attribué en double. Les admins sans le rôle support ne pouvaient pas fermer un ticket.
- **Rôles réaction** : aucune réponse en cas d'erreur, et un rôle trop haut dans la hiérarchie donnait « L'application ne répond pas ».
- **Bouton « réinitialiser le fond XP »** appelait la mauvaise route.
- Logs d'édition : plantage sur les anciens messages (partials).
- Les erreurs dans le dashboard laissaient la requête bloquée au lieu de répondre une erreur.

## 🟡 Modernisation (discord.js 14.22+)

- `ready` → `clientReady`, `ephemeral: true` → `flags: MessageFlags.Ephemeral`, `setDMPermission` → `setContexts`. Ces avertissements de dépréciation remplissaient les logs.
- Intent `GuildPresences` retiré : il n'est pas utilisé et c'est le plus gourmand. `GuildModeration` ajouté, car il est nécessaire pour logger les bans.
- Connexion MongoDB faite **avant** la connexion Discord, avec gestion d'erreur.
- `ms` ajouté à `package.json` : il était utilisé mais pas déclaré. Paquets inutilisés retirés : bcrypt, body-parser, cron, morgan, sanitize-html, uuid et @napi-rs/canvas.

## 📁 Code non utilisé

Déplacé dans `_ancien_code_non_utilise/` (rien ne l'importait) : `socials.js`, `xpSystem.js`, `modules/` (anniversaire, ping, mod), `UserProfile.js`, `messages.js`, `reset classement.txt`.

## ℹ️ Pas encore câblé

- Notifications **YouTube** et **jeux gratuits** (Epic/Steam) : le code existe mais le schéma de config et le dashboard n'ont pas de section pour les activer, donc elles ne s'exécutent pas.
- Le bouton « Message de level-up activé » du dashboard n'a pas d'effet. L'annonce est envoyée dès qu'un salon de level-up est choisi, comme avant, pour ne pas couper tes annonces actuelles.
- `passport-discord` n'est plus maintenu. Il fonctionne encore, mais il faudra le remplacer un jour.
