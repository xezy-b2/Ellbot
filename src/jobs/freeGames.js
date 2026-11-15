// src/jobs/freeGames.js
import GuildConfig from '../models/GuildConfig.js';
import NotifyState from '../models/NotifyState.js';

const LOG = (...a) => console.log('[FREEGAMES]', ...a);

// --------- Epic Games (API publique) ----------
async function fetchEpicFreebies() {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR';
  const res = await fetch(url, { headers: { 'User-Agent': 'discord-bot-dashboard' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Epic API failed');
  const j = await res.json();
  const data = j?.data?.Catalog?.searchStore?.elements || [];
  const now = Date.now();

  const freeNow = [];
  for (const el of data) {
    const promos = el.promotions?.promotionalOffers || [];
    const upcoming = el.promotions?.upcomingPromotionalOffers || [];
    const image = (el.keyImages || []).find(k => /OfferImageWide|Featured/.test(k.type))?.url;

    const list = promos.length ? promos : upcoming;
    for (const block of list) {
      for (const o of block.promotionalOffers || []) {
        const start = new Date(o.startDate).getTime();
        const end = new Date(o.endDate).getTime();
        if (start <= now && now <= end) {
          freeNow.push({
            id: el.id,
            title: el.title,
            end,
            image,
            url: `https://store.epicgames.com/p/${el.catalogNs?.mappings?.[0]?.pageSlug || el.productSlug || ''}`
          });
        }
      }
    }
  }
  return freeNow;
}

// --------- Steam (fallback simple : jeux à 0€) ----------
async function fetchSteamFreebies() {
  const url = 'https://store.steampowered.com/search/?maxprice=0&specials=1';
  const res = await fetch(url, { headers: { 'User-Agent': 'discord-bot-dashboard' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Steam page failed');
  const html = await res.text();
  // Extraction très simple des applis affichées
  const rx = /<a href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]+"[^>]*>\s*<span[^>]*class="title"[^>]*>([^<]+)<\/span>/g;
  const out = [];
  let m;
  while ((m = rx.exec(html)) && out.length < 10) {
    out.push({ id: m[1], title: m[2], url: `https://store.steampowered.com/app/${m[1]}` });
  }
  return out;
}

export async function runFreeGames(client) {
  for (const [, guild] of client.guilds.cache) {
    const conf = await GuildConfig.findOne({ guildId: guild.id }).lean().catch(() => null);
    const store = conf?.social?.store;
    if (!store?.enabled) continue;

    const channel = guild.channels.cache.get(store.channelId);
    if (!channel?.isTextBased?.()) continue;

    const providers = (store.providers || []);
    try {
      if (providers.includes('epic')) {
        const list = await fetchEpicFreebies();
        const key = 'epic:free';
        const last = await NotifyState.getLastIds(guild.id, key);
        const fresh = list.filter(x => !last.includes(x.id));
        for (const it of fresh) {
          await channel.send({
            content: store.pingEveryone ? '@everyone' : undefined,
            embeds: [{
              title: `Jeu gratuit (Epic) : ${it.title}`,
              url: it.url,
              image: it.image ? { url: it.image } : undefined,
              description: it.end ? `Offre valable jusqu’au <t:${Math.floor(it.end/1000)}:f>` : undefined,
              color: 0x0078F2
            }]
          });
        }
        if (list.length) await NotifyState.upsertLastIds(guild.id, key, list.map(x => x.id), 50);
      }

      if (providers.includes('steam')) {
        const list = await fetchSteamFreebies();
        const key = 'steam:free';
        const last = await NotifyState.getLastIds(guild.id, key);
        const fresh = list.filter(x => !last.includes(x.id));
        for (const it of fresh.slice(0, 5)) {
          await channel.send({
            content: store.pingEveryone ? '@everyone' : undefined,
            embeds: [{
              title: `Jeu gratuit (Steam) : ${it.title}`,
              url: it.url,
              color: 0x1b2838
            }]
          });
        }
        if (list.length) await NotifyState.upsertLastIds(guild.id, key, list.map(x => x.id), 100);
      }
    } catch (e) {
      LOG('error', e.message);
    }
  }
}
