// src/database.js (ESM)
import mongoose from 'mongoose';

export const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/discord-bot';

let listenersBound = false;

export default async function connectDB() {
  if (mongoose.connection.readyState === 1) return; // déjà connecté

  // Les listeners doivent être posés AVANT la connexion, sinon 'connected' n'est jamais loggé.
  if (!listenersBound) {
    listenersBound = true;
    mongoose.connection.on('connected', () => console.log('[DB] Connected'));
    mongoose.connection.on('disconnected', () => console.warn('[DB] Disconnected'));
    mongoose.connection.on('error', (err) => console.error('[DB] Error', err?.message || err));
  }

  await mongoose.connect(MONGO_URI, {
    // Sans ces limites, une connexion réseau coupée pouvait bloquer une requête indéfiniment
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
}
