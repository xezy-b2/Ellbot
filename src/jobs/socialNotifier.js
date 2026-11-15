// src/jobs/socialNotifier.js
// Annonce des nouvelles vidéos YouTube (toutes les 5 minutes, via scheduler.js).
import { EmbedBuilder } from 'discord.js';
import GuildConfig from '../models/GuildConfig.js';
import NotifyState from '../models/NotifyState.js';
import { fetchChannelFeed } from '../utils/youtube.js';

const LOG = (...a) => console.log('[YOUTUBE]', ...a);

function buildVideoMessage(s, channelName, video, { test = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({ name: channelName })
    .setTitle(video.title.slice(0, 256))
    .setURL(video.url)
    .setImage(video.thumbnail);
  if (video.published) embed.setTimestamp(new Date(video.published));

  const parts = [];
  if (s.pingEveryone && !test) parts.push('@everyone');
  parts.push((s.message || '📺 **{channel}** a publié une nouvelle vidéo !').replaceAll('{channel}', channelName).replaceAll('{title}', video.title));
  return {
    content: parts.join(' ').slice(0, 2000),
    embeds: [embed],
    allowedMentions: { parse: test ? [] : ['roles', 'users', ...(s.pingEveryone ? ['everyone'] : [])] },
  };
}

async function notifyGuild(client, conf) {
  const s = conf.social?.youtube;
  if (!s?.enabled || !s.channelId || !s.channels?.length) return;
  const guild = client.guilds.cache.get(conf.guildId);
  const channel = guild?.channels.cache.get(s.channelId);
  if (!channel?.isTextBased?.()) return;

  for (const yt of s.channels) {
    try {
      const feed = await fetchChannelFeed(yt.id);
      if (!feed.videos.length) continue;
      const key = `youtube:${yt.id}`;
      const known = await NotifyState.getLastIds(conf.guildId, key);
      const ids = feed.videos.map(v => v.id);

      // Premier passage : on mémorise les vidéos existantes sans rien annoncer
      if (!known.length) {
        await NotifyState.upsertLastIds(conf.guildId, key, ids, 30);
        LOG(`Chaîne « ${feed.channelName} » suivie pour ${guild.name} (${ids.length} vidéos existantes ignorées).`);
        continue;
      }

      const fresh = feed.videos.filter(v => !known.includes(v.id)).slice(0, 3).reverse(); // plus ancienne d'abord
      for (const v of fresh) {
        await channel.send(buildVideoMessage(s, feed.channelName, v));
        LOG(`Nouvelle vidéo annoncée (${guild.name}) : ${v.title}`);
      }
      if (fresh.length) await NotifyState.upsertLastIds(conf.guildId, key, ids, 30);
    } catch (e) {
      LOG(`Erreur pour la chaîne ${yt.name || yt.id} :`, e.message);
    }
  }
}

export async function runSocialNotifications(client) {
  const configs = await GuildConfig.find({ 'social.youtube.enabled': true }).lean().maxTimeMS(15000);
  for (const conf of configs) {
    await notifyGuild(client, conf);
  }
}

/** Bouton « Envoyer un test » : publie la dernière vidéo de la première chaîne, sans ping. */
export async function sendYouTubeTest(guild, conf) {
  const s = conf?.social?.youtube;
  if (!s?.channelId || !s.channels?.length) return { ok: false, error: 'config' };
  const channel = guild.channels.cache.get(s.channelId);
  if (!channel?.isTextBased?.()) return { ok: false, error: 'channel' };
  const feed = await fetchChannelFeed(s.channels[0].id);
  if (!feed.videos.length) return { ok: false, error: 'novideo' };
  await channel.send(buildVideoMessage(s, feed.channelName, feed.videos[0], { test: true }));
  return { ok: true };
}
