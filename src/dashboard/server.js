// src/dashboard/server.js
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import fsPromises from 'fs/promises';
import multer from 'multer';
import cron from 'node-cron';
import { randomUUID, randomBytes } from 'crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { postTicketPanel, cleanReasons } from '../features/tickets.js';
import GuildConfig from '../models/GuildConfig.js';
import ReactionRole from '../models/ReactionRole.js';
import { postReactionRolePanel } from '../features/reactionRoles.js';
import { composeWelcomeImageEx, resolveImageSrc } from '../utils/imageComposer.js';
import { startRecurringMessages, buildSchedule, describeSchedule, inferSchedule, getNextRunFor, sendRecurringNow, cleanButtons, TIMEZONE } from '../features/recurringMessages.js';
import { MONGO_URI } from '../database.js';
import { reportError } from '../utils/alerts.js';
import { normalizeRewards } from '../features/levelRoles.js';
import { resolveYouTubeChannel } from '../utils/youtube.js';
import { sendYouTubeTest } from '../jobs/socialNotifier.js';
import { sendFreeGamesTest } from '../jobs/freeGames.js';
import { upcomingBirthdays, formatDate } from '../features/birthdays.js';
import { DATA_DIR, UPLOADS_DIR } from '../paths.js';

const app = express();

// ------------ Async errors (Express 4) ------------
// Express 4 ne capture pas les erreurs des handlers async : une exception dans un
// `await` laissait la requête bloquée et provoquait un "unhandledRejection".
// On enveloppe donc automatiquement tous les handlers GET/POST.
const wrapAsync = (fn) => function wrapped(req, res, next) {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (e) { next(e); }
};
for (const method of ['get', 'post']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) => {
    if (handlers.length === 0) return original(route); // app.get('setting')
    return original(route, ...handlers.map(h => (typeof h === 'function' && h.length < 4 ? wrapAsync(h) : h)));
  };
}

// ------------ Config ------------
const baseUrl = (process.env.BASE_URL || process.env.DASHBOARD_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const callbackURL = process.env.DISCORD_REDIRECT_URI || process.env.CALLBACK_URL || `${baseUrl}/auth/discord/callback`;
const isHttps = baseUrl.startsWith('https://');

let sessionSecret = process.env.SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'change-this' || sessionSecret === 'change-me') {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('[DASHBOARD] SESSION_SECRET absent : un secret aléatoire est utilisé (les sessions seront perdues au redémarrage). Ajoute SESSION_SECRET dans ton .env.');
}

// ------------ Base middlewares ------------
if (isHttps) app.set('trust proxy', 1); // derrière un reverse proxy (nginx, Cloudflare…)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Vues & statiques
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'src/dashboard/views'));
app.use('/static', express.static(path.join(process.cwd(), 'src/dashboard/public')));

// Dossier uploads
const uploadsRoot = UPLOADS_DIR;
app.use('/uploads', express.static(uploadsRoot, {
  // Ne jamais servir autre chose que des images depuis /uploads
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const imageFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!file.mimetype?.startsWith('image/') || !IMAGE_EXT.has(ext)) return cb(new Error('FORMAT_INVALIDE'));
  cb(null, true);
};

// Upload de l'image de fond de la carte de rang
const cardUpload = multer({
  dest: uploadsRoot,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: imageFileFilter,
});

// ------------ Sessions (stockées dans MongoDB, plus en mémoire) ------------
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'dashboard_sessions' }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
  },
}));

// ------------ Passport Discord ------------
app.use(passport.initialize());
app.use(passport.session());

// On ne garde en session que le strict nécessaire
passport.serializeUser((user, done) => done(null, {
  id: user.id,
  username: user.username,
  global_name: user.global_name,
  discriminator: user.discriminator,
  avatar: user.avatar,
  guilds: Array.isArray(user.guilds)
    ? user.guilds.map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner, permissions: String(g.permissions ?? '0') }))
    : [],
}));
passport.deserializeUser((obj, done) => done(null, obj));

if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  console.warn('[DASHBOARD] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET manquants : la connexion Discord du dashboard ne fonctionnera pas.');
}

passport.use(new DiscordStrategy(
  {
    clientID: process.env.DISCORD_CLIENT_ID || 'missing',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || 'missing',
    callbackURL,
    scope: ['identify', 'guilds'],
  },
  (accessToken, refreshToken, profile, done) => done(null, profile)
));

// ------------ Injection du client Discord ------------
let boundClient = null;
app.use((req, _res, next) => { req.client = boundClient; next(); });

// ------------ Sécurité : auth + droits admin sur le serveur ------------
function wantsJson(req) {
  return req.is('application/json') || (req.get('accept') || '').includes('application/json');
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Non connecté.' });
  return res.redirect('/auth/discord');
}

// AVANT : toutes les routes POST vérifiaient seulement « est connecté avec Discord ».
// N'importe qui pouvait donc modifier la config de N'IMPORTE QUEL serveur du bot
// (ou lui faire envoyer des @everyone). Maintenant chaque route /dashboard/:guildId
// exige que l'utilisateur soit administrateur de CE serveur.
async function ensureGuildAdmin(req, res, next) {
  const guildId = String(req.params.guildId || '');
  const deny = (status, msg) => (wantsJson(req) ? res.status(status).json({ error: msg }) : renderError(res, status, msg));

  if (!/^\d{17,20}$/.test(guildId)) return deny(400, 'ID de serveur invalide.');
  const client = req.client;
  if (!client) return deny(503, "Le bot n'est pas initialisé.");

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return deny(404, "Le bot n'est pas présent sur ce serveur ou le serveur n'existe pas.");

  const member = await guild.members.fetch(req.user.id).catch(() => null);
  if (!member) return deny(403, 'Tu ne fais pas partie de ce serveur.');
  if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
    return deny(403, 'Accès refusé. Tu dois être administrateur du serveur pour accéder à ce panneau.');
  }

  req.guild = guild;
  req.member = member;
  next();
}

const dashboardLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/dashboard/:guildId', dashboardLimiter, ensureAuth, wrapAsync(ensureGuildAdmin));

