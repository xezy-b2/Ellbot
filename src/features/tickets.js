// src/features/tickets.js
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ChannelType,
    PermissionsBitField,
    MessageFlags,
    StringSelectMenuBuilder,
} from 'discord.js';
import { createTranscript } from 'discord-html-transcripts';

import GuildConfig, { incrementTicketCount } from '../models/GuildConfig.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const EMOJI = /^(<a?:\w{2,32}:\d{17,20}>|(\p{Extended_Pictographic}|\p{Regional_Indicator})(\u{FE0F}|\u{200D}|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator})*)$/u;

// Le sujet du salon garde les infos du ticket : "ticket-system user:<id> reason:<n> claimed:<id>"
export function parseTopic(topic = '') {
    return {
        userId: (topic.match(/user:(\d{17,20})/) || [])[1] || null,
        reason: (topic.match(/reason:(\d+)/) || [])[1] ?? null,
        claimedBy: (topic.match(/claimed:(\d{17,20})/) || [])[1] || null,
    };
}

const isTicketChannel = (channel) => channel?.topic?.startsWith('ticket-system') || channel?.name?.startsWith('ticket-');

function isStaff(member, config) {
    return (config?.supportRoleId && member.roles.cache.has(config.supportRoleId))
        || member.permissions.has(PermissionsBitField.Flags.ManageChannels);
}

/** Motifs proposés à l'ouverture (configurés dans le dashboard). */
export function cleanReasons(input) {
    const list = Array.isArray(input) ? input : (input && typeof input === 'object' ? Object.values(input) : []);
    return list
        .map(r => ({
            label: String(r?.label ?? '').trim().slice(0, 80),
            emoji: EMOJI.test(String(r?.emoji ?? '').trim()) ? String(r.emoji).trim() : '',
            description: String(r?.description ?? '').trim().slice(0, 100),
        }))
        .filter(r => r.label)
        .slice(0, 10);
}

// ---------------- Panneau d'ouverture ----------------
export async function postTicketPanel(guild, channelId, config) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
        console.error(`Le canal avec l'ID ${channelId} n'a pas été trouvé.`);
        return;
    }

    const { title, description } = config?.panelMessage || {};
    const reasons = cleanReasons(config?.reasons);

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title || 'Ouvrir un ticket')
        .setDescription(description || (reasons.length
            ? 'Choisis le motif de ta demande dans le menu ci-dessous pour ouvrir un ticket.'
            : 'Cliquez sur le bouton ci-dessous pour ouvrir un ticket.'));

    let row;
    if (reasons.length) {
        // Avec des motifs : un menu déroulant (un choix = un ticket)
        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket-open-select')
            .setPlaceholder('📩 Choisis le motif de ta demande…')
            .addOptions(reasons.map((r, i) => {
                const opt = { label: r.label, value: String(i) };
                if (r.description) opt.description = r.description;
                if (r.emoji) opt.emoji = r.emoji;
                return opt;
            }));
        row = new ActionRowBuilder().addComponents(menu);
    } else {
        row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket-open').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary).setEmoji('📩')
        );
    }

    try {
        // Supprime l'ancien panneau du bot dans ce salon (bouton ou menu)
        const messages = await channel.messages.fetch({ limit: 100 });
        const old = messages.filter(m => m.author.id === guild.client.user.id
            && m.components.some(c => c.components.some(b => ['ticket-open', 'ticket-open-select'].includes(b.customId))));
        for (const m of old.values()) await m.delete().catch(() => {});

        return await channel.send({ embeds: [embed], components: [row] });
    } catch (err) {
        console.error(`Erreur lors de l'envoi du panneau de tickets dans le canal ${channel.id}:`, err);
    }
}

