export const name = 'ping';
export async function run({ message }) {
  const sent = await message.channel.send('Pong...');
  await sent.edit(`Pong! Latence: ${sent.createdTimestamp - message.createdTimestamp}ms`);
}
