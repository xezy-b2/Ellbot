// src/models/NotifyState.js
import mongoose from 'mongoose';

const entrySchema = new mongoose.Schema({
  key: { type: String, required: true },   // ex: 'twitch:channelName', 'youtube:<channelId>', 'epic:<offerId>'
  lastIds: { type: [String], default: [] }, // mémorise les derniers éléments annoncés
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const notifyStateSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true, unique: true },
  entries: { type: [entrySchema], default: [] }
});

notifyStateSchema.statics.upsertLastIds = async function (guildId, key, ids, keep = 10) {
  const doc = await this.findOne({ guildId }) || new this({ guildId, entries: [] });
  const e = doc.entries.find(x => x.key === key);
  if (e) {
    const merged = Array.from(new Set([...ids, ...e.lastIds])).slice(0, keep);
    e.lastIds = merged;
    e.updatedAt = new Date();
  } else {
    doc.entries.push({ key, lastIds: ids.slice(0, keep), updatedAt: new Date() });
  }
  await doc.save();
  return doc;
};

notifyStateSchema.statics.getLastIds = async function (guildId, key) {
  const doc = await this.findOne({ guildId });
  const e = doc?.entries?.find(x => x.key === key);
  return e?.lastIds || [];
};

const NotifyState = mongoose.model('NotifyState', notifyStateSchema);
export default NotifyState;
