// src/jobs/socialNotifier.js
import GuildConfig from '../models/GuildConfig.js';
import NotifyState from '../models/NotifyState.js';

const LOG = (...a) => console.log('[SOCIAL]', ...a);

// ========== Helpers ==========
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const head = (arr) => Array.isArray(arr) ? arr[0] : arr;

// ------------ YouTube (RSS sans clé) ------------
// Accepte channel URL ou @handle ; idéalement des channel_id "UC..."
function toYouTubeFeedUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (s.startsWith('http')) {
    // channel/UC... or @handle -> on tente d’extraire
    const mChannel = s.match(/channel\/([A-Za-z0-9_-]+)/);
    if (mChannel) return `https://www.youtube.com/feeds/videos.xml?channel_id=${mChannel[1]}`;
    // handle -> on appelle page pour récupérer channel_id ? Trop lourd → on garde l’URL telle quelle (pas RSS)
    return null;
  }
  if (s.startsWith('UC')) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${s}`;
  }
  // @handle non supporté en direct ici => laisser vide
  return null;
}

async function fetchYouTubeRSS(feedUrl) {
  const res = await fetch(feedUrl, { headers: { 'User-Agent': 'discord-bot-dashboard' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`YT RSS ${res.status}`);
  const xml = await res.text();
  // Parsing super simple : on récupère <entry><yt:videoId> et <title>
  const ids = Array.from(xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)).map(m => m[1]);
  const titles = Array.from(xml.matchAll(/<title>([^<]+)<\/title>/g)).map(m => m[1]).slice(1); // [0] = feed title
  const links = Array.from(xml.matchAll(/<link rel="alternate" href="([^"]+)"/g)).map(m => m[1]);
  // On mappe grossièrement par ordre
  const out = ids.map((id, i) => ({ id, title: titles[i] || id, url: `https://www.youtube.com/watch?v=${id}` || links[i] }));
  return out;
}

// ------------ Twitch (Helix) ------------
async function getTwitchAppToken(clientId, clientSecret) {
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, { method: 'POST', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Twitch token failed');
  const j = await res.json();
  return j.access_token;
}

async function twitchGetUsers(loginNames, clientId, token) {
  const params = loginNames.map(n => 'login=' + encodeURIComponent(n)).join('&');
  const res = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('Twitch users failed');
  const j = await res.json();
  return j.data || [];
}

async function twitchGetStreams(userIds, clientId, token) {
  const chunks = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const slice = userIds.slice(i, i + 100);
    const q = slice.map(id => 'user_id=' + encodeURIComponent(id)).join('&');
    const res = await fetch(`https://api.twitch.tv/helix/streams?${q}`, {
      headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error('Twitch streams failed');
    const j = await res.json();
    chunks.push(...(j.data || []));
    await sleep(250);
  }
  return chunks;
}

// ========== Notify Logic ==========
async function notifyYouTube(client, guild, conf) {
  const s = conf?.social?.youtube;
  if (!s?.enabled) return;

  const channel = guild.channels.cache.get(s.channelId);
  if (!channel?.isTextBased?.()) return;

  const channels = (s.channels || []).map(x => String(x).trim()).filter(Boolean);
  if (!channels.length) return;

  for (const ch of channels) {
    const feed = toYouTubeFeedUrl(ch);
    if (!feed) continue;
    try {
      const items = await fetchYouTubeRSS(feed);
      if (!items.length) continue;

      const key = `youtube:${ch}`;
      const last = await NotifyState.getLastIds(guild.id, key);
      const fresh = items.filter(it => !last.includes(it.id));
      if (!fresh.length) continue;

      for (const it of fresh.slice(0, 3)) {
        await channel.send({
          content: s.pingEveryone ? '@everyone' : undefined,
          embeds: [{
            title: `Nouvelle vidéo YouTube`,
            description: it.title,
            url: it.url,
            color: 0xff0000
          }]
        });
      }
      await NotifyState.upsertLastIds(guild.id, key, items.map(x => x.id), 20);
    } catch (e) {
      LOG('YT error', ch, e.message);
    }
  }
}

async function notifyTwitch(client, guild, conf) {
  const s = conf?.social?.twitch;
  if (!s?.enabled) return;

  const channel = guild.channels.cache.get(s.channelId);
  if (!channel?.isTextBased?.()) return;

  const names = (s.usernames || []).map(n => n.toLowerCase()).filter(Boolean);
  if (!names.length) return;

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    LOG('Twitch disabled: missing env TWITCH_CLIENT_ID/SECRET');
    return;
  }
  let token = process.env.TWITCH_APP_TOKEN;
  try {
    if (!token) token = await getTwitchAppToken(clientId, clientSecret);
    const users = await twitchGetUsers(names, clientId, token);
    const idMap = new Map(users.map(u => [u.login.toLowerCase(), u.id]));
    const userIds = names.map(n => idMap.get(n)).filter(Boolean);
    if (!userIds.length) return;

    const streams = await twitchGetStreams(userIds, clientId, token);
    for (const st of streams) {
      const key = `twitch:${st.user_id}`;
      const last = await NotifyState.getLastIds(guild.id, key);
      if (last.includes(st.id)) continue; // déjà annoncé

      await channel.send({
        content: s.pingEveryone ? '@everyone' : undefined,
        embeds: [{
          title: `${st.user_name} est en LIVE sur Twitch !`,
          url: `https://twitch.tv/${st.user_login}`,
          description: st.title || 'Live en cours',
          color: 0x9146FF
        }]
      });
      await NotifyState.upsertLastIds(guild.id, key, [st.id], 5);
    }
  } catch (e) {
    LOG('Twitch error', e.message);
  }
}

export async function runSocialNotifications(client) {
  try {
    for (const [, guild] of client.guilds.cache) {
      const conf = await GuildConfig.findOne({ guildId: guild.id }).lean().catch(() => null);
      if (!conf?.social) continue;
      await notifyYouTube(client, guild, conf);
      // Les stores sont dans freeGames.js (appelés par scheduler), pas ici
    }
  } catch (e) {
    LOG('fatal', e);
  }
}
