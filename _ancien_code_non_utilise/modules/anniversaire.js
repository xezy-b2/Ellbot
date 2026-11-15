import UserProfile from '../models/UserProfile.js';

export const name = 'anniversaire';
export async function run({ message, args }) {
  const sub = (args.shift() || '').toLowerCase();
  if (sub === 'activer') {
    return message.channel.send('Le système d\'anniversaires est géré via le dashboard.');
  }
  if (sub === 'définir' || sub === 'definir') {
    const date = args[0]; // DD-MM
    if (!/^\d{2}-\d{2}$/.test(date)) return message.reply('Format attendu: JJ-MM');
    let profile = await UserProfile.findOne({ guildId: message.guild.id, userId: message.author.id });
    if (!profile) profile = await UserProfile.create({ guildId: message.guild.id, userId: message.author.id });
    profile.birthday = date;
    await profile.save();
    return message.channel.send(`Anniversaire enregistré pour ${message.author}: ${date}`);
  }
  if (sub === 'supprimer') {
    const profile = await UserProfile.findOne({ guildId: message.guild.id, userId: message.author.id });
    if (!profile || !profile.birthday) return message.reply('Aucun anniversaire enregistré.');
    profile.birthday = null;
    await profile.save();
    return message.channel.send('Anniversaire supprimé.');
  }
  if (sub === 'liste') {
    const list = await UserProfile.find({ guildId: message.guild.id, birthday: { $ne: null } });
    if (!list.length) return message.channel.send('Aucun anniversaire enregistré.');
    const lines = list.map(p => `<@${p.userId}> - ${p.birthday}`);
    return message.channel.send('**Anniversaires**\n' + lines.join('\n'));
  }
  return message.reply('Sous-commandes: liste, activer, définir, supprimer');
}
