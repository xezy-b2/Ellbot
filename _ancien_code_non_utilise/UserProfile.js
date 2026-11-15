import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema({
  guildId: { type: String, index: true },
  userId: { type: String, index: true },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 0 },
  lastXpAt: { type: Date, default: null },
  monthlyMessages: { type: Number, default: 0 },
  birthday: { type: String, default: null } // format: DD-MM
}, { timestamps: true });

userProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export default mongoose.model('UserProfile', userProfileSchema);
