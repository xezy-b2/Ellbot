// src/models/ReactionRole.js
import mongoose from 'mongoose';

// Remplacez votre schema par celui-ci
const ReactionRoleSchema = new mongoose.Schema({
  guildId: { type: String, index: true },
  channelId: String,
  messageId: String,
  title: String,
  description: String,
  entries: [
    {
      roleId: String,
      label: String,
      emoji: String,
      // AJOUTEZ CETTE LIGNE
      style: { type: String, enum: ['Primary', 'Secondary', 'Success', 'Danger'], default: 'Secondary' }
    }
  ],
  mode: { type: String, enum: ['multi', 'single'], default: 'multi' },
  type: { type: String, enum: ['dropdown', 'buttons'], default: 'dropdown' },
}, { timestamps: true });

export default mongoose.models.ReactionRole || mongoose.model('ReactionRole', ReactionRoleSchema);