// ------------ Auth routes ------------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false });
app.get('/auth/discord', authLimiter, passport.authenticate('discord'));
app.get('/auth/discord/callback',
  authLimiter,
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/dashboard')
);
app.get('/login', (req, res) => res.redirect('/auth/discord'));
app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session?.destroy(() => res.redirect('/'));
  });
});

// ------------ Multer (upload Welcome) ------------
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const guildId = String(req.params.guildId || 'misc').replace(/\D/g, '') || 'misc';
      const dir = path.join(uploadsRoot, 'welcome', guildId);
      await fsPromises.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const safe = (file.originalname || 'image').replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

// ----------------- Helpers -----------------
const onToBool = (v) => {
  if (Array.isArray(v)) return v.some(onToBool); // champs "hidden off" + checkbox "on"
  return v === 'on' || v === true || v === 'true' || v === '1';
};
const toInt = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : d; };
const str = (v, max = 4000) => (typeof v === 'string' ? v : (v == null ? '' : String(v))).slice(0, max);
const snowflakeOrEmpty = (v) => (typeof v === 'string' && /^\d{17,20}$/.test(v.trim()) ? v.trim() : '');
const hexColor = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const httpUrlOrEmpty = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : '');

function formatTemplate(template = '', memberLike = {}, guildLike = {}) {
  if (!template) return '';

  const m = {
    id: memberLike?.id || memberLike?.user?.id || '',
    username: memberLike?.username || memberLike?.user?.username || '',
    discriminator: memberLike?.discriminator || memberLike?.user?.discriminator || '',
    tag: memberLike?.tag || (memberLike?.user ? `${memberLike.user.username}#${memberLike.user?.discriminator || '0000'}` : ''),
    displayName: memberLike?.displayName || memberLike?.nickname || memberLike?.username || memberLike?.user?.username || '',
    mention: memberLike?.mention || (memberLike?.id ? `<@${memberLike.id}>` : '')
  };

  const g = {
    name: guildLike?.name || '',
    memberCount: Number(guildLike?.memberCount ?? guildLike?.membercount ?? 0)
  };

  return String(template).replace(/{([a-zA-Z0-9_.]+)}/g, (_, key) => {
    switch (key) {
      case 'user.mention': case 'member.mention': return m.mention;
      case 'user.username': case 'member.username': return m.username;
      case 'user.tag': case 'member.tag': return m.tag;
      case 'user.displayName': case 'member.displayName': return m.displayName;
      case 'user': case 'member': return m.mention || m.username || '';
      case 'server.name': return g.name;
      case 'membercount': return String(g.memberCount);
      default: return `{${key}}`;
    }
  });
}

async function getOrCreateConf(guildId) {
  return (await GuildConfig.findOne({ guildId })) || new GuildConfig({ guildId });
}

// ------------ Pages ------------
const botInfo = (client) => (client?.user ? { username: client.user.username, avatar: client.user.displayAvatarURL() } : null);

function renderError(res, status, message) {
  const headings = { 400: 'Requête invalide', 401: 'Non connecté', 403: 'Accès refusé', 404: 'Introuvable', 500: 'Erreur du serveur', 503: 'Bot indisponible' };
  return res.status(status).render('error', { status, heading: headings[status] || 'Erreur', message }, (err, html) => {
    if (err) return res.status(status).send(message);
    res.send(html);
  });
}

app.get('/', (req, res) => { res.render('home', { user: req.user, bot: botInfo(req.client) }); });

// Liste des serveurs (uniquement ceux où l'utilisateur est admin ET où le bot est présent)
app.get('/dashboard', ensureAuth, async (req, res) => {
  const client = req.client;
  if (!client) return renderError(res, 503, "Le bot n'est pas encore connecté à Discord. Réessaie dans quelques secondes.");

  const ADMIN = 0x8n;
  const adminGuildIds = new Set(
    (req.user?.guilds || [])
      .filter(g => {
        if (g.owner) return true;
        try { return (BigInt(g.permissions || '0') & ADMIN) === ADMIN; } catch { return false; }
      })
      .map(g => g.id)
  );

  const guilds = client.guilds.cache
    .filter(g => adminGuildIds.has(g.id))
    .map(g => ({ id: g.id, name: g.name, icon: g.icon }));

  return res.render('dashboard', {
    user: req.user,
    guilds,
    baseUrl,
    bot: client?.user ? {
      username: client.user.username,
      avatar: client.user.displayAvatarURL()
    } : null
  });
});

// ------------ Save Welcome/Goodbye ------------
// AVANT : le formulaire Welcome et le formulaire Goodbye postaient tous les deux ici,
// et chaque sauvegarde écrasait l'autre section avec des valeurs vides.
// Maintenant on ne met à jour que la section réellement envoyée.
app.post('/dashboard/:guildId/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const conf = await GuildConfig.findOne({ guildId }).lean();
  const $set = {};

  if ('welcome_channelId' in b || 'welcome_message' in b) {
    // Le chemin d'upload vient d'un champ caché : on n'accepte qu'un chemin sous uploads/
    const candidate = str(b.welcome_uploadedImagePath, 500).trim();
    const safeUpload = (candidate.startsWith('uploads/') && !candidate.includes('..')) ? candidate : '';
    const imageSourceType = ['none', 'url', 'upload'].includes(b.welcome_imageSourceType) ? b.welcome_imageSourceType : 'none';

    $set.welcome = {
      enabled: onToBool(b.welcome_enabled),
      channelId: snowflakeOrEmpty(b.welcome_channelId),
      title: str(b.welcome_title, 256),
      message: str(b.welcome_message, 4000),
      color: hexColor(b.welcome_color, '#5865F2'),
      imageSourceType,
      imageUrl: httpUrlOrEmpty(b.welcome_imageUrl),
      uploadedImagePath: safeUpload || conf?.welcome?.uploadedImagePath || '',
      overlayWelcomeText: onToBool(b.welcome_overlayWelcomeText),
      overlayTextShadow: onToBool(b.welcome_overlayTextShadow),
      overlayTextColor: hexColor(b.welcome_overlayTextColor, '#FFFFFF'),
      showAvatarOnImage: onToBool(b.welcome_showAvatarOnImage),
      pingEveryone: onToBool(b.welcome_pingEveryone),
      // AVANT : onToBool(b.welcome_pingUser !== false) valait toujours true → impossible à désactiver
      pingUser: onToBool(b.welcome_pingUser),
      deleteAfterMinutes: Math.max(0, toInt(b.welcome_deleteAfterMinutes, 0)),
    };
  }

  if ('goodbye_channelId' in b || 'goodbye_message' in b) {
    $set.goodbye = {
      enabled: onToBool(b.goodbye_enabled),
      channelId: snowflakeOrEmpty(b.goodbye_channelId),
      title: str(b.goodbye_title, 256),
      message: str(b.goodbye_message, 4000),
      color: hexColor(b.goodbye_color, '#E74C3C'),
    };
  }

  if (Object.keys($set).length) {
    await GuildConfig.findOneAndUpdate({ guildId }, { $set }, { upsert: true });
  }

  const anchor = $set.goodbye && !$set.welcome ? 'goodbye' : 'welcome';
  res.redirect(`/dashboard/${guildId}?saved=1#${anchor}`);
});

