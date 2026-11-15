import dotenv from 'dotenv';
dotenv.config();

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/discord_dashboard',
  sessionSecret: process.env.DASHBOARD_SESSION_SECRET || 'change-me',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.DASHBOARD_BASE_URL || 'http://localhost:3000',
  callbackUrl: process.env.CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
  prefix: process.env.BOT_PREFIX || '!',
  social: {
    twitch: { clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET },
    youtube: { apiKey: process.env.YOUTUBE_API_KEY }
  }
};