function ticketButtons({ claimedByName = null, disabled = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket-claim')
            .setLabel(claimedByName ? `Pris en charge par ${claimedByName}`.slice(0, 80) : 'Prendre en charge')
            .setStyle(claimedByName ? ButtonStyle.Success : ButtonStyle.Primary)
            .setEmoji('🙋')
            .setDisabled(!!claimedByName || disabled),
        new ButtonBuilder().setCustomId('ticket-close').setLabel('Fermer le ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    );
}

// ---------------- Ouverture ----------------
export async function handleTicketInteraction(interaction) {
    const fromSelect = interaction.isStringSelectMenu?.() && interaction.customId === 'ticket-open-select';
    if (interaction.customId !== 'ticket-open' && !fromSelect) return;
    await interaction.deferReply(EPHEMERAL);

    try {
        const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id }).lean();
        const config = guildConfig?.ticketSystem;
        if (!config?.enabled) {
            return await interaction.editReply({ content: "Le système de tickets n'est pas configuré ou activé sur ce serveur." });
        }

        // Remet le menu à zéro pour que le membre puisse rechoisir le même motif plus tard
        if (fromSelect) await interaction.message.edit({ components: interaction.message.components }).catch(() => {});

        const reasons = cleanReasons(config.reasons);
        const reasonIndex = fromSelect ? Number(interaction.values[0]) : null;
        const reason = reasonIndex !== null ? reasons[reasonIndex] : null;

        const existingTicket = interaction.guild.channels.cache.find(c => isTicketChannel(c) && parseTopic(c.topic).userId === interaction.user.id);
        if (existingTicket) {
            return await interaction.editReply({ content: `Vous avez déjà un ticket ouvert dans ${existingTicket}.` });
        }

        // Incrément atomique (l'ancien find + save pouvait donner 2 fois le même numéro)
        const ticketId = await incrementTicketCount(interaction.guild.id);

        const memberUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 80);
        const channelName = `ticket-${ticketId}-${memberUsername}`;
        const parentCategory = config.categoryId ? interaction.guild.channels.cache.get(config.categoryId) : null;
        const staffRole = config.supportRoleId ? interaction.guild.roles.cache.get(config.supportRoleId) : null;

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            // Le bot doit garder l'accès au salon (sinon il ne peut plus le gérer ni le fermer)
            { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.EmbedLinks] },
        ];
        if (staffRole) {
            permissionOverwrites.push({ id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: parentCategory?.id || null,
            topic: `ticket-system user:${interaction.user.id}${reasonIndex !== null ? ` reason:${reasonIndex}` : ''}`,
            permissionOverwrites,
        });

        const { title: welcomeTitle, description: welcomeDescription } = config.welcomeMessage || {};
        const ticketEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(welcomeTitle || `Ticket #${ticketId}`)
            .setDescription(welcomeDescription || `Bienvenue ${interaction.user} !\n\nDécrivez votre problème en détail ici. Un membre de l'équipe de support vous répondra bientôt.`);
        if (reason) ticketEmbed.addFields({ name: 'Motif', value: `${reason.emoji ? reason.emoji + ' ' : ''}${reason.label}`, inline: true });
        ticketEmbed.setFooter({ text: config.allowOwnerClose === false ? 'Seul le staff peut fermer ce ticket.' : 'Tu peux fermer ce ticket quand ta demande est réglée.' });

        await ticketChannel.send({
            content: staffRole ? `Salut <@&${staffRole.id}> <@${interaction.user.id}>` : `Salut <@${interaction.user.id}>`,
            allowedMentions: { users: [interaction.user.id], roles: staffRole ? [staffRole.id] : [] },
            embeds: [ticketEmbed],
            components: [ticketButtons()],
        });

        await interaction.editReply({ content: `Votre ticket a été ouvert dans ${ticketChannel}.` });
    } catch (error) {
        console.error('Erreur lors de la création du ticket:', error);
        await interaction.editReply({ content: "Une erreur est survenue lors de l'ouverture de votre ticket." }).catch(() => {});
    }
}

// ---------------- Prise en charge ----------------
export async function handleTicketClaimInteraction(interaction) {
    const channel = interaction.channel;
    if (!isTicketChannel(channel)) return interaction.reply({ content: 'Ce salon n\'est pas un ticket.', ...EPHEMERAL });

    const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id }).lean();
    if (!isStaff(interaction.member, guildConfig?.ticketSystem)) {
        return interaction.reply({ content: 'Seul le staff peut prendre en charge un ticket.', ...EPHEMERAL });
    }

    const info = parseTopic(channel.topic);
    if (info.claimedBy) return interaction.reply({ content: `Ce ticket est déjà pris en charge par <@${info.claimedBy}>.`, ...EPHEMERAL, allowedMentions: { parse: [] } });

    await interaction.update({ components: [ticketButtons({ claimedByName: interaction.member.displayName })] });
    await channel.setTopic(`${channel.topic || 'ticket-system'} claimed:${interaction.user.id}`).catch(() => {});
    await channel.send({ content: `🙋 ${interaction.user} prend en charge ce ticket.`, allowedMentions: { parse: [] } });
}