// ------------ Upload Welcome image ------------
app.post('/dashboard/:guildId/welcome/upload',
  (req, res, next) => upload.single('welcome_upload')(req, res, (err) => {
    if (err) return res.redirect(`/dashboard/${req.guild.id}?uploadError=${encodeURIComponent(err.message || 'ERR')}#welcome`);
    next();
  }),
  async (req, res) => {
    const guildId = req.guild.id;
    if (!req.file) return res.redirect(`/dashboard/${guildId}?uploadError=NOFILE#welcome`);

    let relativePath = path.relative(DATA_DIR, req.file.path).replace(/\\/g, '/');
    if (!relativePath.startsWith('uploads/')) {
      relativePath = `uploads/${relativePath.replace(/^\/+/, '')}`;
    }

    await GuildConfig.findOneAndUpdate(
      { guildId },
      { $set: { 'welcome.imageSourceType': 'upload', 'welcome.uploadedImagePath': relativePath } },
      { upsert: true }
    );

    return res.redirect(`/dashboard/${guildId}?uploaded=1#welcome`);
  }
);

// ------------ Preview Welcome image (Canvas) ------------
app.get('/dashboard/:guildId/welcome/preview.png', async (req, res) => {
  const guildId = req.guild.id;
  const conf = await GuildConfig.findOne({ guildId }).lean();
  if (!conf?.welcome) return res.status(404).send('No welcome config');

  let backgroundSrc = null;
  if (conf.welcome.imageSourceType === 'upload' && conf.welcome.uploadedImagePath) {
    backgroundSrc = resolveImageSrc(conf.welcome.uploadedImagePath);
  } else if (conf.welcome.imageSourceType === 'url' && conf.welcome.imageUrl) {
    backgroundSrc = resolveImageSrc(conf.welcome.imageUrl);
  }

  const u = req.user || {};
  const avatarUrl = u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=512`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const buffer = await composeWelcomeImageEx({
    width: 1200,
    height: 500,
    backgroundSrc,
    overlayWelcomeText: conf.welcome.overlayWelcomeText !== false,
    overlayTextColor: conf.welcome.overlayTextColor || '#FFFFFF',
    overlayTextShadow: conf.welcome.overlayTextShadow !== false,
    serverName: req.guild.name,
    avatarUrl,
    showAvatar: conf.welcome.showAvatarOnImage !== false,
    message: conf.welcome.message || '',
    username: u.username || 'Utilisateur',
    memberCount: req.guild.memberCount || 0
  });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(buffer);
});

// ------------ Auto-modération ------------
app.post('/dashboard/:guildId/automod/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const splitList = (v, sep) => (Array.isArray(v) ? v : String(v || '').split(sep)).map(s => String(s).trim()).filter(Boolean);
  const ids = (v) => splitList(v, /[\s,]+/).filter(x => /^\d{17,20}$/.test(x));
  const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);

  const conf = await getOrCreateConf(guildId);
  conf.automod = {
    enabled: onToBool(b.automod_enabled),
    modLogChannelId: snowflakeOrEmpty(b.automod_modLogChannelId) || null,
    ignoredChannels: ids(b.automod_ignoredChannels),
    ignoredRoles: ids(b.automod_ignoredRoles),
    antiSpam: {
      enabled: onToBool(b.antiSpam_enabled),
      limit: Math.min(50, Math.max(2, toInt(b.antiSpam_limit, 5))),
      timeframe: Math.min(120, Math.max(1, toInt(b.antiSpam_timeframe, 7))),
      action: pick(b.antiSpam_action, ['none', 'warn', 'mute', 'kick'], 'warn'),
      punishmentTime: Math.min(2419200, Math.max(10, toInt(b.antiSpam_punishmentTime, 600))),
    },
    badWords: {
      enabled: onToBool(b.badWords_enabled),
      list: splitList(b.badWords_list, ',').slice(0, 500),
      action: pick(b.badWords_action, ['delete', 'delete_warn', 'mute', 'kick'], 'delete_warn'),
    },
    antiLinks: {
      enabled: onToBool(b.antiLinks_enabled),
      allowInvites: onToBool(b.antiLinks_allowInvites),
      allowedDomains: splitList(b.antiLinks_allowedDomains, /[\n,]+/).map(d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).slice(0, 200),
    },
  };
  await conf.save();

  if (wantsJson(req)) return res.json({ status: 'ok' });
  return res.redirect(`/dashboard/${guildId}?saved=1#automod`);
});

// ------------ Test Welcome (envoie le message de bienvenue avec ton compte) ------------
app.get('/dashboard/:guildId/welcome/test', async (req, res) => {
  const guild = req.guild;
  try {
    const { sendWelcome } = await import('../features/welcomeGoodbye.js');
    await sendWelcome(guild, req.member);
    return res.redirect(`/dashboard/${guild.id}?welcomeTest=ok#welcome`);
  } catch (e) {
    console.error('[TEST WELCOME] error', e);
    return res.redirect(`/dashboard/${guild.id}?welcomeTest=error&w=${encodeURIComponent(e.message)}#welcome`);
  }
});

