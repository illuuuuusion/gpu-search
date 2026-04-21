import { once } from 'node:events';
import { ActionRowBuilder, ActivityType, ButtonBuilder, ButtonStyle, Client, DiscordAPIError, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder, } from 'discord.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
const DISCORD_ACTIVITY_NAME = 'eBay GPU-Deals';
const SCANNER_STATE_RESET_COMMAND = 'scanner-state-reset';
const SCAN_NOW_COMMAND = 'scan-now';
const FORCE_RESCAN_COMMAND = 'force-rescan';
const DEBUG_SCAN_COMMAND = 'debug-scan';
const SCAN_INFO_COMMAND = 'scan-info';
const VCT_STATUS_COMMAND = 'vct-status';
const VCT_SYNC_COMMAND = 'vct-sync';
const COMP_BUILDER_COMMAND = 'compbuilder';
const COMP_BUILDER_PREFIX = 'vct-comp';
const ALERT_FOOTER_TEXT = 'GPU-Search';
const AUTOMATIC_SCAN_STATUS_FOOTER_TEXT = 'GPU-Search • Auto-Scan-Status';
const DISCORD_ADMIN_USER_IDS = new Set([
    '504707482547912714',
    '689513442867937321',
]);
function toDiscordColor(color) {
    return color === 'danger' ? 0xED4245 : 0x57F287;
}
function formatDiscordTimestamp(isoTimestamp) {
    const unixTimestamp = Math.floor(new Date(isoTimestamp).getTime() / 1000);
    return `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)`;
}
function formatScanStats(summary) {
    return [
        `Alerts gepostet: ${summary.alertsPosted}`,
        `Akzeptierte Treffer: ${summary.acceptedListings}`,
        `Unique Listings: ${summary.uniqueListings}`,
        `Wegen Seen übersprungen: ${summary.seenSkipped}`,
        `Sende-Fehler: ${summary.notificationFailures}`,
    ].join(' | ');
}
function formatScanStatusTitle(message) {
    if (message.phase === 'started') {
        return 'Automatischer Scan startet';
    }
    if ((message.summary?.alertsPosted ?? 0) > 0) {
        return `Automatischer Scan abgeschlossen: ${message.summary?.alertsPosted ?? 0} neue Alerts`;
    }
    return 'Automatischer Scan abgeschlossen: keine neuen Alerts';
}
function formatScanStatusDescription(message) {
    if (message.phase === 'started') {
        return message.nextAutomaticScanAt
            ? `Der nächste automatische Scan ist geplant für ${formatDiscordTimestamp(message.nextAutomaticScanAt)}.`
            : 'Der automatische Scan läuft jetzt.';
    }
    if (!message.summary) {
        return 'Der automatische Scan wurde abgeschlossen.';
    }
    return (message.summary.alertsPosted ?? 0) > 0
        ? `Der automatische Scan hat ${message.summary.alertsPosted} neue Alerts gepostet.`
        : 'Der automatische Scan hat keine neuen Alerts gefunden.';
}
function formatOptionalTimestamp(label, value) {
    return `${label}: ${value ? formatDiscordTimestamp(value) : 'noch nicht vorhanden'}`;
}
function formatInteractionErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : undefined;
}
function formatPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
}
function formatValorantProvider(provider) {
    return provider.toUpperCase();
}
function formatValorantStatusMessage(status) {
    return [
        `VALORANT-Modul aktiv: ${status.enabled ? 'ja' : 'nein'}`,
        `Aktiver Provider: ${formatValorantProvider(status.provider)}`,
        `Comp-Builder Daten bereit: ${status.aggregatedFullComps > 0 ? 'ja' : 'nein'}`,
        `Sync läuft gerade: ${status.syncRunning ? 'ja' : 'nein'}`,
        formatOptionalTimestamp('Nächster geplanter Sync', status.nextScheduledSyncAt),
        formatOptionalTimestamp('Letzter Sync-Versuch', status.lastAttemptedSyncAt),
        formatOptionalTimestamp('Letzter erfolgreicher Sync', status.lastSuccessfulSyncAt),
        `Importierte Events im Snapshot: ${status.importedEvents}`,
        `Geparste Comps: ${status.parsedCompositions}`,
        `Aggregierte Full-Comps: ${status.aggregatedFullComps}`,
        `Letzter Fehler: ${status.lastError ?? 'kein Fehler gespeichert'}`,
    ].join('\n');
}
function buildCompBuilderCustomId(sessionId, action, value) {
    return value
        ? `${COMP_BUILDER_PREFIX}:${sessionId}:${action}:${value}`
        : `${COMP_BUILDER_PREFIX}:${sessionId}:${action}`;
}
function parseCompBuilderCustomId(customId) {
    if (!customId.startsWith(`${COMP_BUILDER_PREFIX}:`)) {
        return null;
    }
    const [, sessionId, action, ...rest] = customId.split(':');
    if (!sessionId || !action) {
        return null;
    }
    return {
        sessionId,
        action,
        value: rest.length > 0 ? rest.join(':') : undefined,
    };
}
function parseRoleValue(value) {
    switch ((value ?? '').toLowerCase()) {
        case 'duelist':
            return 'Duelist';
        case 'initiator':
            return 'Initiator';
        case 'controller':
            return 'Controller';
        case 'sentinel':
            return 'Sentinel';
        default:
            return null;
    }
}
function formatCompBuilderEmbed(snapshot) {
    const embed = new EmbedBuilder()
        .setColor(snapshot.completed ? 0x57F287 : 0x5865F2)
        .setTitle('VALORANT Comp Builder')
        .setFooter({ text: `Sitzung aktiv bis ${new Date(snapshot.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` });
    if (!snapshot.selectedMapKey) {
        embed.setDescription('Wähle zuerst eine Map. Danach kannst du über Rollen und Agenten schrittweise die optimistischste Team-Comp eingrenzen.');
        if (snapshot.availableMaps.length > 0) {
            embed.addFields({
                name: 'Verfügbare Maps',
                value: snapshot.availableMaps
                    .map(map => `${map.displayName} (${map.aggregateCount} Comps)`)
                    .join('\n'),
            });
        }
        else {
            embed.addFields({
                name: 'Keine Daten vorhanden',
                value: 'Es sind noch keine aggregierten Comp-Daten verfügbar. Führe zuerst einen `/vct-sync` aus.',
            });
        }
        return embed;
    }
    embed.setDescription([
        `Map: **${snapshot.availableMaps.find(map => map.key === snapshot.selectedMapKey)?.displayName ?? snapshot.selectedMapKey}**`,
        `Picks: ${snapshot.selectedAgentDisplayNames.length > 0 ? snapshot.selectedAgentDisplayNames.join(', ') : 'noch keine'}`,
        `Gewählte Rolle: ${snapshot.selectedRole ?? 'noch keine'}`,
    ].join('\n'));
    if (snapshot.availableRoles.length > 0 && !snapshot.completed) {
        embed.addFields({
            name: 'Verfügbare Rollen',
            value: snapshot.availableRoles
                .map(role => `${role.role} (${role.agentCount})`)
                .join(' • '),
        });
    }
    if (snapshot.candidateAgents.length > 0) {
        embed.addFields({
            name: 'Beste nächste Agenten',
            value: snapshot.candidateAgents
                .slice(0, 5)
                .map(agent => `${agent.displayName}: ${formatPercent(agent.bestSmoothedWinRate)} bei ${agent.supportingGames} Maps`)
                .join('\n'),
        });
    }
    if (snapshot.topCompositions.length > 0) {
        embed.addFields({
            name: 'Top Full-Comps',
            value: snapshot.topCompositions
                .slice(0, 3)
                .map(comp => `${comp.agentDisplayNames.join(', ')}\n${formatPercent(comp.smoothedWinRate)} smoothed • ${formatPercent(comp.rawWinRate)} raw • ${comp.games} Maps`)
                .join('\n\n'),
        });
    }
    if (snapshot.exactComposition) {
        embed.addFields({
            name: 'Exakte Comp',
            value: `${snapshot.exactComposition.agentDisplayNames.join(', ')}\n${formatPercent(snapshot.exactComposition.smoothedWinRate)} smoothed • ${formatPercent(snapshot.exactComposition.rawWinRate)} raw • ${snapshot.exactComposition.games} Maps`,
        });
    }
    return embed;
}
function buildCompBuilderComponents(snapshot) {
    const rows = [];
    if (snapshot.availableMaps.length > 0) {
        const mapRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'map'))
            .setPlaceholder('Map auswählen')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(snapshot.availableMaps.map(map => ({
            label: map.displayName,
            value: map.key,
            description: `${map.aggregateCount} Full-Comps im Datensatz`,
            default: map.key === snapshot.selectedMapKey,
        }))));
        rows.push(mapRow);
    }
    if (snapshot.selectedMapKey && snapshot.availableRoles.length > 0 && !snapshot.completed) {
        const roleRow = new ActionRowBuilder().addComponents(...snapshot.availableRoles.map(role => new ButtonBuilder()
            .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'role', role.role.toLowerCase()))
            .setLabel(`${role.role} (${role.agentCount})`)
            .setStyle(role.role === snapshot.selectedRole ? ButtonStyle.Primary : ButtonStyle.Secondary)));
        rows.push(roleRow);
    }
    if (snapshot.selectedRole && snapshot.candidateAgents.length > 0 && !snapshot.completed) {
        const agentRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'agent'))
            .setPlaceholder(`${snapshot.selectedRole} wählen`)
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(snapshot.candidateAgents.map(agent => ({
            label: agent.displayName,
            value: agent.key,
            description: `Best ${formatPercent(agent.bestSmoothedWinRate)} • ${agent.supportingGames} Maps`,
        }))));
        rows.push(agentRow);
    }
    const controlsRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'back'))
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!snapshot.selectedMapKey && !snapshot.selectedRole && snapshot.selectedAgentKeys.length === 0), new ButtonBuilder()
        .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'reset'))
        .setLabel('Reset')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!snapshot.selectedMapKey && !snapshot.selectedRole && snapshot.selectedAgentKeys.length === 0));
    rows.push(controlsRow);
    return rows;
}
function isUnknownInteractionError(error) {
    return error instanceof DiscordAPIError && error.code === 10062;
}
function isAlreadyAcknowledgedInteractionError(error) {
    return error instanceof DiscordAPIError && error.code === 40060;
}
export class DiscordNotifier {
    options;
    client = new Client({
        intents: [GatewayIntentBits.Guilds],
        presence: {
            activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
            status: 'online',
        },
    });
    nextSendAt = 0;
    readyPromise = null;
    commandsRegistered = false;
    activeAutomaticScanStatus = null;
    constructor(options = {}) {
        this.options = options;
        if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
            throw new Error('Missing Discord configuration');
        }
        this.client.on(Events.InteractionCreate, interaction => {
            void this.handleInteraction(interaction).catch(error => {
                if (isUnknownInteractionError(error)) {
                    logger.warn({
                        commandName: interaction.isChatInputCommand() ? interaction.commandName : interaction.isMessageComponent() ? interaction.customId : undefined,
                        interactionId: interaction.id,
                    }, 'Discord interaction expired before it could be acknowledged');
                    return;
                }
                if (isAlreadyAcknowledgedInteractionError(error)) {
                    logger.warn({
                        commandName: interaction.isChatInputCommand() ? interaction.commandName : interaction.isMessageComponent() ? interaction.customId : undefined,
                        interactionId: interaction.id,
                    }, 'Discord interaction had already been acknowledged');
                    return;
                }
                logger.error({
                    error,
                    commandName: interaction.isChatInputCommand() ? interaction.commandName : interaction.isMessageComponent() ? interaction.customId : undefined,
                    interactionId: interaction.id,
                }, 'Failed to handle Discord interaction');
            });
        });
    }
    async start() {
        if (this.client.isReady()) {
            return;
        }
        if (!this.readyPromise) {
            this.readyPromise = (async () => {
                const ready = once(this.client, Events.ClientReady);
                await this.client.login(env.DISCORD_BOT_TOKEN);
                if (!this.client.isReady()) {
                    await ready;
                }
                this.client.user?.setPresence({
                    activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
                    status: 'online',
                });
                await this.registerCommands();
            })();
        }
        await this.readyPromise;
    }
    async waitForSendWindow() {
        const waitMs = this.nextSendAt - Date.now();
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
    async send(message) {
        await this.start();
        await this.waitForSendWindow();
        const channel = await this.fetchMessageChannel();
        const embed = this.buildAlertEmbed(message);
        const sentMessage = await channel.send({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
        this.nextSendAt = Date.now() + env.DISCORD_SEND_DELAY_MS;
        return {
            messageId: sentMessage.id,
            channelId: sentMessage.channelId,
        };
    }
    async sendScanStatus(message) {
        await this.start();
        await this.waitForSendWindow();
        const channel = await this.fetchMessageChannel();
        const embed = this.buildScanStatusEmbed(message);
        if (message.trigger === 'automatic') {
            if (message.phase === 'started') {
                const latestMessage = await this.fetchLatestMessage(channel);
                const targetMessage = latestMessage && this.isAutomaticScanStatusMessage(latestMessage)
                    ? latestMessage
                    : null;
                const storedMessage = targetMessage
                    ? await targetMessage.edit({ embeds: [embed], allowedMentions: { parse: [] } })
                    : await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
                this.activeAutomaticScanStatus = {
                    messageId: storedMessage.id,
                    channelId: storedMessage.channelId,
                };
            }
            else {
                const updated = await this.updateActiveAutomaticScanStatus(channel, embed);
                if (!updated) {
                    const sentMessage = await channel.send({
                        embeds: [embed],
                        allowedMentions: { parse: [] },
                    });
                    this.activeAutomaticScanStatus = {
                        messageId: sentMessage.id,
                        channelId: sentMessage.channelId,
                    };
                }
            }
        }
        else {
            await channel.send({
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
        }
        this.nextSendAt = Date.now() + env.DISCORD_SEND_DELAY_MS;
    }
    async delete(receipt) {
        if (!receipt.messageId) {
            return;
        }
        await this.start();
        const channelId = receipt.channelId ?? env.DISCORD_CHANNEL_ID;
        const channel = await this.client.channels.fetch(channelId);
        if (!channel?.isTextBased() || !('messages' in channel)) {
            throw new Error('Configured Discord channel is not text-based');
        }
        try {
            const message = await channel.messages.fetch(receipt.messageId);
            await message.delete();
        }
        catch (error) {
            if (error instanceof DiscordAPIError && error.code === 10008) {
                return;
            }
            throw error;
        }
    }
    buildAlertEmbed(message) {
        const embed = new EmbedBuilder()
            .setColor(toDiscordColor(message.color))
            .setTitle(message.title)
            .setURL(message.url)
            .setDescription(message.description)
            .addFields(message.fields)
            .setFooter({ text: ALERT_FOOTER_TEXT });
        if (message.imageUrl) {
            embed.setImage(message.imageUrl);
        }
        return embed;
    }
    buildScanStatusEmbed(message) {
        const embed = new EmbedBuilder()
            .setColor(message.phase === 'started' ? 0x5865F2 : ((message.summary?.alertsPosted ?? 0) > 0 ? 0x57F287 : 0xFEE75C))
            .setTitle(formatScanStatusTitle(message))
            .setDescription(formatScanStatusDescription(message))
            .setFooter({ text: message.trigger === 'automatic' ? AUTOMATIC_SCAN_STATUS_FOOTER_TEXT : ALERT_FOOTER_TEXT });
        if (message.summary) {
            embed.addFields({ name: 'Alerts gepostet', value: String(message.summary.alertsPosted), inline: true }, { name: 'Akzeptierte Treffer', value: String(message.summary.acceptedListings), inline: true }, { name: 'Unique Listings', value: String(message.summary.uniqueListings), inline: true }, { name: 'Wegen Seen übersprungen', value: String(message.summary.seenSkipped), inline: true }, { name: 'Sende-Fehler', value: String(message.summary.notificationFailures), inline: true });
        }
        if (message.nextAutomaticScanAt) {
            embed.addFields({
                name: 'Nächster automatischer Scan',
                value: formatDiscordTimestamp(message.nextAutomaticScanAt),
                inline: false,
            });
        }
        return embed;
    }
    async fetchMessageChannel() {
        const channel = await this.client.channels.fetch(env.DISCORD_CHANNEL_ID);
        if (!channel?.isTextBased() || !channel.isSendable() || !('messages' in channel)) {
            throw new Error('Configured Discord channel is not a sendable text channel');
        }
        return channel;
    }
    async fetchLatestMessage(channel) {
        const messages = await channel.messages.fetch({ limit: 1 });
        return messages.first() ?? null;
    }
    isAutomaticScanStatusMessage(message) {
        return message.author.id === this.client.user?.id
            && message.embeds.some(embed => embed.footer?.text === AUTOMATIC_SCAN_STATUS_FOOTER_TEXT);
    }
    async updateActiveAutomaticScanStatus(channel, embed) {
        if (!this.activeAutomaticScanStatus?.messageId) {
            return false;
        }
        try {
            const message = await channel.messages.fetch(this.activeAutomaticScanStatus.messageId);
            const updated = await message.edit({
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
            this.activeAutomaticScanStatus = {
                messageId: updated.id,
                channelId: updated.channelId,
            };
            return true;
        }
        catch (error) {
            if (error instanceof DiscordAPIError && error.code === 10008) {
                this.activeAutomaticScanStatus = null;
                return false;
            }
            throw error;
        }
    }
    async registerCommands() {
        if (this.commandsRegistered || !this.client.application) {
            return;
        }
        const channel = await this.client.channels.fetch(env.DISCORD_CHANNEL_ID);
        const guildId = channel && !channel.isDMBased() && 'guildId' in channel
            ? channel.guildId
            : undefined;
        const commands = [
            new SlashCommandBuilder()
                .setName(SCANNER_STATE_RESET_COMMAND)
                .setDescription('Setzt den lokalen Scanner-State zurück.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(SCAN_NOW_COMMAND)
                .setDescription('Startet sofort einen manuellen Scan und setzt den Auto-Timer neu.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(FORCE_RESCAN_COMMAND)
                .setDescription('Scannt das aktuelle Fenster neu und ignoriert bereits gepostete Listings.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(DEBUG_SCAN_COMMAND)
                .setDescription('Startet einen Live-Debugscan mit stark gelockerten Preislimits.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(SCAN_INFO_COMMAND)
                .setDescription('Zeigt an, wann der nächste automatische Scan geplant ist.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(VCT_STATUS_COMMAND)
                .setDescription('Zeigt den Status des VALORANT-VCT-Ingests an.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(VCT_SYNC_COMMAND)
                .setDescription('Startet sofort einen manuellen VALORANT-VCT-Sync.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(COMP_BUILDER_COMMAND)
                .setDescription('Startet den interaktiven VALORANT Comp Builder.')
                .toJSON(),
        ];
        if (guildId) {
            await this.client.application.commands.set(commands, guildId);
        }
        else {
            await this.client.application.commands.set(commands);
        }
        this.commandsRegistered = true;
    }
    async handleInteraction(interaction) {
        if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(`${COMP_BUILDER_PREFIX}:`)) {
            await this.handleCompBuilderComponentInteraction(interaction);
            return;
        }
        if (!interaction.isChatInputCommand()) {
            return;
        }
        if (interaction.commandName !== SCANNER_STATE_RESET_COMMAND &&
            interaction.commandName !== SCAN_NOW_COMMAND &&
            interaction.commandName !== FORCE_RESCAN_COMMAND &&
            interaction.commandName !== DEBUG_SCAN_COMMAND &&
            interaction.commandName !== SCAN_INFO_COMMAND &&
            interaction.commandName !== VCT_STATUS_COMMAND &&
            interaction.commandName !== VCT_SYNC_COMMAND &&
            interaction.commandName !== COMP_BUILDER_COMMAND) {
            return;
        }
        if (interaction.commandName === COMP_BUILDER_COMMAND) {
            if (!this.options.onValorantCompBuilderStart) {
                await interaction.reply({
                    content: 'Der Comp Builder ist aktuell nicht verfügbar.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const snapshot = await this.options.onValorantCompBuilderStart(interaction.user.id);
            await interaction.reply({
                embeds: [formatCompBuilderEmbed(snapshot)],
                components: buildCompBuilderComponents(snapshot),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!DISCORD_ADMIN_USER_IDS.has(interaction.user.id)) {
            await interaction.reply({
                content: 'Du bist für diesen Command nicht freigeschaltet.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === SCANNER_STATE_RESET_COMMAND && !this.options.onScannerStateReset) {
            await interaction.reply({
                content: 'Scanner-State-Reset ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === SCAN_NOW_COMMAND && !this.options.onManualScanRequested) {
            await interaction.reply({
                content: 'Manueller Scan ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === FORCE_RESCAN_COMMAND && !this.options.onForceRescanRequested) {
            await interaction.reply({
                content: 'Force-Rescan ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === DEBUG_SCAN_COMMAND && !this.options.onDebugScanRequested) {
            await interaction.reply({
                content: 'Debug-Scan ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === SCAN_INFO_COMMAND && !this.options.onScanInfoRequested) {
            await interaction.reply({
                content: 'Scan-Info ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_STATUS_COMMAND && !this.options.onValorantStatusRequested) {
            await interaction.reply({
                content: 'VALORANT-Status ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_SYNC_COMMAND && !this.options.onValorantSyncRequested) {
            await interaction.reply({
                content: 'VALORANT-Sync ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (interaction.commandName === VCT_STATUS_COMMAND) {
                const status = await this.options.onValorantStatusRequested?.();
                await interaction.editReply(status ? formatValorantStatusMessage(status) : 'VALORANT-Status ist aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_SYNC_COMMAND) {
                const result = await this.options.onValorantSyncRequested?.();
                if (!result) {
                    await interaction.editReply('VALORANT-Sync ist aktuell nicht verfügbar.');
                    return;
                }
                await interaction.editReply([
                    `VALORANT-VCT-Sync abgeschlossen: ${result.run.status}.`,
                    `Provider: ${formatValorantProvider(result.run.provider)}`,
                    `Importierte Events: ${result.run.importedEvents}`,
                    `Geparste Comps: ${result.run.parsedCompositions}`,
                    `Aggregierte Full-Comps: ${result.run.aggregatedFullComps}`,
                    `Letzter erfolgreicher Sync: ${result.state.metadata.lastSuccessfulSyncAt ? formatDiscordTimestamp(result.state.metadata.lastSuccessfulSyncAt) : 'noch nicht vorhanden'}`,
                    `Letzter Fehler: ${result.run.error ?? result.state.metadata.lastError ?? 'kein Fehler gespeichert'}`,
                ].join('\n'));
                return;
            }
            if (interaction.commandName === SCAN_INFO_COMMAND) {
                const info = await this.options.onScanInfoRequested?.();
                const message = info?.nextAutomaticScanAt
                    ? `Nächster automatischer Scan: ${formatDiscordTimestamp(info.nextAutomaticScanAt)}. Scan läuft gerade: ${info.scanRunning ? 'ja' : 'nein'}.`
                    : `Es ist aktuell kein nächster automatischer Scan geplant. Scan läuft gerade: ${info?.scanRunning ? 'ja' : 'nein'}.`;
                await interaction.editReply(message);
                return;
            }
            if (interaction.commandName === SCANNER_STATE_RESET_COMMAND) {
                const result = await this.options.onScannerStateReset?.();
                await interaction.editReply(`Scanner-State wurde zurückgesetzt. Seen: ${result?.seenCount ?? 0}, Beobachtungen: ${result?.observationCount ?? 0}.`);
                return;
            }
            const result = interaction.commandName === FORCE_RESCAN_COMMAND
                ? await this.options.onForceRescanRequested?.()
                : interaction.commandName === DEBUG_SCAN_COMMAND
                    ? await this.options.onDebugScanRequested?.()
                    : await this.options.onManualScanRequested?.();
            if (!result) {
                await interaction.editReply(interaction.commandName === FORCE_RESCAN_COMMAND
                    ? 'Force-Rescan ist aktuell nicht verfügbar.'
                    : interaction.commandName === DEBUG_SCAN_COMMAND
                        ? 'Debug-Scan ist aktuell nicht verfügbar.'
                        : 'Manueller Scan ist aktuell nicht verfügbar.');
                return;
            }
            if (result.status === 'queued_after_running_scan') {
                await interaction.editReply(interaction.commandName === FORCE_RESCAN_COMMAND
                    ? `Es läuft bereits ein Scan. Der Force-Rescan wurde danach ausgeführt. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
                    : interaction.commandName === DEBUG_SCAN_COMMAND
                        ? `Es läuft bereits ein Scan. Der Debug-Scan wurde danach ausgeführt. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
                        : `Es läuft bereits ein Scan. Der manuelle Scan wurde danach ausgeführt. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`);
                return;
            }
            await interaction.editReply(interaction.commandName === FORCE_RESCAN_COMMAND
                ? `Force-Rescan abgeschlossen. Bereits gepostete Listings wurden für dieses Fenster ignoriert. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
                : interaction.commandName === DEBUG_SCAN_COMMAND
                    ? `Debug-Scan abgeschlossen. Nur die Preislogik wurde stark gelockert, Wort-/Zubehörfilter blieben aktiv. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
                    : `Manueller Scan abgeschlossen. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`);
        }
        catch (error) {
            if (interaction.commandName === SCANNER_STATE_RESET_COMMAND) {
                await interaction.editReply('Scanner-State konnte nicht zurückgesetzt werden.');
            }
            else if (interaction.commandName === FORCE_RESCAN_COMMAND) {
                await interaction.editReply('Force-Rescan konnte nicht gestartet werden.');
            }
            else if (interaction.commandName === DEBUG_SCAN_COMMAND) {
                await interaction.editReply('Debug-Scan konnte nicht gestartet werden.');
            }
            else if (interaction.commandName === SCAN_INFO_COMMAND) {
                await interaction.editReply('Scan-Info konnte nicht geladen werden.');
            }
            else if (interaction.commandName === VCT_SYNC_COMMAND) {
                const formattedError = formatInteractionErrorMessage(error);
                await interaction.editReply(formattedError
                    ? `VALORANT-Sync fehlgeschlagen.\n${formattedError}`
                    : 'VALORANT-Sync konnte nicht gestartet werden.');
            }
            else if (interaction.commandName === VCT_STATUS_COMMAND) {
                await interaction.editReply('VALORANT-Status konnte nicht geladen werden.');
            }
            else {
                await interaction.editReply('Manueller Scan konnte nicht gestartet werden.');
            }
            throw error;
        }
    }
    async handleCompBuilderComponentInteraction(interaction) {
        const parsed = parseCompBuilderCustomId(interaction.customId);
        if (!parsed || !this.options.onValorantCompBuilderAction) {
            await interaction.reply({
                content: 'Diese Comp-Builder-Aktion ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        let action = null;
        if (parsed.action === 'back') {
            action = { type: 'back' };
        }
        else if (parsed.action === 'reset') {
            action = { type: 'reset' };
        }
        else if (parsed.action === 'role' && interaction.isButton()) {
            const role = parseRoleValue(parsed.value);
            if (role) {
                action = { type: 'set_role', role };
            }
        }
        else if (parsed.action === 'map' && interaction.isStringSelectMenu()) {
            const mapKey = interaction.values[0];
            if (mapKey) {
                action = { type: 'set_map', mapKey };
            }
        }
        else if (parsed.action === 'agent' && interaction.isStringSelectMenu()) {
            const agentKey = interaction.values[0];
            if (agentKey) {
                action = { type: 'pick_agent', agentKey };
            }
        }
        if (!action) {
            await interaction.reply({
                content: 'Diese Comp-Builder-Aktion konnte nicht verarbeitet werden.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const snapshot = await this.options.onValorantCompBuilderAction({
            userId: interaction.user.id,
            sessionId: parsed.sessionId,
            action,
        });
        if (!snapshot) {
            await interaction.reply({
                content: 'Diese Comp-Builder-Sitzung ist abgelaufen oder gehört dir nicht. Starte `/compbuilder` neu.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.update({
            embeds: [formatCompBuilderEmbed(snapshot)],
            components: buildCompBuilderComponents(snapshot),
        });
    }
}
