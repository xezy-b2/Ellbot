// src/models/GuildConfig.js
import mongoose from 'mongoose';

// Schema pour les règles d'auto-modération (spam, mots interdits, liens)
const AutomodSchema = new mongoose.Schema({
  // Statut général
  enabled: { type: Boolean, default: false },

  // Anti-Spam (messages rapides)
  antiSpam: {
    enabled: { type: Boolean, default: false },
    limit: { type: Number, default: 5 }, // Max messages
    timeframe: { type: Number, default: 7 }, // En secondes
    action: { type: String, enum: ['none', 'warn', 'mute', 'kick'], default: 'warn' },
    punishmentTime: { type: Number, default: 600 } // Durée du mute en secondes (10 minutes par défaut)
  },

  // Filtre de mots interdits
  badWords: {
    enabled: { type: Boolean, default: false },
    list: { type: [String], default: [] }, // Liste des mots ou expressions interdites
    action: { type: String, enum: ['delete', 'delete_warn', 'mute', 'kick'], default: 'delete_warn' },
  },

  // Anti-Liens/Anti-Invitations
  antiLinks: {
    enabled: { type: Boolean, default: false },
    allowInvites: { type: Boolean, default: false }, // Autoriser les invitations Discord
    allowedDomains: { type: [String], default: [] } // Domaines à mettre en liste blanche
  },
  
  // Paramètres généraux
  ignoredChannels: { type: [String], default: [] }, // Canaux ignorés par l'automod
  ignoredRoles: { type: [String], default: [] },     // Rôles ignorés par l'automod
  modLogChannelId: { type: String, default: null }, // Canal pour les logs de modération automatiques

}, { _id: false });


const CustomCommandSchema = new mongoose.Schema({
  name: { type: String, required: true },
  response: { type: String, default: '' }
}, { _id: false });

const RecurringMessageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  channelId: { type: String, default: '' },
  cron: { type: String, default: '' },
  content: { type: String, default: '' },
  // Planning tel que saisi dans le dashboard (pour pouvoir le modifier facilement)
  schedule: {
    mode: { type: String, enum: ['hourly', 'daily', 'weekly', 'monthly', 'custom'], default: 'custom' },
    time: { type: String, default: '09:00' },       // HH:MM (heure de Paris)
    days: { type: [Number], default: [] },          // 0 = dimanche … 6 = samedi
    monthDay: { type: Number, default: 1 },         // 1 à 28
    everyHours: { type: Number, default: 1 },       // 1 à 23
  },
  enabled: { type: Boolean, default: true },
  lastSentAt: { type: Date, default: null },
  // Boutons-liens affichés sous le message (5 max)
  buttons: {
    type: [new mongoose.Schema({
      label: { type: String, default: '' },
      url: { type: String, default: '' },
      emoji: { type: String, default: '' },
    }, { _id: false })],
    default: [],
  },
  // Présentation en encadré (embed) au lieu d'un simple texte
  embed: {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: '' },
    color: { type: String, default: '#5865F2' },
    imageUrl: { type: String, default: '' },
  },
}, { _id: false });

const WelcomeSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: '' },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  color: { type: String, default: '#5865F2' },
  imageSourceType: { type: String, enum: ['none', 'url', 'upload'], default: 'none' },
  imageUrl: { type: String, default: '' },
  uploadedImagePath: { type: String, default: '' },
  overlayWelcomeText: { type: Boolean, default: true },
  overlayTextShadow: { type: Boolean, default: true },
  overlayTextColor: { type: String, default: '#FFFFFF' },
  showAvatarOnImage: { type: Boolean, default: true },
  pingEveryone: { type: Boolean, default: false },
  pingUser: { type: Boolean, default: true },
  deleteAfterMinutes: { type: Number, default: 0 }
}, { _id: false });

const GoodbyeSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: '' },
  // AVANT : title et color étaient envoyés par le dashboard mais absents du schéma
  // → Mongoose les jetait silencieusement.
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  color: { type: String, default: '#E74C3C' }
}, { _id: false });

// src/models/GuildConfig.js

const XpSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  levelUpMessageEnabled: { type: Boolean, default: false },
  levelUpMessage: { type: String, default: 'Félicitations, {user.mention} ! Tu es maintenant au niveau **{level}** ! 🎉' },
  // CORRECTION ESSENTIELLE : Ajout du champ 'role'
  role: { type: String, default: '' },
  // CORRECTION ESSENTIELLE : Le nom du champ doit être 'messageChannelId' pour correspondre à votre server.js
  messageChannelId: { type: String, default: '' },
  cardBackgroundUrl: { type: String, default: '' },
  // Annoncer les passages de niveau. Non défini = comportement d'origine (annonce seulement si un salon est choisi)
  announceLevelUp: { type: Boolean },
  // Rôles donnés automatiquement en atteignant un niveau
  roleRewards: {
    type: [new mongoose.Schema({ level: { type: Number, required: true }, roleId: { type: String, required: true } }, { _id: false })],
    default: [],
  },
  stackRoles: { type: Boolean, default: true }, // garder les rôles des niveaux précédents
}, { _id: false });


// Remplacez le schéma MonthlyLeaderboardSchema par celui-ci
const MonthlyLeaderboardSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: null },
  monthlyMessage: { type: String, default: '' },
  excludedRoleIds: { type: [String], default: [] },
  resetXPOnEnd: { type: Boolean, default: false },
  topRoleIds: {
    '1-3': { type: String, default: null },
    '4-6': { type: String, default: null },
    '7-8': { type: String, default: null },
  },
    // 🎨 NOUVEAU CHAMP POUR LE FOND PERSONNALISÉ
    backgroundUrl: { type: String, default: null }, 
}, { _id: false });