// ------------ Sauvegarder le classement mensuel ------------
app.post('/dashboard/:guildId/monthly-leaderboard/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const conf = await getOrCreateConf(guildId);

  conf.monthlyLeaderboard = {
    ...(conf.monthlyLeaderboard?.toObject?.() || {}),
    enabled: onToBool(b.monthlyLeaderboard_enabled),
    channelId: snowflakeOrEmpty(b.monthlyLeaderboard_channelId) || null,
    monthlyMessage: str(b.monthlyLeaderboard_monthlyMessage, 2000),
    excludedRoleIds: String(b.monthlyLeaderboard_excludedRoleIds || '').split(/[\s,]+/).map(r => r.trim()).filter(r => /^\d{17,20}$/.test(r)),
    resetXPOnEnd: onToBool(b.monthlyLeaderboard_resetXPOnEnd),
    topRoleIds: {
      '1-3': snowflakeOrEmpty(b.monthlyLeaderboard_topRoleIds_1_3) || null,
      '4-6': snowflakeOrEmpty(b.monthlyLeaderboard_topRoleIds_4_6) || null,
      '7-8': snowflakeOrEmpty(b.monthlyLeaderboard_topRoleIds_7_8) || null,
    },
  };

  await conf.save();
  if (wantsJson(req)) return res.json({ status: 'ok' });
  return res.redirect(`/dashboard/${guildId}?saved=1#leaderboard`);
});

// ------------ Tickets ------------
// (il y avait 3 routes différentes dont 2 avec le même chemin : seule la première servait)
app.post('/dashboard/:guildId/tickets/save', async (req, res) => {
  const guildId = req.guild.id;
  const data = req.body || {};
  const conf = await getOrCreateConf(guildId);

  conf.ticketSystem = {
    enabled: onToBool(data.enabled),
    channelId: snowflakeOrEmpty(data.channelId),
    categoryId: snowflakeOrEmpty(data.categoryId),
    supportRoleId: snowflakeOrEmpty(data.supportRoleId),
    logChannelId: snowflakeOrEmpty(data.logChannelId),
    panelMessage: {
      title: str(data.panelMessage?.title ?? data.panelTitle, 256),
      description: str(data.panelMessage?.description ?? data.panelDescription, 4000),
    },
    welcomeMessage: {
      title: str(data.welcomeMessage?.title ?? data.welcomeTitle, 256),
      description: str(data.welcomeMessage?.description ?? data.welcomeDescription, 4000),
    },
    reasons: cleanReasons(data.reasons),
    allowOwnerClose: onToBool(data.allowOwnerClose),
    dmTranscript: onToBool(data.dmTranscript),
  };
  await conf.save();

  if (wantsJson(req)) return res.json({ message: 'Configuration des tickets sauvegardée avec succès !' });
  return res.redirect(`/dashboard/${guildId}?saved=1#tickets`);
});

app.post('/dashboard/:guildId/tickets/post', async (req, res) => {
  const guild = req.guild;
  const conf = await GuildConfig.findOne({ guildId: guild.id });
  if (!conf || !conf.ticketSystem?.channelId) {
    return res.status(400).json({ error: "Le canal du panneau de tickets n'est pas configuré." });
  }

  const sent = await postTicketPanel(guild, conf.ticketSystem.channelId, conf.ticketSystem);
  if (!sent) return res.status(500).json({ error: "Impossible de publier le panneau (salon introuvable ou permissions manquantes)." });
  return res.json({ message: 'Le panneau de tickets a été publié avec succès.' });
});

// ------------ Rôles réaction ------------
app.post('/dashboard/:guildId/rr/save', async (req, res) => {
  const guildId = req.guild.id;
  const { rr_id, title, description, channelId, type, mode } = req.body || {};
  let { entries } = req.body || {};

  try {
    let reactionRole;
    if (rr_id) {
      // AVANT : findById sans filtre guildId → on pouvait modifier le panneau d'un autre serveur
      reactionRole = await ReactionRole.findOne({ _id: rr_id, guildId }).catch(() => null);
      if (!reactionRole) return res.redirect(`/dashboard/${guildId}?rrError=NOT_FOUND#rr`);
    } else {
      reactionRole = new ReactionRole({ guildId });
    }

    // qs transforme entries[25][...] en objet au-delà de 20 éléments → on normalise
    if (entries && !Array.isArray(entries) && typeof entries === 'object') entries = Object.values(entries);
    const STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];
    const newEntries = (Array.isArray(entries) ? entries : [])
      .map(e => ({
        roleId: snowflakeOrEmpty(e?.roleId),
        label: str(e?.label, 80).trim(),
        emoji: str(e?.emoji, 64).trim(),
        style: STYLES.includes(e?.style) ? e.style : 'Secondary',
      }))
      .filter(e => e.roleId && e.label)
      .slice(0, 25);

    const roleIds = newEntries.map(e => e.roleId);
    if (new Set(roleIds).size !== roleIds.length) {
      return res.redirect(`/dashboard/${guildId}?rrError=DUPLICATE_ROLES#rr`);
    }

    Object.assign(reactionRole, {
      title: str(title, 256),
      description: str(description, 4000),
      channelId: snowflakeOrEmpty(channelId),
      type: ['dropdown', 'buttons'].includes(type) ? type : 'dropdown',
      mode: ['multi', 'single'].includes(mode) ? mode : 'multi',
      entries: newEntries,
    });

    await reactionRole.save();
    return res.redirect(`/dashboard/${guildId}?rrSaved=1&rr=${reactionRole._id}#rr`);
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la configuration des rôles à réaction:', error);
    return res.redirect(`/dashboard/${guildId}?rrError=1#rr`);
  }
});

app.post('/dashboard/:guildId/rr/post', async (req, res) => {
  const guild = req.guild;
  const guildId = guild.id;
  const { rr_id } = req.body || {};

  try {
    const panel = await ReactionRole.findOne({ _id: rr_id, guildId }).catch(() => null);
    if (!panel) return res.redirect(`/dashboard/${guildId}?rrError=NOT_FOUND#rr`);
    if (!panel.entries?.length) return res.redirect(`/dashboard/${guildId}?rrError=NO_ENTRIES#rr`);

    const seenRoleIds = new Set();
    const hasDuplicates = panel.entries.some(entry => {
      if (seenRoleIds.has(entry.roleId)) return true;
      seenRoleIds.add(entry.roleId);
      return false;
    });
    if (hasDuplicates) return res.redirect(`/dashboard/${guildId}?rrError=DUPLICATE_ROLES#rr`);

    const channel = guild.channels.cache.get(panel.channelId);
    if (!channel?.isTextBased?.()) return res.redirect(`/dashboard/${guildId}?rrError=CHANNEL#rr`);

    if (panel.messageId) {
      await channel.messages.fetch(panel.messageId).then(m => m.delete().catch(() => {})).catch(() => {});
    }

    const sent = await postReactionRolePanel(guild, channel, {
      _id: panel._id,
      title: panel.title,
      description: panel.description,
      entries: panel.entries,
      mode: panel.mode,
      type: panel.type
    });

    panel.messageId = sent.id;
    await panel.save();

    return res.redirect(`/dashboard/${guildId}?rrPosted=1&rr=${panel._id}#rr`);
  } catch (e) {
    console.error('[RR] post error', e);
    return res.redirect(`/dashboard/${guildId}?rrError=${encodeURIComponent(e.message)}#rr`);
  }
});

