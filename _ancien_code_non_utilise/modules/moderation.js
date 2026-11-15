import { PermissionFlagsBits } from 'discord.js';

export const name = 'mod';
export async function run({ message, args }) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return message.reply('Tu n\'as pas la permission.');
  }
  const sub = (args.shift() || '').toLowerCase();
  if (sub === 'clear') {
    const n = Math.min(parseInt(args[0] || '0', 10), 100);
    if (!n) return message.reply('Usage: !mod clear <1-100>');
    await message.channel.bulkDelete(n, true);
    return message.channel.send(`Supprimé ${n} messages.`);
  }
  if (sub === 'kick') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mentionne un membre.');
    await member.kick();
    return message.channel.send(`${member.user.tag} a été expulsé.`);
  }
  if (sub === 'ban') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mentionne un membre.');
    await member.ban();
    return message.channel.send(`${member.user.tag} a été banni.`);
  }
  if (sub === 'timeout') {
    const member = message.mentions.members.first();
    const minutes = parseInt(args[1] || '5', 10);
    if (!member) return message.reply('Mentionne un membre.');
    await member.timeout(minutes * 60 * 1000, 'Timeout par mod');
    return message.channel.send(`${member.user.tag} est en timeout ${minutes} min.`);
  }
  if (sub === 'warn') {
    const member = message.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'Avertissement';
    if (!member) return message.reply('Mentionne un membre.');
    return message.channel.send(`${member.user.tag} a été averti: ${reason}`);
  }
  return message.reply('Sous-commandes: clear, kick, ban, timeout, warn');
}
