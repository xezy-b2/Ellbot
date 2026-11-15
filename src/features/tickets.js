// src/features/tickets.js
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ChannelType,
    PermissionsBitField,
    MessageFlags
} from 'discord.js';
import { createTranscript } from 'discord-html-transcripts'; // <-- IMPORT POUR LA TRANSCRIPTION HTML

import GuildConfig from '../models/GuildConfig.js';
import { incrementTicketCount } from '../models/GuildConfig.js';

// Poste le panneau d'ouverture de tickets
export async function postTicketPanel(guild, channelId, config) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
        console.error(`Le canal avec l'ID ${channelId} n'a pas été trouvé.`);
        return;
    }

    const panelMessage = config?.panelMessage || {};
    const { title, description } = panelMessage;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title || "Ouvrir un ticket")
        .setDescription(description || "Cliquez sur le bouton ci-dessous pour ouvrir un ticket.");

    const openButton = new ButtonBuilder()
        .setCustomId('ticket-open')
        .setLabel('Ouvrir un ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩');

    const row = new ActionRowBuilder().addComponents(openButton);

    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const existingMessage = messages.find(m => m.author.id === guild.client.user.id && m.components.some(c => c.components.some(b => b.customId === 'ticket-open')));

        if (existingMessage) {
            await existingMessage.delete();
        }

        const message = await channel.send({ embeds: [embed], components: [row] });
        return message;
    } catch (err) {
        console.error(`Erreur lors de l'envoi du panneau de tickets dans le canal ${channel.id}:`, err);
    }
}

// Gère l'interaction de création de ticket
export async function handleTicketInteraction(interaction) {
    if (interaction.customId !== 'ticket-open') return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id });
        
        if (!guildConfig || !guildConfig.ticketSystem?.enabled) {
            return await interaction.editReply({ content: "Le système de tickets n'est pas configuré ou activé sur ce serveur.", flags: MessageFlags.Ephemeral });
        }

        const config = guildConfig.ticketSystem;
        
        const existingTicket = interaction.guild.channels.cache.find(c =>
            c.name.startsWith('ticket-') && c.topic?.includes(`user:${interaction.user.id}`)
        );

        if (existingTicket) {
            return await interaction.editReply({ content: `Vous avez déjà un ticket ouvert dans ${existingTicket}.`, flags: MessageFlags.Ephemeral });
        }
        
        // Incrément atomique (l'ancien find + save pouvait donner 2 fois le même numéro)
        const ticketId = await incrementTicketCount(interaction.guild.id);

        const memberUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 80);
        const channelName = `ticket-${ticketId}-${memberUsername}`;
        const parentCategory = config.categoryId ? interaction.guild.channels.cache.get(config.categoryId) : null;
        
        const staffRole = config.supportRoleId ? interaction.guild.roles.cache.get(config.supportRoleId) : null;

        const permissionOverwrites = [
            {
                id: interaction.guild.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
                id: interaction.user.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
            },
            {
                // Le bot doit garder l'accès au salon (sinon il ne peut plus le gérer ni le fermer)
                id: interaction.client.user.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.EmbedLinks],
            },
        ];

        if (staffRole) {
            permissionOverwrites.push({
                id: staffRole.id, 
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
            });
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: parentCategory?.id || null,
            topic: `ticket-system user:${interaction.user.id}`,
            permissionOverwrites,
        });

        const welcomeMessage = config.welcomeMessage || {};
        const { title: welcomeTitle, description: welcomeDescription } = welcomeMessage;
        
        const ticketEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(welcomeTitle || `Ticket #${ticketId}`)
            .setDescription(welcomeDescription || `Bienvenue ${interaction.user} !\n\nDécrivez votre problème en détail ici. Un membre de l'équipe de support vous répondra bientôt.`);

        const closeButton = new ButtonBuilder()
            .setCustomId('ticket-close')
            .setLabel('Fermer le ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒');

        const ticketRow = new ActionRowBuilder().addComponents(closeButton);

        await ticketChannel.send({
            content: staffRole ? `Salut <@&${staffRole.id}> <@${interaction.user.id}>` : `Salut <@${interaction.user.id}>`,
            allowedMentions: { users: [interaction.user.id], roles: staffRole ? [staffRole.id] : [] },
            embeds: [ticketEmbed],
            components: [ticketRow]
        });

        await interaction.editReply({ content: `Votre ticket a été ouvert dans ${ticketChannel}.` });

    } catch (error) {
        console.error('Erreur lors de la création du ticket:', error);
        await interaction.editReply({ content: "Une erreur est survenue lors de l'ouverture de votre ticket." }).catch(() => {});
    }
}