app.post('/dashboard/:guildId/rr/delete', async (req, res) => {
  const guild = req.guild;
  const { rr_id } = req.body || {};

  try {
    const panel = await ReactionRole.findOne({ _id: rr_id, guildId: guild.id }).catch(() => null);
    if (panel) {
      if (panel.channelId && panel.messageId) {
        const channel = guild.channels.cache.get(panel.channelId);
        if (channel?.isTextBased?.()) {
          await channel.messages.fetch(panel.messageId).then(m => m.delete().catch(() => {})).catch(() => {});
        }
      }
      await panel.deleteOne();
    }
    return res.redirect(`/dashboard/${guild.id}?rrDeleted=1#rr`);
  } catch (e) {
    console.error('[RR] delete error', e);
    return res.redirect(`/dashboard/${guild.id}?rrError=${encodeURIComponent(e.message)}#rr`);
  }
});

// ------------ COMMANDES PERSO ------------
app.post('/dashboard/:guildId/commands', async (req, res) => {
  const guildId = req.guild.id;
  // Le préfixe est retiré et le nom mis en minuscules (le bot compare en minuscules)
  const name = str(req.body?.name, 32).trim().replace(/^!/, '').toLowerCase();
  const response = str(req.body?.response, 2000);
  if (!name || !response.trim() || /\s/.test(name)) return res.redirect(`/dashboard/${guildId}?cmdError=missing#commands`);

  const conf = await getOrCreateConf(guildId);
  const existing = (conf.customCommands || []).find(c => c.name?.toLowerCase() === name);
  if (existing) {
    existing.response = response;
  } else {
    conf.customCommands.push({ name, response });
  }
  await conf.save();
  return res.redirect(`/dashboard/${guildId}?cmdSaved=1#commands`);
});

app.post('/dashboard/:guildId/commands/delete', async (req, res) => {
  const guildId = req.guild.id;
  const name = str(req.body?.name, 64);
  const conf = await GuildConfig.findOne({ guildId });
  if (conf) {
    conf.customCommands = (conf.customCommands || []).filter(c => c.name !== name);
    await conf.save();
  }
  return res.redirect(`/dashboard/${guildId}?cmdDeleted=1#commands`);
});

// ------------ RÉCURRENTS ------------
async function reloadRecurring(client) {
  try { await startRecurringMessages(client); } catch (e) { console.error('[RECURRING] reload error', e); }
}

// Lit le formulaire (salon, message, planning) ; renvoie { value } ou { error }
function readRecurringForm(body = {}) {
  const channelId = snowflakeOrEmpty(body.channelId);
  const content = str(body.content, 4096);
  if (!channelId || !content.trim()) return { error: 'missing' };
  const built = buildSchedule({
    mode: body.mode,
    time: body.time,
    days: body.days,
    monthDay: body.monthDay,
    everyHours: body.everyHours,
    cron: str(body.cron, 100),
  });
  if (built.error) return { error: built.error };
  const embedEnabled = onToBool(body.embed_enabled);
  const embed = {
    enabled: embedEnabled,
    title: str(body.embed_title, 256).trim(),
    color: hexColor(body.embed_color, '#5865F2'),
    imageUrl: httpUrlOrEmpty(body.embed_imageUrl),
  };
  // Un message en texte simple est limité à 2000 caractères (4096 dans un embed)
  if (!embedEnabled && content.length > 2000) return { error: 'toolong' };
  return { value: { channelId, content, cron: built.cron, schedule: built.schedule, buttons: cleanButtons(body.buttons), embed } };
}

const recRedirect = (res, guildId, params) => res.redirect(`/dashboard/${guildId}?${new URLSearchParams(params)}#recurring`);

app.post('/dashboard/:guildId/recurring', async (req, res) => {
  const guildId = req.guild.id;
  const form = readRecurringForm(req.body);
  if (form.error) return recRedirect(res, guildId, { recError: form.error });

  const conf = await getOrCreateConf(guildId);
  const msg = { id: randomUUID(), ...form.value, enabled: true };
  conf.recurringMessages.push(msg);
  await conf.save();
  await reloadRecurring(req.client); // actif immédiatement, sans redémarrer le bot

  // « Envoyer aussi maintenant » : un premier envoi tout de suite, puis le planning prend le relais
  if (onToBool(req.body?.sendNow)) {
    const r = await sendRecurringNow(req.client, guildId, msg);
    return recRedirect(res, guildId, r.ok ? { recSaved: '1', recSent: '1' } : { recSaved: '1', recSendError: r.error });
  }
  return recRedirect(res, guildId, { recSaved: '1' });
});

app.post('/dashboard/:guildId/recurring/update', async (req, res) => {
  const guildId = req.guild.id;
  const id = str(req.body?.id, 64);
  const form = readRecurringForm(req.body);
  if (form.error) return recRedirect(res, guildId, { recError: form.error, edit: id });

  const conf = await GuildConfig.findOne({ guildId });
  const msg = conf?.recurringMessages?.find(r => r.id === id);
  if (!msg) return recRedirect(res, guildId, { recError: 'notfound' });
  Object.assign(msg, form.value);
  await conf.save();
  await reloadRecurring(req.client);

  if (onToBool(req.body?.sendNow)) {
    const r = await sendRecurringNow(req.client, guildId, msg.toObject ? msg.toObject() : msg);
    return recRedirect(res, guildId, r.ok ? { recUpdated: '1', recSent: '1' } : { recUpdated: '1', recSendError: r.error });
  }
  return recRedirect(res, guildId, { recUpdated: '1' });
});

