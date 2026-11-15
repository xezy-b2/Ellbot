// src/logger/logEvents.js

import { getGuildConfig } from '../utils/configCache.js';
import { EmbedBuilder } from 'discord.js';
import { logDeletedMessage, logBulkDelete } from './deleteLogs.js';
import { logEditedMessage } from './editLogs.js';

function getLogChannel(guild, conf) {
  const s = conf?.logs;
  if (!s?.enabled) return null;
  const ch = guild.channels.cache.get(s.channelId);
  if (!ch?.isTextBased?.()) return null;
  return ch;
}

export function bindLogHandlers(client) {
  client.on('guildMemberAdd', async (member) => {
    const conf = await getGuildConfig(member.guild.id).catch(() => null);
    if (!conf?.logs?.enabled || !conf.logs.joins) return;
    const ch = getLogChannel(member.guild, conf);
    if (!ch) return;
    const e = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('➕ Arrivée')
      .setDescription(`${member.user.tag} (<@${member.id}>) a rejoint le serveur.`)
      .setTimestamp(new Date());

    ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(()=>{});
  });

  client.on('messageUpdate', async (oldMsg, msg) => {
    // Avec les partials activés, le nouveau message peut être incomplet : on le récupère
    if (msg.partial) msg = await msg.fetch().catch(() => null);
    if (!msg?.guild || !msg.author || msg.author.bot) return;
    // Rien de visible n'a changé (aperçu de lien ajouté, épinglage…)
    if (!oldMsg.partial && oldMsg.content === msg.content && oldMsg.attachments?.size === msg.attachments.size) return;

    const conf = await getGuildConfig(msg.guild.id).catch(() => null);
    if (!conf?.logs?.enabled || !conf.logs.messageEdited) return;

    const ch = getLogChannel(msg.guild, conf);
    if (!ch || ch.id === msg.channelId) return;

    await logEditedMessage(oldMsg, msg, ch);
  });

  client.on('messageDelete', async (message) => {
    if (!message.guild) return;
    if (message.author?.bot) return; // les messages des bots (dont le bot lui-même) ne sont pas loggés

    const conf = await getGuildConfig(message.guild.id).catch(() => null);
    if (!conf?.logs?.enabled || !conf.logs.messageDeleted) return;

    const ch = getLogChannel(message.guild, conf);
    if (!ch || ch.id === message.channelId) return; // jamais de log sur le salon de logs lui-même

    await logDeletedMessage(message, ch);
  });

  client.on('messageDeleteBulk', async (messages, channel) => {
    if (!channel?.guild) return;
    const conf = await getGuildConfig(channel.guild.id).catch(() => null);
    if (!conf?.logs?.enabled || !conf.logs.messageDeleted) return;

    const ch = getLogChannel(channel.guild, conf);
    if (!ch || ch.id === channel.id) return;

    await logBulkDelete(messages, channel, ch);
  });

  client.on('guildBanAdd', async (ban) => {
    const conf = await getGuildConfig(ban.guild.id).catch(() => null);
    if (!conf?.logs?.enabled || !conf.logs.bans) return;
    const ch = getLogChannel(ban.guild, conf);
    if (!ch) return;

    const e = new EmbedBuilder()
      .setColor(0xfb923c)
      .setTitle('🔨 Utilisateur banni')
      .setDescription(`**Utilisateur :** ${ban.user.tag} (<@${ban.user.id}>)\n**Raison :** ${ban.reason || 'Non spécifiée'}`)
      .setTimestamp(new Date());

    ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(()=>{});
  });

  client.on('guildMemberRemove', async (member) => {
    const conf = await getGuildConfig(member.guild.id).catch(() => null);
    if (!conf?.logs?.enabled || !conf.logs.leaves) return;
    const ch = getLogChannel(member.guild, conf);
    if (!ch) return;
    
    const e = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('➖ Départ')
      .setDescription(`${member.user?.tag || 'Utilisateur inconnu'} (<@${member.id}>) a quitté le serveur.`)
      .setTimestamp(new Date());

    ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(()=>{});
  });

}