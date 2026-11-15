// src/features/reactionRoles.js
import {
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import ReactionRole from '../models/ReactionRole.js';

export async function postReactionRolePanel(guild, channel, config) {
  const { title, description, entries, mode, type } = config;

  const embeds = [
    new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(title || 'Choisissez vos rôles')
      .setDescription(description || 'Sélectionnez vos rôles ci-dessous :')
  ];

  const components = [];

  // Logique pour créer des boutons ou un menu déroulant
  if (type === 'dropdown') {
    if (entries.length > 25) {
      console.warn(`[RR] Le panneau '${title}' a trop d'entrées (${entries.length}) pour un menu déroulant. Seules les 25 premières seront affichées.`);
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('rr_select')
      .setMinValues(0)
      .setMaxValues(mode === 'single' ? 1 : Math.min(25, entries.length))
      .setPlaceholder('Sélectionnez…');

    for (const e of entries.slice(0, 25)) {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(e.label)
        .setValue(e.roleId);
      if (e.emoji) opt.setEmoji(e.emoji);
      selectMenu.addOptions(opt);
    }
    components.push(new ActionRowBuilder().addComponents(selectMenu));

  } else if (type === 'buttons') {
    let currentActionRow = new ActionRowBuilder();
    entries.forEach((e, index) => {
      // Limite à 5 lignes de 5 boutons (25 au total)
      if (components.length >= 5 && currentActionRow.components.length === 5) return;
      
      const button = new ButtonBuilder()
        .setCustomId(`rr-btn-${e.roleId}`)
        .setLabel(e.label)
        .setStyle(ButtonStyle[e.style] || ButtonStyle.Secondary);

      // --- CORRECTION : AJOUT DE L'ÉMOJI SUR LE BOUTON ---
      if (e.emoji) button.setEmoji(e.emoji);

      if (currentActionRow.components.length === 5) {
        components.push(currentActionRow);
        currentActionRow = new ActionRowBuilder();
      }
      currentActionRow.addComponents(button);
    });
    // Ajouter la dernière ligne si elle n'est pas vide
    if (currentActionRow.components.length > 0) {
      components.push(currentActionRow);
    }
  }

  const sent = await channel.send({ embeds, components });

  await ReactionRole.findOneAndUpdate(
    { guildId: guild.id, _id: config._id },
    { messageId: sent.id },
    { new: true }
  );

  return sent;
}

// Commande /reaction-role : AVANT elle était enregistrée mais jamais traitée
// (Discord affichait « L'application ne répond pas »).
// Format de l'option rôles : "🚀=@Rôle1, 🌟=@Rôle2"
async function handleReactionRoleCommand(interaction) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const title = interaction.options.getString('titre', true);
  const description = interaction.options.getString('description', true);
  const channel = interaction.options.getChannel('salon', true);
  const raw = interaction.options.getString('rôles', true);

  const entries = [];
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(.*?)\s*=\s*<@&(\d{17,20})>$/);
    if (!m) continue;
    const role = interaction.guild.roles.cache.get(m[2]);
    if (!role) continue;
    entries.push({ emoji: m[1].trim() || undefined, roleId: role.id, label: role.name.slice(0, 80), style: 'Secondary' });
  }
  if (!entries.length) {
    return interaction.reply({ content: '❌ Format invalide. Exemple : `🚀=@Rôle1, 🌟=@Rôle2`', ...ephemeral });
  }
  if (entries.length > 25) entries.length = 25;

  await interaction.deferReply(ephemeral);
  const doc = await ReactionRole.create({
    guildId: interaction.guild.id, channelId: channel.id, title, description, entries, mode: 'multi', type: 'buttons',
  });
  await postReactionRolePanel(interaction.guild, channel, { _id: doc._id, title, description, entries, mode: 'multi', type: 'buttons' });
  return interaction.editReply({ content: `✅ Panneau de rôles publié dans ${channel} (${entries.length} rôle(s)).` });
}

export async function handleReactionRoleInteraction(interaction) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'reaction-role') {
      return await handleReactionRoleCommand(interaction);
    }

    // Gérer l'interaction du menu déroulant
    if (interaction.isStringSelectMenu() && interaction.customId === 'rr_select') {
      const rec = await ReactionRole.findOne({
        guildId: interaction.guild.id,
        messageId: interaction.message.id
      }).lean();
      if (!rec) return interaction.reply({ content: 'Ce panneau de rôles n\'existe plus.', ...ephemeral });

      const panelRoleIds = new Set(rec.entries.map(e => e.roleId));
      const selected = new Set(interaction.values.filter(id => panelRoleIds.has(id)));
      const member = interaction.member;

      // Mode single: retire les autres rôles du panneau
      if (rec.mode === 'single') {
        const toRemove = member.roles.cache.filter(r => panelRoleIds.has(r.id) && !selected.has(r.id));
        if (toRemove.size > 0) {
          await member.roles.remove(Array.from(toRemove.keys()));
        }
      }

      const toAdd = [...selected].filter(roleId => !member.roles.cache.has(roleId));
      if (toAdd.length > 0) {
        await member.roles.add(toAdd);
      }

      return interaction.reply({ content: 'Vos rôles ont été mis à jour !', ...ephemeral });
    }

    // Gérer l'interaction des boutons
    if (interaction.isButton() && interaction.customId.startsWith('rr-btn-')) {
      const rec = await ReactionRole.findOne({
        guildId: interaction.guild.id,
        messageId: interaction.message.id
      }).lean();
      if (!rec) return interaction.reply({ content: 'Ce panneau de rôles n\'existe plus.', ...ephemeral });

      const roleId = interaction.customId.replace('rr-btn-', '');
      const allRoleIds = rec.entries.map(e => e.roleId);
      if (!allRoleIds.includes(roleId)) {
        return interaction.reply({ content: 'Ce rôle ne fait plus partie du panneau.', ...ephemeral });
      }
      const member = interaction.member;

      if (rec.mode === 'single') {
        const toRemove = member.roles.cache.filter(r => allRoleIds.includes(r.id) && r.id !== roleId);
        if (toRemove.size > 0) {
          await member.roles.remove(Array.from(toRemove.keys()));
        }
      }

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        return interaction.reply({ content: 'Le rôle a été retiré.', ...ephemeral });
      }
      await member.roles.add(roleId);
      return interaction.reply({ content: 'Le rôle a été ajouté !', ...ephemeral });
    }
  } catch (e) {
    // Cas typique : le rôle est au-dessus de celui du bot dans la hiérarchie
    console.error('[RR] Erreur lors de la mise à jour des rôles :', e.message);
    const msg = e.code === 50013
      ? "❌ Je n'ai pas la permission de gérer ce rôle (mon rôle doit être placé au-dessus dans la hiérarchie)."
      : '❌ Impossible de mettre à jour vos rôles.';
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, ...ephemeral }).catch(() => {});
    else await interaction.reply({ content: msg, ...ephemeral }).catch(() => {});
  }
}