// Envoi immédiat : ne change rien au planning, le prochain envoi reste prévu comme avant
app.post('/dashboard/:guildId/recurring/send', async (req, res) => {
  const guildId = req.guild.id;
  const id = str(req.body?.id, 64);
  const conf = await GuildConfig.findOne({ guildId }).lean();
  const msg = conf?.recurringMessages?.find(r => r.id === id);
  if (!msg) return recRedirect(res, guildId, { recError: 'notfound' });
  const r = await sendRecurringNow(req.client, guildId, msg);
  return recRedirect(res, guildId, r.ok ? { recSent: '1' } : { recSendError: r.error });
});

app.post('/dashboard/:guildId/recurring/toggle', async (req, res) => {
  const guildId = req.guild.id;
  const id = str(req.body?.id, 64);
  const conf = await GuildConfig.findOne({ guildId });
  const msg = conf?.recurringMessages?.find(r => r.id === id);
  if (!msg) return recRedirect(res, guildId, { recError: 'notfound' });
  msg.enabled = msg.enabled === false;
  await conf.save();
  await reloadRecurring(req.client);
  return recRedirect(res, guildId, msg.enabled ? { recResumed: '1' } : { recPaused: '1' });
});

app.post('/dashboard/:guildId/recurring/delete', async (req, res) => {
  const guildId = req.guild.id;
  const id = str(req.body?.id, 64);
  const conf = await GuildConfig.findOne({ guildId });
  if (conf) {
    conf.recurringMessages = (conf.recurringMessages || []).filter(r => r.id !== id);
    await conf.save();
    await reloadRecurring(req.client);
  }
  return recRedirect(res, guildId, { recDeleted: '1' });
});

// ------------ XP ------------
app.post('/dashboard/:guildId/xp/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const conf = await getOrCreateConf(guildId);

  let rewards = b.rewards;
  if (rewards && !Array.isArray(rewards) && typeof rewards === 'object') rewards = Object.values(rewards);
  const roleRewards = normalizeRewards((Array.isArray(rewards) ? rewards : [])
    .map(r => ({ level: Math.min(1000, Math.max(1, toInt(r?.level, 0))), roleId: snowflakeOrEmpty(r?.roleId) }))
    .filter(r => r.roleId && r.level >= 1)).slice(0, 25);

  conf.xp = {
    ...(conf.xp?.toObject?.() || {}),
    enabled: onToBool(b.xp_enabled),
    announceLevelUp: onToBool(b.xp_announce),
    levelUpMessage: str(b.xp_levelUpMessage, 2000) || undefined,
    messageChannelId: snowflakeOrEmpty(b.xp_messageChannelId),
    roleRewards,
    stackRoles: onToBool(b.xp_stackRoles),
  };

  await conf.save();
  res.redirect(`/dashboard/${guildId}?saved=1#xp`);
});

app.post('/dashboard/:guildId/social/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};

  const usernames = String(b.twitch_usernames || '')
    .split(/[\s,]+/)
    .map(s => s.trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, ''))
    // AVANT : une virgule en trop créait un nom vide qui faisait échouer l'appel à l'API Twitch
    .filter(s => /^[a-z0-9_]{3,25}$/.test(s));

  await GuildConfig.findOneAndUpdate(
    { guildId },
    {
      $set: {
        'social.twitch.enabled': onToBool(b.twitch_enabled),
        'social.twitch.channelId': snowflakeOrEmpty(b.twitch_channelId),
        'social.twitch.pingEveryone': onToBool(b.twitch_pingEveryone),
        'social.twitch.usernames': [...new Set(usernames)],
        'social.twitch.message': str(b.twitch_message, 1500),
        'social.twitch.embedColor': hexColor(b.twitch_embedColor, '#5865F2'),
      }
    },
    { upsert: true }
  );

  if (wantsJson(req)) return res.json({ status: 'ok' });
  return res.redirect(`/dashboard/${guildId}?success=true#social`);
});

// ------------ ANNIVERSAIRES ------------
app.post('/dashboard/:guildId/birthdays/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const conf = await getOrCreateConf(guildId);
  conf.birthdays = {
    enabled: onToBool(b.birthdays_enabled),
    channelId: snowflakeOrEmpty(b.birthdays_channelId),
    message: str(b.birthdays_message, 1500),
    roleId: snowflakeOrEmpty(b.birthdays_roleId),
    hour: Math.min(23, Math.max(0, toInt(b.birthdays_hour, 9))),
  };
  await conf.save();
  res.redirect(`/dashboard/${guildId}?saved=1#birthdays`);
});

// Test : envoie un message d'anniversaire d'exemple pour l'admin connecté (sans rôle, sans mémoriser)
app.post('/dashboard/:guildId/birthdays/test', async (req, res) => {
  const conf = await GuildConfig.findOne({ guildId: req.guild.id }).lean();
  const channel = conf?.birthdays?.channelId ? req.guild.channels.cache.get(conf.birthdays.channelId) : null;
  if (!channel?.isTextBased?.()) return res.redirect(`/dashboard/${req.guild.id}?bdTest=channel#birthdays`);
  const text = (conf.birthdays.message || '🎂 Joyeux anniversaire {user} ! {age}').replaceAll('{user}', `<@${req.user.id}>`).replaceAll('{age}', '(25 ans)').trim();
  await channel.send({ content: '*(Message de test)*', embeds: [{ color: 0xf47fff, description: text, thumbnail: { url: req.member.displayAvatarURL({ size: 256 }) } }], allowedMentions: { parse: [] } });
  res.redirect(`/dashboard/${req.guild.id}?bdTest=ok#birthdays`);
});

