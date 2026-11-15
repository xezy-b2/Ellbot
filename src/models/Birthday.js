// src/models/Birthday.js
import mongoose from 'mongoose';

const birthdaySchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  day: { type: Number, required: true, min: 1, max: 31 },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, default: null }, // facultatif, pour afficher l'âge
}, { timestamps: true });

birthdaySchema.index({ guildId: 1, userId: 1 }, { unique: true });
birthdaySchema.index({ guildId: 1, month: 1, day: 1 });

export default mongoose.models.Birthday || mongoose.model('Birthday', birthdaySchema);
