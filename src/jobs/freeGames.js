// src/jobs/freeGames.js
// Annonce des jeux gratuits Epic Games et Steam (toutes les 2 heures, via scheduler.js).
import { EmbedBuilder } from 'discord.js';
import GuildConfig from '../models/GuildConfig.js';
import NotifyState from '../models/NotifyState.js';

const LOG = (...a) => console.log('[FREEGAMES]', ...a);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// --------- Epic Games ----------
async function fetchEpicFreebies() {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR';
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Epic ${res.status}`);
  const j = await res.json();
  const elements = j?.data?.Catalog?.searchStore?.elements || [];
  const now = Date.now();
  const out = [];

  for (const el of elements) {
    const offers = (el.promotions?.promotionalOffers || []).flatMap(b => b.promotionalOffers || []);
    // discountPercentage 0 = prix final à 0 € (100 % de réduction)
    const active = offers.find(o => o.discountSetting?.discountPercentage === 0
      && new Date(o.startDate).getTime() <= now && now <= new Date(o.endDate).getTime());
    if (!active) continue;

    const images = el.keyImages || [];
    const image = (images.find(k => k.type === 'OfferImageWide') || images.find(k => k.type === 'DieselStoreFrontWide') || images.find(k => k.type === 'Thumbnail') || images[0])?.url;
    const slug = el.offerMappings?.[0]?.pageSlug || el.catalogNs?.mappings?.[0]?.pageSlug || el.productSlug || el.urlSlug;
    const fmt = el.price?.totalPrice?.fmtPrice;
    const original = el.price?.totalPrice?.originalPrice > 0 ? fmt?.originalPrice : null;
    out.push({
      id: `epic:${el.id}:${active.endDate}`,
      store: 'Epic Games',
      storeName: "l'Epic Games Store",
      provider: 'epic',
      title: el.title,
      description: el.description && el.description !== el.title ? el.description : '',
      originalPrice: original || null,
      url: slug ? `https://store.epicgames.com/fr/p/${slug}` : 'https://store.epicgames.com/fr/free-games',
      image,
      end: new Date(active.endDate).getTime(),
    });
  }
  return out;
}

// --------- Steam (jeux payants passés à 0 € pour une durée limitée) ----------
async function fetchSteamFreebies() {
  const url = 'https://store.steampowered.com/search/?maxprice=free&specials=1&cc=fr&l=french';
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Steam ${res.status}`);
  const html = await res.text();
  const out = [];
  const rowRx = /<a\s([^>]*search_result_row[^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = rowRx.exec(html)) && out.length < 10) {
    const [, attrs, inner] = m;
    const appId = (attrs.match(/data-ds-appid="(\d+)"/) || [])[1];
    const href = (attrs.match(/href="([^"]+)"/) || [])[1];
    const title = (inner.match(/<span class="title">([^<]+)<\/span>/) || [])[1];
    const discount = (inner.match(/data-discount="(\d+)"/) || [])[1];
    const originalPrice = (inner.match(/class="discount_original_price">([^<]+)</) || [])[1];
    if (!appId || !title) continue;
    if (discount && discount !== '100') continue;
    out.push({
      id: `steam:${appId}`,
      appId,
      store: 'Steam',
      storeName: 'Steam',
      provider: 'steam',
      title: decodeHtml(title).trim(),
      description: '',
      originalPrice: originalPrice ? decodeHtml(originalPrice).trim() : null,
      url: (href || `https://store.steampowered.com/app/${appId}`).split('?')[0],
      image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    });
  }
  return out;
}

const decodeHtml = (t = '') => t.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