const SocialYouTubeSchema = new mongoose.Schema({
  channelId: { type: String, default: '' },
  lastVideoId: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
  channelToSend: { type: String, default: '' },
}, { _id: false });

const SocialStoreSchema = new mongoose.Schema({
  lastUpdateId: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
  channelToSend: { type: String, default: '' }
}, { _id: false });

// src/models/GuildConfig.js

const SocialSchema = new mongoose.Schema({
  twitch: {
    enabled: { type: Boolean, default: false },
    // CORRECTION : Le champ 'channelName' n'est pas utilisé par la route,
    // mais le champ 'usernames' est nécessaire.
    usernames: { type: [String], default: [] },
    channelId: { type: String, default: '' },
    message: { type: String, default: '' },
    embedColor: { type: String, default: '#5865F2' },
    pingEveryone: { type: Boolean, default: false },
  },
  youtube: {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: '' },  // salon Discord d'annonce
    channels: {                                 // chaînes YouTube suivies
      type: [new mongoose.Schema({ id: String, name: String }, { _id: false })],
      default: [],
    },
    message: { type: String, default: '' },
    pingEveryone: { type: Boolean, default: false },
  },
  store: {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: '' },
    providers: { type: [String], default: ['epic'] }, // 'epic', 'steam'
    message: { type: String, default: '' },
    pingEveryone: { type: Boolean, default: false },
  },
}, { _id: false });

const LogsSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: '' },
  joins: { type: Boolean, default: false },
  leaves: { type: Boolean, default: false },
  roleChange: { type: Boolean, default: false },
  messageEdited: { type: Boolean, default: false },
  messageDeleted: { type: Boolean, default: false },
  voice: { type: Boolean, default: false },
  bans: { type: Boolean, default: false },
  memberUpdates: { type: Boolean, default: false }
}, { _id: false });

// Correction : Ajout du schéma du message du panel de tickets
const PanelMessageSchema = new mongoose.Schema({
    title: { type: String, default: '' },
    description: { type: String, default: '' },
}, { _id: false });

// Message affiché DANS le ticket. Vide = « Ticket #N » + texte d'accueil par défaut.
// (avant, il reprenait par erreur le texte du panneau d'ouverture)
const WelcomeMessageSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
}, { _id: false });

const TicketSystemSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: '' },
  supportRoleId: { type: String, default: '' },
  categoryId: { type: String, default: '' },
  logChannelId: { type: String, default: '' },
  panelMessage: { type: PanelMessageSchema, default: () => ({}) },
  welcomeMessage: { type: WelcomeMessageSchema, default: () => ({}) },
  // Motifs proposés à l'ouverture (menu déroulant). Vide = simple bouton.
  reasons: {
    type: [new mongoose.Schema({ label: String, emoji: String, description: String }, { _id: false })],
    default: [],
  },
  allowOwnerClose: { type: Boolean, default: true }, // le membre peut fermer son propre ticket
  dmTranscript: { type: Boolean, default: false },   // transcription envoyée en MP au membre
}, { _id: false });

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },

  welcome: { type: WelcomeSchema, default: () => ({}) },
  goodbye: { type: GoodbyeSchema, default: () => ({}) },
  ticketSystem: { type: TicketSystemSchema, default: () => ({}) }, // Correction: Ajout d'un default pour éviter les erreurs
  
  // NOUVEAU CHAMP : Compteur de tickets
  ticketCounter: {
    type: Number,
    default: 0
  },



  xp: { type: XpSchema, default: () => ({}) },
  birthdays: {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: '' },
    message: { type: String, default: '' },
    roleId: { type: String, default: '' },  // rôle donné pendant la journée
    hour: { type: Number, default: 9 },     // heure de l'annonce (Paris)
  },
  monthlyLeaderboard: { type: MonthlyLeaderboardSchema, default: () => ({}) },
  automod: { type: AutomodSchema, default: () => ({}) }, 
  customCommands: { type: [CustomCommandSchema], default: [] },
  recurringMessages: { type: [RecurringMessageSchema], default: [] },

  social: { type: SocialSchema, default: () => ({}) },
  logs: { type: LogsSchema, default: () => ({}) }
}, {
  minimize: false,
  strict: true,
  timestamps: true
});

// Vide le cache mémoire (utils/configCache.js) dès qu'une config est modifiée
let invalidate = null;
import('../utils/configCache.js').then(m => { invalidate = m.invalidateGuildConfig; }).catch(() => {});
function invalidateFromQuery() {
  const id = this.getFilter?.()?.guildId;
  invalidate?.(typeof id === 'string' ? id : undefined);
}
GuildConfigSchema.post('save', (doc) => invalidate?.(doc.guildId));
GuildConfigSchema.post(['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'findOneAndDelete'], invalidateFromQuery);

const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);

// NOUVELLES FONCTIONS : Pour récupérer et incrémenter le compteur de tickets
export async function getTicketCount(guildId) {
  const doc = await GuildConfig.findOne({ guildId });
  if (doc) {
    return doc.ticketCounter;
  }
  return 0;
}

export async function incrementTicketCount(guildId) {
  const doc = await GuildConfig.findOneAndUpdate(
    { guildId },
    { $inc: { ticketCounter: 1 } },
    { new: true, upsert: true }
  );
  return doc.ticketCounter;
}

export default GuildConfig;