// ---------------- Fermeture (avec confirmation) ----------------
export async function handleTicketCloseInteraction(interaction) {
    if (!interaction.isButton()) return;
    const channel = interaction.channel;

    if (interaction.customId === 'ticket-close-cancel') {
        return interaction.update({ content: 'Fermeture annulée.', components: [] });
    }

    if (!isTicketChannel(channel)) {
        return interaction.reply({ content: 'Cette action ne peut être utilisée que dans un ticket.', ...EPHEMERAL });
    }

    const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id }).lean();
    const config = guildConfig?.ticketSystem || {};
    const info = parseTopic(channel.topic);
    const isOwner = info.userId === interaction.user.id;
    const allowed = isStaff(interaction.member, config) || (isOwner && config.allowOwnerClose !== false);
    if (!allowed) {
        return interaction.reply({ content: "Vous n'avez pas la permission de fermer ce ticket.", ...EPHEMERAL });
    }

    // 1er clic : demande de confirmation
    if (interaction.customId === 'ticket-close') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket-close-confirm').setLabel('Oui, fermer').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('ticket-close-cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({ content: '🔒 Fermer ce ticket ? Le salon sera supprimé.', components: [row], ...EPHEMERAL });
    }

    if (interaction.customId !== 'ticket-close-confirm') return;
    await interaction.update({ content: '⏳ Fermeture en cours…', components: [] });

    try {
        const logChannel = config.logChannelId ? interaction.guild.channels.cache.get(config.logChannelId) : null;
        const reasons = cleanReasons(config.reasons);
        const reason = info.reason !== null ? reasons[Number(info.reason)] : null;

        const attachment = await createTranscript(channel, {
            limit: 500,
            filename: `${channel.name}-transcript.html`,
            returnType: 'attachment',
            // Le téléchargement des images est lent et provoque des timeouts sur les gros tickets
            saveImages: false,
            poweredBy: false,
        });

        if (logChannel?.isTextBased?.()) {
            const ticketId = channel.name.split('-')[1] || '?';
            const logEmbed = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle(`Ticket #${ticketId} fermé`)
                .setDescription('La **transcription HTML** est jointe ci-dessous.')
                .addFields(
                    { name: 'Créé par', value: info.userId ? `<@${info.userId}>` : 'Inconnu', inline: true },
                    { name: 'Fermé par', value: interaction.user.toString(), inline: true },
                    { name: 'Pris en charge par', value: info.claimedBy ? `<@${info.claimedBy}>` : 'Personne', inline: true },
                )
                .setTimestamp();
            if (reason) logEmbed.addFields({ name: 'Motif', value: `${reason.emoji ? reason.emoji + ' ' : ''}${reason.label}`, inline: true });
            await logChannel.send({ embeds: [logEmbed], files: [attachment], allowedMentions: { parse: [] } });
        } else {
            console.warn(`Pas de salon de logs de tickets pour la guilde ${interaction.guild.id} : transcription non sauvegardée.`);
        }

        // Transcription envoyée en MP au membre (option du dashboard)
        if (config.dmTranscript && info.userId) {
            const user = await interaction.client.users.fetch(info.userId).catch(() => null);
            if (user) {
                const dmFile = await createTranscript(channel, { limit: 500, filename: `${channel.name}-transcript.html`, returnType: 'attachment', saveImages: false, poweredBy: false });
                await user.send({ content: `📄 Ton ticket **${channel.name}** sur **${interaction.guild.name}** a été fermé. Voici la transcription de l'échange.`, files: [dmFile] })
                    .catch(() => {}); // MP fermés : on ignore
            }
        }

        await channel.delete(`Ticket fermé par ${interaction.user.tag}`);
    } catch (error) {
        console.error('Erreur lors de la fermeture du ticket ou de la transcription:', error);
        await interaction.editReply({ content: 'Une erreur est survenue lors de la fermeture du ticket, vérifiez les logs du bot.' }).catch(() => {});
    }
}
