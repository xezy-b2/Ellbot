import mongoose from 'mongoose';

const userXPSchema = new mongoose.Schema({
  reputation: { type: Number, default: 0 },
  guildId: { type: String, index: true, required: true },
  userId:  { type: String, index: true, required: true },
  xp:      { type: Number, default: 0 },
  level:   { type: Number, default: 0 },
  lastMessageAt: { type: Date },
    monthlyMessages: { type: Number, default: 0 },
  cardBackground: { type: String, default: null }, 
    totalMessages: { type: Number, default: 0 }, // <-- AJOUTE CETTE LIGNE// <-- NOUVEAU CHAMP
}, { timestamps: true });

userXPSchema.index({ guildId: 1, userId: 1 }, { unique: true });
userXPSchema.index({ guildId: 1, xp: -1 });


const UserXP = mongoose.model('UserXP', userXPSchema);
export default UserXP;