// ------------ YOUTUBE ------------
app.post('/dashboard/:guildId/social/youtube/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const conf = await getOrCreateConf(guildId);
  const previous = conf.social?.youtube?.channels || [];

  // Une chaîne par ligne : lien, @pseudo ou ID « UC… ». Les chaînes déjà connues ne sont pas re-vérifiées.
  const inputs = String(b.youtube_channels || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 15);
  const channels = [];
  const failed = [];
  for (const input of inputs) {
    const known = previous.find(c => c.id === input || input.includes(c.id) || (c.name && c.name.toLowerCase() === input.replace(/^@/, '').toLowerCase()));
    const found = known ? { id: known.id, name: known.name } : await resolveYouTubeChannel(input).catch(() => null);
    if (found && !channels.some(c => c.id === found.id)) channels.push(found);
    else if (!found) failed.push(input);
  }

  conf.social.youtube = {
    enabled: onToBool(b.youtube_enabled),
    channelId: snowflakeOrEmpty(b.youtube_channelId),
    channels,
    message: str(b.youtube_message, 1500),
    pingEveryone: onToBool(b.youtube_pingEveryone),
  };
  await conf.save();
  const params = new URLSearchParams({ saved: '1' });
  if (failed.length) params.set('ytNotFound', failed.join(' | ').slice(0, 300));
  res.redirect(`/dashboard/${guildId}?${params}#social`);
});

app.post('/dashboard/:guildId/social/youtube/test', async (req, res) => {
  const conf = await GuildConfig.findOne({ guildId: req.guild.id }).lean();
  const r = await sendYouTubeTest(req.guild, conf).catch(e => ({ ok: false, error: e.message }));
  res.redirect(`/dashboard/${req.guild.id}?${new URLSearchParams(r.ok ? { ytTest: 'ok' } : { ytTest: r.error })}#social`);
});

// ------------ JEUX GRATUITS ------------
app.post('/dashboard/:guildId/social/store/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const providers = [].concat(b.store_providers || []).filter(p => ['epic', 'steam'].includes(p));
  const conf = await getOrCreateConf(guildId);
  conf.social.store = {
    enabled: onToBool(b.store_enabled),
    channelId: snowflakeOrEmpty(b.store_channelId),
    providers: [...new Set(providers)],
    message: str(b.store_message, 1500),
    pingEveryone: onToBool(b.store_pingEveryone),
  };
  await conf.save();
  res.redirect(`/dashboard/${guildId}?saved=1#social`);
});

app.post('/dashboard/:guildId/social/store/test', async (req, res) => {
  const conf = await GuildConfig.findOne({ guildId: req.guild.id }).lean();
  const r = await sendFreeGamesTest(req.guild, conf).catch(e => ({ ok: false, error: e.message }));
  res.redirect(`/dashboard/${req.guild.id}?${new URLSearchParams(r.ok ? { storeTest: 'ok' } : { storeTest: r.error })}#social`);
});

// ------------ LOGS ------------
app.post('/dashboard/:guildId/logs/save', async (req, res) => {
  const guildId = req.guild.id;
  const b = req.body || {};
  const conf = await getOrCreateConf(guildId);

  // AVANT : les valeurs "on" étaient copiées telles quelles dans des champs Boolean
  // → Mongoose refusait de sauvegarder dès qu'une case était cochée.
  conf.logs = {
    ...(conf.logs?.toObject?.() || {}),
    enabled: onToBool(b.logs_enabled),
    channelId: snowflakeOrEmpty(b.logs_channelId),
    joins: onToBool(b.logs_joinLeave),
    leaves: onToBool(b.logs_joinLeave),
    messageDeleted: onToBool(b.logs_msgDelete),
    messageEdited: onToBool(b.logs_msgEdit),
    bans: onToBool(b.logs_moderation),
  };

  await conf.save();
  if (wantsJson(req)) return res.json({ status: 'ok' });
  res.redirect(`/dashboard/${guildId}?saved=1#logs`);
});

// ------------ SOCIAL : bouton "Envoyer un test" (POST uniquement) ------------
// La version GET « debug » a été supprimée : un simple lien piégé suffisait
// à faire envoyer une notification (avec @everyone) par le bot.
app.post('/dashboard/:guildId/social/test', async (req, res) => {
  const guild = req.guild;
  const conf = await GuildConfig.findOne({ guildId: guild.id }).lean().catch(() => null);
  const block = conf?.social?.twitch;
  if (!block) return res.redirect(`/dashboard/${guild.id}?socialTest=nosocial#social`);
  if (!block.enabled || !block.channelId) return res.redirect(`/dashboard/${guild.id}?socialTest=nosent#social`);

  const ch = guild.channels.cache.get(block.channelId) || await guild.channels.fetch(block.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) return res.redirect(`/dashboard/${guild.id}?socialTest=nosent#social`);

  const username = String(block.usernames?.[0] || '').trim();
  const embed = {
    title: username ? `🔴 ${username} est en live ! (TEST)` : '🔔 Notification (TEST)',
    description: block.message?.trim() || (username ? `Regarde le stream de **${username}** sur Twitch !` : 'Notification de test'),
    color: parseInt(hexColor(block.embedColor, '#5865F2').slice(1), 16),
    timestamp: new Date().toISOString(),
  };
  if (username) {
    embed.image = { url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(username)}-1280x720.jpg` };
  }

  try {
    // Pas de @everyone pour un simple test
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return res.redirect(`/dashboard/${guild.id}?socialTest=ok#social`);
  } catch (e) {
    console.log('[SOCIAL TEST] send err', e?.message || e);
    return res.redirect(`/dashboard/${guild.id}?socialTest=error#social`);
  }
});

