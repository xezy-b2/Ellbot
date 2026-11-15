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
    out.push({
      id: `epic:${el.id}:${active.endDate}`,
      store: 'Epic Games',
      title: el.title,
      url: slug ? `https://store.epicgames.com/fr/p/${slug}` : 'https://store.epicgames.com/fr/free-games',
      image,
      end: new Date(active.endDate).getTime(),
      color: 0x2a2a2a,
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
    if (!appId || !title) continue;
    if (discount && discount !== '100') continue;
    out.push({
      id: `steam:${appId}`,
      store: 'Steam',
      title: title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim(),
      url: (href || `https://store.steampowered.com/app/${appId}`).split('?')[0],
      image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      color: 0x1b2838,
    });
  }
  return out;
}

function buildGameMessage(store, game, { test = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(game.color)
    .setAuthor({ name: `Gratuit sur ${game.store}` })
    .setTitle(game.title.slice(0, 256))
    .setURL(game.url);
  if (game.image) embed.setImage(game.image);
  if (game.end) embed.setDescription(`Gratuit jusqu'au <t:${Math.floor(game.end / 1000)}:F> (<t:${Math.floor(game.end / 1000)}:R>)`);

  const parts = [];
  if (store.pingEveryone && !test) parts.push('@everyone');
  parts.push((store.message || '🎮 Jeu gratuit à récupérer : **{game}** !').replaceAll('{game}', game.title).replaceAll('{store}', game.store));
  return { content: parts.join(' ').slice(0, 2000), embeds: [embed], allowedMentions: { parse: test ? [] : ['roles', 'users', ...(store.pingEveryone ? ['everyone'] : [])] } };
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

    const mine = games.filter(g => (store.providers || []).includes(g.store === 'Steam' ? 'steam' : 'epic'));
    const known = await NotifyState.getLastIds(conf.guildId, 'freegames');
    const fresh = mine.filter(g => !known.includes(g.id)).slice(0, 5);
    for (const g of fresh) {
      try {
        await channel.send(buildGameMessage(store, g));
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
  for (const g of games) await channel.send(buildGameMessage(store, g, { test: true }));
  return { ok: true, count: games.length };
}
