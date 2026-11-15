// src/commands/register.js
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType } from 'discord.js';

export const coreCommands = [
  new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes principales.'),
  new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot.'),
  new SlashCommandBuilder().setName('server').setDescription('Affiche les informations sur le serveur.'),

  // Ajoutez ceci dans coreCommands dans src/commands/register.js
new SlashCommandBuilder()
  .setName('pfc')
  .setDescription('Défie un membre à Pierre-Feuille-Ciseaux.')
  .addUserOption(opt => 
    opt.setName('adversaire')
       .setDescription('Le membre que vous voulez défier.')
       .setRequired(true)
  ),
  
  // Commande /user
  new SlashCommandBuilder()
    .setName('user')
    .setDescription('Affiche les informations sur un utilisateur.')
    .addUserOption(opt => opt.setName('membre').setDescription('L\'utilisateur dont vous voulez voir les informations.').setRequired(false)),
    
  new SlashCommandBuilder().setName('say').setDescription('Fait dire quelque chose au bot.').addStringOption(opt => opt.setName('message').setDescription('Le message que le bot doit dire.').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  
  // ⭐ COMMANDE /embed MISE À JOUR AVEC AUTEUR ET ICÔNES DE FOOTER
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Envoie un embed personnalisé (version simple).')
    .addStringOption(opt => opt.setName('description').setDescription('Description du message.').setRequired(true))
    .addStringOption(opt => opt.setName('titre').setDescription('Titre du message.'))
    .addStringOption(opt => opt.setName('couleur').setDescription('Couleur de l\'embed (ex: #FF0000)').setRequired(false))
    // NOUVEAU: Auteur
    .addStringOption(opt => opt.setName('auteur_nom').setDescription('Nom affiché comme auteur de l\'embed.').setRequired(false))
    .addStringOption(opt => opt.setName('auteur_icone').setDescription('URL de l\'icône de l\'auteur.').setRequired(false))
    // MISE À JOUR: Footer avec support d'icône
    .addStringOption(opt => opt.setName('footer').setDescription('Texte du bas de page.').setRequired(false))
    .addStringOption(opt => opt.setName('footer_icone').setDescription('URL de l\'icône du pied de page.').setRequired(false))
    // Options existantes
    .addStringOption(opt => opt.setName('image').setDescription('URL de l\'image principale.').setRequired(false))
    .addStringOption(opt => opt.setName('miniature').setDescription('URL de la miniature.').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  // ⭐ NOUVELLE COMMANDE /embed-modal AVEC OPTION SALON OBLIGATOIRE
  new SlashCommandBuilder()
    .setName('embed-modal')
    .setDescription('Ouvre un formulaire modal pour créer et envoyer un embed avancé.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(opt => 
        opt.setName('salon')
           .setDescription('Le salon où l\'embed sera envoyé.')
           .addChannelTypes(ChannelType.GuildText) // S'assure que c'est un salon textuel
           .setRequired(true)
    ), 

  new SlashCommandBuilder().setName('cat-gif').setDescription('Envoie un GIF aléatoire de chat.'),
  // Commandes de Classement (Canvas)
  new SlashCommandBuilder().setName('rank').setDescription('Affiche votre niveau et votre XP (Image Canvas).').addUserOption(opt => opt.setName('membre').setDescription('L\'utilisateur dont vous voulez voir le rang.').setRequired(false)),
  new SlashCommandBuilder().setName('top').setDescription('Affiche le classement des membres par XP (Image Canvas).'),
  new SlashCommandBuilder().setName('classement').setDescription('Affiche le classement des membres par messages envoyés (Image Canvas).'),
  
  // Commande Reputation
  new SlashCommandBuilder()
    .setName('rep') 
    .setDescription('Donne un point de réputation (positif ou négatif) à un membre.')
    .addUserOption(opt => 
        opt.setName('membre')
           .setDescription('Le membre à qui donner de la réputation.')
           .setRequired(true)
    )
    .addStringOption(opt => 
        opt.setName('type') 
           .setDescription('Le type de réputation à donner.')
           .setRequired(true)
           .addChoices(
               { name: 'Positif (+1)', value: 'POSITIVE' },
               { name: 'Négatif (-1)', value: 'NEGATIVE' }
           )
    )
    .addStringOption(opt => 
        opt.setName('raison')
           .setDescription('La raison de la réputation (ex: "Échange parfait" ou "Arnaque").')
           .setRequired(false)
    ),
    
  // Commandes Administratives XP
  new SlashCommandBuilder()
    .setName('xp-init')
    .setDescription('Ajoute un membre manquant à la base de données XP.')
    .addUserOption(opt => 
        opt.setName('membre')
           .setDescription('Le membre à ajouter à la base de données XP.')
           .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  new SlashCommandBuilder()
    .setName('xp-delete')
    .setDescription('Supprime l\'entrée XP d\'un membre pour le réinitialiser ou corriger un bug.')
    .addUserOption(opt => 
        opt.setName('membre')
           .setDescription('Le membre à supprimer de la base de données XP.')
           .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Autres Commandes de gestion XP (Admin)
  new SlashCommandBuilder()
    .setName('xp-set')
    .setDescription('Définit l\'XP d\'un membre (Admin).')
    .addUserOption(opt => opt.setName('membre').setDescription('Le membre dont l\'XP sera modifié.').setRequired(true))
    .addIntegerOption(opt => opt.setName('montant').setDescription('Le nouveau montant d\'XP.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('xp-add')
    .setDescription('Ajoute de l\'XP à un membre (Admin).')
    .addUserOption(opt => opt.setName('membre').setDescription('Le membre à qui ajouter l\'XP.').setRequired(true))
    .addIntegerOption(opt => opt.setName('montant').setDescription('Le montant d\'XP à ajouter (peut être négatif).').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('xp-simulate')
    .setDescription('Simule un gain d\'XP pour afficher la carte de rang.')
    .addUserOption(opt => opt.setName('membre').setDescription('Le membre à simuler.').setRequired(true))
    .addIntegerOption(opt => opt.setName('points').setDescription('Les points d\'XP simulés à ajouter à la carte.').setRequired(true)),
  new SlashCommandBuilder().setName('xp-role-rewards').setDescription('Affiche la liste des rôles de récompense par niveau.'),
  new SlashCommandBuilder().setName('xp-card-background').setDescription('Définit l\'image de fond de ta carte de rang (URL).')
    .addStringOption(opt => 
        opt.setName('url')
            .setDescription('URL de l\'image de fond (laisser vide pour réinitialiser).')
            .setRequired(false)
    ),
  
  // Commandes d'administration générale (retrouvées dans votre code ou logiques)
  new SlashCommandBuilder().setName('welcome-preview').setDescription('Affiche un aperçu du panneau de bienvenue.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(opt => opt.setName('salon').setDescription('Le salon où envoyer l\'aperçu.').addChannelTypes(ChannelType.GuildText).setRequired(false)),
  new SlashCommandBuilder().setName('logs-test').setDescription('Envoie un message de test au salon de logs configuré.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('anniversaire').setDescription('Gère ton anniversaire sur le serveur.')
    .addSubcommand(sc => sc.setName('definir').setDescription('Enregistre ta date d\'anniversaire.')
      .addIntegerOption(o => o.setName('jour').setDescription('Jour (1 à 31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption(o => o.setName('mois').setDescription('Mois').setRequired(true)
        .addChoices(...['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'].map((name, i) => ({ name, value: i + 1 }))))
      .addIntegerOption(o => o.setName('annee').setDescription('Année de naissance (facultatif, pour afficher ton âge)').setRequired(false)))
    .addSubcommand(sc => sc.setName('voir').setDescription('Affiche l\'anniversaire d\'un membre.')
      .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut).').setRequired(false)))
    .addSubcommand(sc => sc.setName('liste').setDescription('Affiche les prochains anniversaires du serveur.'))
    .addSubcommand(sc => sc.setName('supprimer').setDescription('Supprime ton anniversaire.')),

  // Ces deux commandes avaient un code mais n'étaient pas enregistrées auprès de Discord
  new SlashCommandBuilder().setName('avatar').setDescription('Affiche l\'avatar d\'un utilisateur.')
    .addUserOption(opt => opt.setName('cible').setDescription('L\'utilisateur.').setRequired(false)),
  new SlashCommandBuilder().setName('nick').setDescription('Change (ou réinitialise) le surnom d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Le membre.').setRequired(true))
    .addStringOption(opt => opt.setName('surnom').setDescription('Nouveau surnom (vide = réinitialiser).').setRequired(false).setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

// setDMPermission est déprécié → setContexts(Guild)
].map(c => c.setContexts(InteractionContextType.Guild));


export const moderationCommands = [
  new SlashCommandBuilder().setName('kick').setDescription('Expulse un membre.').addUserOption(opt => opt.setName('user').setDescription('Le membre à expulser.').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('La raison de l\'expulsion.').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('ban').setDescription('Bannit un membre.').addUserOption(opt => opt.setName('user').setDescription('Le membre à bannir.').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('La raison du bannissement.').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('timeout').setDescription('Met un membre en timeout.').addUserOption(opt => opt.setName('user').setDescription('Le membre à mettre en timeout.').setRequired(true)).addStringOption(opt => opt.setName('duration').setDescription('Durée du timeout (ex: 10m, 1h, 1d).').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('La raison du timeout.').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('untimeout').setDescription('Retire le timeout d\'un membre.').addUserOption(opt => opt.setName('user').setDescription('Le membre dont le timeout doit être retiré.').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('clear').setDescription('Supprime un nombre spécifié de messages.').addIntegerOption(opt => opt.setName('amount').setDescription('Nombre de messages à supprimer (max 100).').setRequired(true).setMinValue(1).setMaxValue(100)).addChannelOption(opt => opt.setName('channel').setDescription('Le salon où supprimer les messages (laisser vide pour le salon actuel).').addChannelTypes(ChannelType.GuildText).setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('unban').setDescription('Débannit un utilisateur.').addStringOption(opt => opt.setName('user_id').setDescription('ID de l\'utilisateur à débannir.').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('La raison.').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('slowmode').setDescription('Définit le mode lent d\'un salon.').addChannelOption(opt => opt.setName('channel').setDescription('Le salon à modifier.').addChannelTypes(ChannelType.GuildText).setRequired(true)).addIntegerOption(opt => opt.setName('seconds').setDescription('Durée du mode lent en secondes (0 pour désactiver).').setRequired(true).setMinValue(0).setMaxValue(21600)).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map(c => c.setContexts(InteractionContextType.Guild));

export const reactionRoleCommand = new SlashCommandBuilder().setName('reaction-role').setDescription('Configure un message de réactions pour attribuer des rôles.').addStringOption(opt => opt.setName('titre').setDescription('Titre du message').setRequired(true)).addStringOption(opt => opt.setName('description').setDescription('Description du message').setRequired(true)).addChannelOption(opt => opt.setName('salon').setDescription('Salon où envoyer le message').setRequired(true).addChannelTypes(ChannelType.GuildText)).addStringOption(opt => opt.setName('rôles').setDescription('Liste des rôles (ex: 🚀=@Rôle1, 🌟=@Rôle2)').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setContexts(InteractionContextType.Guild);

const allCommands = [
  ...coreCommands,
  ...moderationCommands,
  reactionRoleCommand
];

export const registerApplicationCommands = async (client) => {
  const rest = new REST().setToken(client.token);
  try {
    console.log('[CMDS] Démarrage du rafraîchissement des (/) commandes.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: allCommands.map(cmd => cmd.toJSON()) },
    );
    console.log('[CMDS] Les (/) commandes ont été rafraîchies avec succès.');
  } catch (error) {
    console.error('[CMDS] Erreur lors du rafraîchissement des commandes:', error);
  }
};