/** Complète un jeu Steam avec sa description courte et son prix (API publique du magasin). */
async function enrichSteamGame(game) {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${game.appId}&cc=fr&l=french`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return game;
    const d = (await res.json())?.[game.appId]?.data;
    if (!d) return game;
    return {
      ...game,
      description: decodeHtml(d.short_description || '').trim(),
      originalPrice: game.originalPrice || d.price_overview?.initial_formatted || null,
      image: d.header_image || game.image,
    };
  } catch {
    return game;
  }
}

// Logos affichés en haut à droite (modifiables dans le dashboard)
export const DEFAULT_LOGOS = {
  epic: 'https://commons.wikimedia.org/wiki/Special:FilePath/Epic_Games_logo.svg?width=256',
  steam: 'https://commons.wikimedia.org/wiki/Special:FilePath/Steam_icon_logo.svg?width=256',
};
const COLORS = { epic: 0xdb7057, steam: 0x66c0f4 };

/** Texte en citation Discord (« > »), coupé proprement s'il est trop long. */
function quote(text, max = 700) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return t.split('\n').map(l => `> ${l}`.trimEnd()).join('\n');
}

function buildGameMessage(store, game, { test = false, guild = null } = {}) {
  const lines = [];
  const q = quote(game.description);
  if (q) lines.push(q, '');
  const price = game.originalPrice ? `~~${game.originalPrice}~~ **Gratuit**` : '**Gratuit**';
  lines.push(game.end
    ? `${price} jusqu'au <t:${Math.floor(game.end / 1000)}:d> (<t:${Math.floor(game.end / 1000)}:R>)`
    : `${price} pour une durée limitée`);
  lines.push(`🔗 [**Ouvrir dans la boutique !**](${game.url})`);

  const logo = (game.provider === 'steam' ? store.steamLogoUrl : store.epicLogoUrl) || DEFAULT_LOGOS[game.provider];
  const embed = new EmbedBuilder()
    .setColor(COLORS[game.provider] || 0x5865f2)
    .setTitle(`${game.title} gratuit sur ${game.storeName} !`.slice(0, 256))
    .setURL(game.url)
    .setDescription(lines.join('\n').slice(0, 4096))
    .setTimestamp(new Date());
  if (logo) embed.setThumbnail(logo);
  if (game.image) embed.setImage(game.image);
  if (guild) embed.setFooter({ text: guild.name, iconURL: guild.iconURL({ size: 64 }) || undefined });

  // Texte au-dessus : seulement s'il y a un message personnalisé ou un ping
  const parts = [];
  if (store.pingEveryone && !test) parts.push('@everyone');
  if (store.message) parts.push(store.message.replaceAll('{game}', game.title).replaceAll('{store}', game.store));
  const content = parts.join(' ').trim();
  return {
    ...(content ? { content: content.slice(0, 2000) } : {}),
    embeds: [embed],
    // Test : les rôles écrits dans le message pinguent comme en vrai, mais jamais @everyone
    allowedMentions: { parse: ['roles', 'users', ...(store.pingEveryone && !test ? ['everyone'] : [])] },
  };
}

async function collectGames(providers) {
  const games = [];
  if (providers.includes('epic')) {
    try { games.push(...await fetchEpicFreebies()); } catch (e) { LOG('Epic :', e.message); }
  }
  if (providers.includes('steam')) {
    try { games.push(...await fetchSteamFreebies()); } catch (e) { LOG('Steam :', e.message); }
  }
  return games;
}

export async function runFreeGames(client) {
  const configs = await GuildConfig.find({ 'social.store.enabled': true }).lean().maxTimeMS(15000);
  if (!configs.length) return;

  // Une seule récupération pour tous les serveurs
  const allProviders = [...new Set(configs.flatMap(c => c.social.store.providers || []))];
  const games = await collectGames(allProviders);

  for (const conf of configs) {
    const store = conf.social.store;
    const guild = client.guilds.cache.get(conf.guildId);
    const channel = guild?.channels.cache.get(store.channelId);
    if (!channel?.isTextBased?.()) continue;

    const mine = games.filter(g => (store.providers || []).includes(g.provider));
    const known = await NotifyState.getLastIds(conf.guildId, 'freegames');
    const fresh = mine.filter(g => !known.includes(g.id)).slice(0, 5);
    for (let g of fresh) {
      try {
        if (g.provider === 'steam') g = await enrichSteamGame(g);
        await channel.send(buildGameMessage(store, g, { guild }));
        LOG(`Annoncé (${guild.name}) : ${g.title} sur ${g.store}`);
      } catch (e) {
        LOG('Envoi impossible :', e.message);
      }
    }
    if (fresh.length) await NotifyState.upsertLastIds(conf.guildId, 'freegames', fresh.map(g => g.id), 100);
  }
}

/** Bouton « Envoyer un test » : publie les jeux gratuits actuels, sans ping ni mémorisation. */
export async function sendFreeGamesTest(guild, conf) {
  const store = conf?.social?.store;
  if (!store?.channelId || !(store.providers || []).length) return { ok: false, error: 'config' };
  const channel = guild.channels.cache.get(store.channelId);
  if (!channel?.isTextBased?.()) return { ok: false, error: 'channel' };
  const games = (await collectGames(store.providers)).slice(0, 3);
  if (!games.length) return { ok: false, error: 'nogames' };
  for (let g of games) {
    if (g.provider === 'steam') g = await enrichSteamGame(g);
    await channel.send(buildGameMessage(store, g, { test: true, guild }));
  }
  return { ok: true, count: games.length };
}