// ------------ Page de configuration d'un serveur ------------
app.get('/dashboard/:guildId', async (req, res) => {
  const { user } = req;
  const guild = req.guild;
  const guildId = guild.id;

  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);

  let conf = await GuildConfig.findOne({ guildId });
  if (!conf) conf = await GuildConfig.create({ guildId });

  const allChannels = guild.channels.cache;
  const channels = allChannels
    .filter(c => c.isTextBased())
    .sort((a, b) => a.position - b.position);
  const categories = allChannels.filter(c => c.type === ChannelType.GuildCategory);
  const roles = guild.roles.cache;

  const rrPanels = await ReactionRole.find({ guildId }).lean();
  const ticketConfig = conf.ticketSystem || {};

  // Infos lisibles pour les messages récurrents (planning en français, prochain/dernier envoi)
  const fmtDate = (d) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);
  const recurringInfo = Object.fromEntries((conf.recurringMessages || []).map(r => [r.id, {
    description: describeSchedule(r),
    schedule: inferSchedule(r),
    nextRun: r.enabled === false ? null : fmtDate(getNextRunFor(r.id)),
    lastSent: fmtDate(r.lastSentAt),
  }]));

  const sampleMember = {
    id: user?.id || '000000000000000000',
    username: user?.username || 'Utilisateur',
    discriminator: user?.discriminator || '0000',
    displayName: user?.global_name || user?.username || 'Utilisateur',
    mention: user?.id ? `<@${user.id}>` : '@Utilisateur'
  };
  const previewTitle = formatTemplate(conf?.welcome?.title || '', sampleMember, guild);
  const previewMessage = formatTemplate(conf?.welcome?.message || '', sampleMember, guild);

  // Prochains anniversaires (avec le nom affiché sur le serveur)
  const upcoming = await upcomingBirthdays(guildId, 8).catch(() => []);
  const birthdayList = await Promise.all(upcoming.map(async (b) => {
    const m = guild.members.cache.get(b.userId) || await guild.members.fetch(b.userId).catch(() => null);
    return { name: m?.displayName || 'Ancien membre', date: formatDate(b.day, b.month), inDays: b.inDays };
  }));

  res.render('guild', {
    user,
    guild,
    conf,
    channels,
    categories,
    ChannelType,
    roles,
    rrPanels,
    ticketConfig,
    recurringInfo,
    birthdayList,
    baseUrl: `${req.protocol}://${req.get('host')}`,
    warnings: [],
    query: req.query,
    bot: req.client?.user ? {
      username: req.client.user.username,
      avatar: req.client.user.displayAvatarURL()
    } : null,
    previewTitle,
    previewMessage
  });
});

// ------------ LEADERBOARD : bouton "Envoyer un test" ------------
app.post('/dashboard/:guildId/leaderboard/test', async (req, res) => {
  const guild = req.guild;
  const conf = await GuildConfig.findOne({ guildId: guild.id }).lean().catch(() => null);
  const lb = conf?.monthlyLeaderboard;
  if (!lb?.enabled || !lb?.channelId) return res.redirect(`/dashboard/${guild.id}?lbTest=disabled#leaderboard`);

  const ch = guild.channels.cache.get(lb.channelId) || await guild.channels.fetch(lb.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) return res.redirect(`/dashboard/${guild.id}?lbTest=channel#leaderboard`);

  const lines = [
    '🥇 **@Alice** — 423 messages',
    '🥈 **@Bob** — 389 messages',
    '🥉 **@Charlie** — 275 messages',
  ];
  const desc = (lb.monthlyMessage?.trim() ? lb.monthlyMessage.trim() + '\n\n' : '') + lines.join('\n');

  await ch.send({
    embeds: [{ title: '🏆 Classement du mois — TEST', description: desc, color: 0xF1C40F, timestamp: new Date().toISOString() }],
    allowedMentions: { parse: [] },
  });
  return res.redirect(`/dashboard/${guild.id}?lbTest=ok#leaderboard`);
});

// ------------ GESTION DE L'IMAGE DE FOND XP ------------
app.post('/dashboard/:guildId/xp/card-background',
  (req, res, next) => cardUpload.single('cardBackground')(req, res, (err) => {
    if (err) return res.redirect(`/dashboard/${req.guild.id}?xpBg=error#xp`);
    next();
  }),
  async (req, res) => {
    const guildId = req.guild.id;
    if (!req.file) return res.redirect(`/dashboard/${guildId}?xpBg=no-file#xp`);

    try {
      const guildConfig = await getOrCreateConf(guildId);

      if (guildConfig.xp?.cardBackgroundUrl?.startsWith('/uploads/')) {
        const oldPath = path.join(uploadsRoot, path.basename(guildConfig.xp.cardBackgroundUrl));
        await fsPromises.unlink(oldPath).catch(() => {});
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const newFilename = `${randomUUID()}${IMAGE_EXT.has(ext) ? ext : '.png'}`;
      await fsPromises.rename(req.file.path, path.join(uploadsRoot, newFilename));

      guildConfig.xp.cardBackgroundUrl = `/uploads/${newFilename}`;
      await guildConfig.save();
      res.redirect(`/dashboard/${guildId}?xpBg=ok#xp`);
    } catch (error) {
      console.error(`Erreur lors de l'upload de l'image de fond pour ${guildId}:`, error);
      await fsPromises.unlink(req.file.path).catch(() => {});
      res.redirect(`/dashboard/${guildId}?xpBg=error#xp`);
    }
  }
);

app.post('/dashboard/:guildId/xp/card-background/clear', async (req, res) => {
  const guildConfig = await GuildConfig.findOne({ guildId: req.guild.id });
  if (guildConfig?.xp?.cardBackgroundUrl) {
    if (guildConfig.xp.cardBackgroundUrl.startsWith('/uploads/')) {
      const oldPath = path.join(uploadsRoot, path.basename(guildConfig.xp.cardBackgroundUrl));
      await fsPromises.unlink(oldPath).catch(() => {});
    }
    guildConfig.xp.cardBackgroundUrl = '';
    await guildConfig.save();
    return res.status(200).json({ status: 'ok' });
  }
  res.status(404).json({ status: 'not-found' });
});

// ------------ Gestion d'erreurs ------------
app.use((req, res) => (wantsJson(req) ? res.status(404).json({ error: 'Introuvable.' }) : renderError(res, 404, "Cette page n'existe pas.")));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[DASHBOARD] Erreur :', err);
  reportError(`Dashboard ${req.method} ${req.path}`, err);
  if (res.headersSent) return;
  if (wantsJson(req)) return res.status(500).json({ error: 'Erreur interne du serveur.' });
  renderError(res, 500, 'Une erreur inattendue est survenue. Réessaie dans un instant.');
});

// ------------ Export : démarrer le dashboard ------------
let server = null;
export async function startDashboard(client) {
  boundClient = client;
  if (server) return; // évite un double listen si l'événement ready est rejoué
  // Railway (et la plupart des hébergeurs) imposent le port via PORT
  const PORT = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3000);
  server = app.listen(PORT, () => {
    console.log(`[DASHBOARD] Listening on http://localhost:${PORT}`);
    console.log(`[DASHBOARD] OAuth Callback URL: ${callbackURL}`);
  });
  server.on('error', (e) => console.error('[DASHBOARD] Impossible de démarrer le serveur web :', e.message));
}