// Gère l'interaction de fermeture de ticket
export async function handleTicketCloseInteraction(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'ticket-close') return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.channel.name.startsWith('ticket-')) {
        return await interaction.editReply({ content: "Cette commande ne peut être utilisée que dans un canal de ticket.", flags: MessageFlags.Ephemeral });
    }

    try {
        const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id }).lean();
        const staffRoleId = guildConfig?.ticketSystem?.supportRoleId;
        
        // Peut fermer : le rôle support, ou toute personne ayant « Gérer les salons »
        const isStaff = (staffRoleId && interaction.member.roles.cache.has(staffRoleId))
            || interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels);
        if (!isStaff) {
            return await interaction.editReply({ content: "Vous n'avez pas la permission de fermer ce ticket.", flags: MessageFlags.Ephemeral });
        }

        const logChannel = interaction.guild.channels.cache.get(guildConfig.ticketSystem?.logChannelId);
        const channelToClose = interaction.channel; // Référence au canal actuel

        // =======================================================
        // --- LOGIQUE DE TRANSCRIPTION AVEC discord-html-transcripts ---
        // =======================================================

        console.log(`[ticket-close] Génération de la transcription pour ${channelToClose.name}...`);
        console.time(`[ticket-close] transcript-${channelToClose.id}`);

        const attachment = await createTranscript(channelToClose, {
            // Limite le nombre de messages récupérés pour éviter les timeouts sur les gros tickets
            limit: 500,
            // Nom du fichier généré
            fileName: `${channelToClose.name}-transcript.html`,
            // S'assurer que cela retourne un AttachmentBuilder prêt à être envoyé
            returnType: 'attachment',
            // Désactivé : le téléchargement + encodage base64 de chaque image est lent
            // et provoque souvent le timeout AbortError sur les tickets avec images
            saveImages: false,
            // Optionnel : supprime la mention "Powered by..."
            poweredBy: false
        });

        console.timeEnd(`[ticket-close] transcript-${channelToClose.id}`);
        
        // =======================================================
        // --- FIN DE LA LOGIQUE DE TRANSCRIPTION ---
        // =======================================================


        if (!logChannel) {
            console.warn(`Le canal de logs pour la guilde ${interaction.guild.id} n'a pas été trouvé. Le ticket sera supprimé sans log ni transcription.`);
            await interaction.editReply({ content: "Le ticket sera fermé, mais le canal de logs est manquant. La retranscription n'a pas pu être sauvegardée." });

        } else {
            // Log Embed
            const ticketId = channelToClose.name.split('-')[1] || '?';
            const logEmbed = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle(`Ticket #${ticketId} fermé`)
                .setDescription(`Le ticket a été fermé par ${interaction.user}. La **transcription HTML** est jointe ci-dessous.`)
                .addFields(
                  { name: 'Créé par', value: channelToClose.topic?.includes('user:') ? `<@${channelToClose.topic.split('user:')[1]}>` : 'Inconnu', inline: true },
                  { name: 'Fermé par', value: interaction.user.toString(), inline: true }
                )
                .setTimestamp();
            
            // Envoyer le message de log AVEC le fichier de retranscription
            console.time(`[ticket-close] log-send-${channelToClose.id}`);
            await logChannel.send({ 
                embeds: [logEmbed],
                files: [attachment] // L'objet AttachmentBuilder est le fichier HTML
            });
            console.timeEnd(`[ticket-close] log-send-${channelToClose.id}`);

            await interaction.editReply({ content: "Ticket fermé avec succès et retranscription HTML envoyée dans le canal de logs." });
        }

        // Suppression du canal
        console.time(`[ticket-close] channel-delete-${channelToClose.id}`);
        await channelToClose.delete('Ticket fermé par le staff.');
        console.timeEnd(`[ticket-close] channel-delete-${channelToClose.id}`);

    } catch (error) {
        console.error('Erreur lors de la fermeture du ticket ou de la transcription:', error);
        await interaction.editReply({ content: "Une erreur est survenue lors de la fermeture du ticket, vérifiez les logs du bot." }).catch(() => {});
    }
}