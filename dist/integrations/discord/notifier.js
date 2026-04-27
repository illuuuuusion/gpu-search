import { once } from 'node:events';
import { ActionRowBuilder, ActivityType, ButtonBuilder, ButtonStyle, Client, DiscordAPIError, EmbedBuilder, Events, GatewayIntentBits, ModalBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { DiscordAdminStateStore } from './adminState.js';
import { formatGuildConfigSummary, parseReminderDuration, renderWelcomeTemplate } from './adminUtils.js';
const DISCORD_ACTIVITY_NAME = 'eBay GPU-Deals';
const SCANNER_STATE_RESET_COMMAND = 'scanner-state-reset';
const SCAN_NOW_COMMAND = 'scan-now';
const FORCE_RESCAN_COMMAND = 'force-rescan';
const DEBUG_SCAN_COMMAND = 'debug-scan';
const SCAN_INFO_COMMAND = 'scan-info';
const CONFIG_COMMAND = 'config';
const POLL_COMMAND = 'poll';
const DELETE_COMMAND = 'delete';
const WARN_COMMAND = 'warn';
const WARNINGS_COMMAND = 'warnings';
const REMIND_COMMAND = 'remind';
const VCT_STATUS_COMMAND = 'vct-status';
const VCT_SYNC_COMMAND = 'vct-sync';
const VCT_SCAN_COMMAND = 'vct-scan';
const VCT_HELP_COMMAND = 'vct-help';
const VCT_TOP_COMMAND = 'vct-top';
const VCT_AGENT_COMMAND = 'vct-agent';
const VCT_MAP_META_COMMAND = 'vct-map-meta';
const VCT_EVENTS_COMMAND = 'vct-events';
const VCT_TEAM_COMMAND = 'vct-team';
const COMP_BUILDER_COMMAND = 'compbuilder';
const COMP_BUILDER_PREFIX = 'vct-comp';
const COMP_BUILDER_PRESET_MODAL_PREFIX = 'vct-comp-preset';
const ALERT_FOOTER_TEXT = 'GPU-Search';
const AUTOMATIC_SCAN_STATUS_FOOTER_TEXT = 'GPU-Search • Auto-Scan-Status';
const MARKET_DIGEST_FOOTER_TEXT = 'GPU-Search • Markt-Zusammenfassung';
const VALORANT_SYNC_FOOTER_TEXT = 'GPU-Search • VALORANT Meta Update';
const MODERATION_LOG_FOOTER_TEXT = 'GPU-Search • Moderation';
const POLL_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
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
function formatHealthState(healthState) {
    return healthState === 'healthy' ? 'gesund' : 'degraded';
}
function formatConfidenceLabel(games) {
    if (games >= 18) {
        return 'sehr stabil';
    }
    if (games >= 8) {
        return 'solide Daten';
    }
    return 'kleine Stichprobe';
}
function formatCompBuilderFilters(snapshot) {
    const filters = [];
    if (snapshot.filters.scope) {
        filters.push(snapshot.filters.scope.toUpperCase());
    }
    if (snapshot.filters.eventStatus) {
        filters.push(`Status ${snapshot.filters.eventStatus}`);
    }
    if (snapshot.filters.days) {
        filters.push(`letzte ${snapshot.filters.days} Tage`);
    }
    if (snapshot.filters.teamQuery) {
        filters.push(`Team ${snapshot.filters.teamQuery}`);
    }
    if (snapshot.filters.eventId) {
        filters.push(`Event ${snapshot.filters.eventId}`);
    }
    return filters.length > 0 ? filters.join(' • ') : 'alle Daten';
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
        `Datensatz-Gesundheit: ${formatHealthState(status.healthState)}`,
        `Health-Hinweise: ${status.healthReasons.length > 0 ? status.healthReasons.join(' | ') : 'keine'}`,
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
function parseScopeValue(value) {
    switch ((value ?? '').toLowerCase()) {
        case 'americas':
            return 'americas';
        case 'emea':
            return 'emea';
        case 'pacific':
            return 'pacific';
        case 'china':
            return 'china';
        case 'masters':
            return 'masters';
        case 'champions':
            return 'champions';
        default:
            return undefined;
    }
}
function parseStatusValue(value) {
    switch ((value ?? '').toLowerCase()) {
        case 'upcoming':
            return 'upcoming';
        case 'ongoing':
            return 'ongoing';
        case 'completed':
            return 'completed';
        default:
            return undefined;
    }
}
function buildPresetModalCustomId(sessionId) {
    return `${COMP_BUILDER_PRESET_MODAL_PREFIX}:${sessionId}`;
}
function parsePresetModalCustomId(customId) {
    if (!customId.startsWith(`${COMP_BUILDER_PRESET_MODAL_PREFIX}:`)) {
        return null;
    }
    return customId.slice(`${COMP_BUILDER_PRESET_MODAL_PREFIX}:`.length) || null;
}
function formatCompBuilderEmbed(snapshot) {
    const embed = new EmbedBuilder()
        .setColor(snapshot.healthState === 'degraded' ? 0xFEE75C : snapshot.completed ? 0x57F287 : 0x5865F2)
        .setTitle('VALORANT Comp Builder')
        .setFooter({
        text: `${formatValorantProvider(snapshot.provider)} • ${snapshot.importedEvents} Events • Stand ${snapshot.lastSuccessfulSyncAt
            ? new Date(snapshot.lastSuccessfulSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
            : 'unbekannt'} UTC • Sitzung bis ${new Date(snapshot.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`,
    });
    if (!snapshot.selectedMapKey) {
        embed.setDescription([
            'Wähle zuerst eine Map. Danach kannst du über Rollen und Agenten schrittweise die optimistischste Team-Comp eingrenzen.',
            `Filter: ${formatCompBuilderFilters(snapshot)}`,
            `Datensatz: ${formatHealthState(snapshot.healthState)}`,
        ].join('\n'));
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
        if (snapshot.savedPresets.length > 0) {
            embed.addFields({
                name: 'Gespeicherte Presets',
                value: snapshot.savedPresets
                    .slice(0, 5)
                    .map(preset => `${preset.name} • ${new Date(preset.updatedAt).toLocaleDateString('de-DE', { timeZone: 'UTC' })}`)
                    .join('\n'),
            });
        }
        return embed;
    }
    embed.setDescription([
        `Filter: ${formatCompBuilderFilters(snapshot)}`,
        `Map: **${snapshot.availableMaps.find(map => map.key === snapshot.selectedMapKey)?.displayName ?? snapshot.selectedMapKey}**`,
        `Core: ${snapshot.selectedAgentDisplayNames.length > 0 ? snapshot.selectedAgentDisplayNames.join(', ') : 'noch keine'}`,
        `Ausgeschlossen: ${snapshot.excludedAgentDisplayNames.length > 0 ? snapshot.excludedAgentDisplayNames.join(', ') : 'keine'}`,
        `Gewählte Rolle: ${snapshot.selectedRole ?? 'noch keine'}`,
        snapshot.replacementAgentKey ? `Ersatz gesucht für: ${snapshot.replacementAgentKey}` : undefined,
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
                .map(agent => `${agent.displayName}: ${formatPercent(agent.bestSmoothedWinRate)} • ${agent.supportingGames} Maps • ${formatConfidenceLabel(agent.supportingGames)}`)
                .join('\n'),
        });
    }
    if (snapshot.topCompositions.length > 0) {
        embed.addFields({
            name: 'Top Full-Comps',
            value: snapshot.topCompositions
                .slice(0, 3)
                .map(comp => [
                `${comp.agentDisplayNames.join(', ')}`,
                `${formatPercent(comp.smoothedWinRate)} smoothed • ${formatPercent(comp.rawWinRate)} raw • ${comp.games} Maps • ${comp.confidenceLabel}`,
                `Zuletzt: ${formatOptionalTimestamp('Sichtung', comp.lastPlayedAt).replace('Sichtung: ', '')}`,
                `Teams: ${comp.exampleTeams.join(', ')}`,
                comp.eventNames.length > 0 ? `Events: ${comp.eventNames.join(' | ')}` : undefined,
                comp.latestSourceUrl ? `Quelle: ${comp.latestSourceUrl}` : undefined,
            ].filter((line) => Boolean(line)).join('\n'))
                .join('\n\n'),
        });
    }
    if (snapshot.exactComposition) {
        embed.addFields({
            name: 'Exakte Comp',
            value: [
                snapshot.exactComposition.agentDisplayNames.join(', '),
                `${formatPercent(snapshot.exactComposition.smoothedWinRate)} smoothed • ${formatPercent(snapshot.exactComposition.rawWinRate)} raw • ${snapshot.exactComposition.games} Maps • ${snapshot.exactComposition.confidenceLabel}`,
                `Zuletzt: ${formatOptionalTimestamp('Sichtung', snapshot.exactComposition.lastPlayedAt).replace('Sichtung: ', '')}`,
                `Teams: ${snapshot.exactComposition.exampleTeams.join(', ')}`,
                snapshot.exactComposition.eventNames.length > 0 ? `Events: ${snapshot.exactComposition.eventNames.join(' | ')}` : undefined,
                snapshot.exactComposition.latestSourceUrl ? `Quelle: ${snapshot.exactComposition.latestSourceUrl}` : undefined,
            ].filter((line) => Boolean(line)).join('\n'),
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
    if (!snapshot.selectedMapKey && snapshot.savedPresets.length > 0) {
        const presetRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'preset'))
            .setPlaceholder('Preset laden')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(snapshot.savedPresets.map(preset => ({
            label: preset.name.slice(0, 100),
            value: preset.id,
            description: `Aktualisiert ${new Date(preset.updatedAt).toLocaleDateString('de-DE', { timeZone: 'UTC' })}`,
        }))));
        rows.push(presetRow);
    }
    else if (snapshot.selectedMapKey && snapshot.availableRoles.length > 0 && !snapshot.completed) {
        const roleRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'role-select'))
            .setPlaceholder('Rolle wählen')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(snapshot.availableRoles.map(role => ({
            label: `${role.role} (${role.agentCount})`,
            value: role.role.toLowerCase(),
            default: role.role === snapshot.selectedRole,
        }))));
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
    if (snapshot.selectedMapKey) {
        const utilityOptions = [];
        utilityOptions.push(...snapshot.selectedAgentKeys.slice(0, 5).map(agentKey => ({
            label: `Ersetze ${snapshot.selectedAgentDisplayNames[snapshot.selectedAgentKeys.indexOf(agentKey)] ?? agentKey}`,
            value: `replace:${agentKey}`,
            description: 'Zeigt direkte Alternativen fuer diesen Slot',
        })));
        utilityOptions.push(...snapshot.excludedAgentKeys.slice(0, 5).map(agentKey => ({
            label: `Nimm ${snapshot.excludedAgentDisplayNames[snapshot.excludedAgentKeys.indexOf(agentKey)] ?? agentKey} wieder rein`,
            value: `include:${agentKey}`,
            description: 'Entfernt den Ausschluss',
        })));
        utilityOptions.push(...snapshot.candidateAgents
            .filter(agent => !snapshot.excludedAgentKeys.includes(agent.key))
            .slice(0, Math.max(0, 25 - utilityOptions.length))
            .map(agent => ({
            label: `Schliesse ${agent.displayName} aus`,
            value: `exclude:${agent.key}`,
            description: `Versteckt ${agent.displayName} im aktuellen Builder`,
        })));
        if (utilityOptions.length > 0) {
            const utilityRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'utility'))
                .setPlaceholder('Builder-Tools')
                .setMinValues(1)
                .setMaxValues(1)
                .setOptions(utilityOptions.slice(0, 25)));
            rows.push(utilityRow);
        }
    }
    const controlsRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'back'))
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!snapshot.selectedMapKey && !snapshot.selectedRole && snapshot.selectedAgentKeys.length === 0), new ButtonBuilder()
        .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'reset'))
        .setLabel('Reset')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!snapshot.selectedMapKey && !snapshot.selectedRole && snapshot.selectedAgentKeys.length === 0 && snapshot.excludedAgentKeys.length === 0), new ButtonBuilder()
        .setCustomId(buildCompBuilderCustomId(snapshot.sessionId, 'save-preset-open'))
        .setLabel('Preset speichern')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!snapshot.selectedMapKey && snapshot.selectedAgentKeys.length === 0 && snapshot.excludedAgentKeys.length === 0));
    rows.push(controlsRow);
    return rows;
}
function addCommonValorantFilterOptions(command) {
    return command
        .addStringOption(option => option
        .setName('region')
        .setDescription('Optionaler Regionalfilter')
        .addChoices({ name: 'Americas', value: 'americas' }, { name: 'EMEA', value: 'emea' }, { name: 'Pacific', value: 'pacific' }, { name: 'China', value: 'china' }, { name: 'Masters', value: 'masters' }, { name: 'Champions', value: 'champions' }))
        .addStringOption(option => option
        .setName('event')
        .setDescription('Optional: Eventtitel oder Slug, z.B. EMEA Stage 1'))
        .addStringOption(option => option
        .setName('status')
        .setDescription('Optionaler Eventstatus')
        .addChoices({ name: 'Upcoming', value: 'upcoming' }, { name: 'Ongoing', value: 'ongoing' }, { name: 'Completed', value: 'completed' }))
        .addIntegerOption(option => option
        .setName('days')
        .setDescription('Optionales Zeitfenster')
        .addChoices({ name: '7 Tage', value: 7 }, { name: '14 Tage', value: 14 }, { name: '30 Tage', value: 30 }, { name: '90 Tage', value: 90 }))
        .addStringOption(option => option
        .setName('team')
        .setDescription('Optionaler Teamfilter'));
}
function readCommonValorantFilterOptions(interaction) {
    return {
        scope: parseScopeValue(interaction.options.getString('region') ?? undefined),
        eventQuery: interaction.options.getString('event') ?? undefined,
        eventStatus: parseStatusValue(interaction.options.getString('status') ?? undefined),
        days: interaction.options.getInteger('days') ?? undefined,
        teamQuery: interaction.options.getString('team') ?? undefined,
    };
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
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
        presence: {
            activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
            status: 'online',
        },
    });
    adminState = new DiscordAdminStateStore();
    nextSendAt = 0;
    readyPromise = null;
    commandsRegistered = false;
    activeAutomaticScanStatus = null;
    reminderTimer = null;
    messageWindows = new Map();
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
        this.client.on(Events.MessageCreate, message => {
            void this.handleMessageCreate(message).catch(error => {
                logger.error({ error, messageId: message.id }, 'Failed to handle Discord message');
            });
        });
        this.client.on(Events.GuildMemberAdd, member => {
            void this.handleGuildMemberAdd(member).catch(error => {
                logger.error({ error, guildId: member.guild.id, memberId: member.id }, 'Failed to handle guild member add');
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
                await this.adminState.load();
                await this.client.login(env.DISCORD_BOT_TOKEN);
                if (!this.client.isReady()) {
                    await ready;
                }
                this.client.user?.setPresence({
                    activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
                    status: 'online',
                });
                await this.registerCommands();
                this.startReminderLoop();
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
    async sendValorantSyncStatus(message) {
        await this.start();
        await this.waitForSendWindow();
        const channel = await this.fetchMessageChannel();
        await channel.send({
            embeds: [this.buildValorantSyncEmbed(message)],
            allowedMentions: { parse: [] },
        });
        this.nextSendAt = Date.now() + env.DISCORD_SEND_DELAY_MS;
    }
    async sendMarketDigest(message) {
        await this.start();
        await this.waitForSendWindow();
        const channel = await this.fetchMessageChannel();
        await channel.send({
            embeds: [this.buildMarketDigestEmbed(message)],
            allowedMentions: { parse: [] },
        });
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
    async markUnavailable(receipt, details) {
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
            const existingEmbed = message.embeds[0];
            const embed = existingEmbed
                ? EmbedBuilder.from(existingEmbed)
                : new EmbedBuilder();
            embed
                .setColor(0xFEE75C)
                .setFooter({ text: `${ALERT_FOOTER_TEXT} • Angebot nicht mehr verfügbar` })
                .addFields({
                name: 'Status',
                value: `Nicht mehr verfügbar (${details.reason})\nZuletzt geprüft: ${formatDiscordTimestamp(details.checkedAt)}`,
                inline: false,
            });
            await message.edit({
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
        }
        catch (error) {
            if (error instanceof DiscordAPIError && error.code === 10008) {
                return;
            }
            throw error;
        }
    }
    startReminderLoop() {
        if (this.reminderTimer) {
            clearInterval(this.reminderTimer);
        }
        this.reminderTimer = setInterval(() => {
            void this.flushDueReminders().catch(error => {
                logger.error({ error }, 'Failed to flush reminders');
            });
        }, 15_000);
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
    buildValorantSyncEmbed(message) {
        const embed = new EmbedBuilder()
            .setColor(message.healthState === 'healthy' ? 0x57F287 : 0xFEE75C)
            .setTitle(message.healthState === 'healthy' ? 'VALORANT Meta Update' : 'VALORANT Meta Update (degraded)')
            .setDescription([
            `Trigger: ${message.trigger}`,
            `Provider: ${message.provider.toUpperCase()}`,
            `Importierte Events: ${message.importedEvents}`,
            `Geparste Comps: ${message.parsedCompositions}`,
            `Aggregierte Full-Comps: ${message.aggregatedFullComps}`,
            `Letzter erfolgreicher Sync: ${message.lastSuccessfulSyncAt ? formatDiscordTimestamp(message.lastSuccessfulSyncAt) : 'unbekannt'}`,
        ].join('\n'))
            .setFooter({ text: VALORANT_SYNC_FOOTER_TEXT });
        if (message.metaChanges.length > 0) {
            embed.addFields({
                name: 'Meta-Änderungen',
                value: message.metaChanges.join('\n'),
            });
        }
        if (message.healthReasons.length > 0) {
            embed.addFields({
                name: 'Health-Hinweise',
                value: message.healthReasons.join('\n'),
            });
        }
        return embed;
    }
    buildMarketDigestEmbed(message) {
        const cadenceLabel = message.cadence === 'weekly' ? 'Wöchentliche' : 'Tägliche';
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${cadenceLabel} Markt-Zusammenfassung`)
            .setDescription([
            `Zeitraum: ${formatDiscordTimestamp(message.periodStart)} bis ${formatDiscordTimestamp(message.periodEnd)}`,
            `Akzeptierte Treffer: ${message.totalAcceptedListings}`,
            `Funktionsfähig: ${message.totalWorkingListings}`,
            `Defekt: ${message.totalDefectListings}`,
            `Snapshot JSON: \`${message.snapshotPath}\``,
        ].join('\n'))
            .setFooter({ text: MARKET_DIGEST_FOOTER_TEXT });
        if (message.topProfiles.length > 0) {
            embed.addFields({
                name: 'Top-Profile',
                value: message.topProfiles
                    .map((profile) => {
                    const avgPrice = profile.averageTotalPriceEur !== undefined
                        ? `${profile.averageTotalPriceEur.toFixed(2)} €`
                        : 'n/a';
                    return `${profile.profileName}: ${profile.acceptedCount} Treffer | Ø ${avgPrice} | Score ${profile.averageScore.toFixed(2)}`;
                })
                    .join('\n'),
            });
        }
        return embed;
    }
    isAdminUser(interaction) {
        return DISCORD_ADMIN_USER_IDS.has(interaction.user.id)
            || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
            || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    }
    async fetchLogChannel(guildId) {
        const config = this.adminState.getGuildConfig(guildId);
        if (!config.logChannelId) {
            return null;
        }
        const channel = await this.client.channels.fetch(config.logChannelId);
        if (!channel?.isTextBased() || !channel.isSendable()) {
            return null;
        }
        return channel;
    }
    buildModerationLogEmbed(input) {
        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle(input.title)
            .setDescription(input.description)
            .setFooter({ text: MODERATION_LOG_FOOTER_TEXT })
            .setTimestamp(new Date());
        if (input.fields && input.fields.length > 0) {
            embed.addFields(input.fields);
        }
        return embed;
    }
    async logModerationAction(guildId, embed) {
        const channel = await this.fetchLogChannel(guildId);
        if (!channel) {
            return;
        }
        await channel.send({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
    }
    async flushDueReminders() {
        const dueReminders = this.adminState.getDueReminders();
        for (const reminder of dueReminders) {
            try {
                const channel = await this.client.channels.fetch(reminder.channelId);
                if (!channel?.isTextBased() || !channel.isSendable()) {
                    continue;
                }
                await channel.send({
                    content: `<@${reminder.userId}> Erinnerung: ${reminder.message}`,
                    allowedMentions: { users: [reminder.userId] },
                });
                await this.adminState.markReminderSent(reminder.id);
            }
            catch (error) {
                logger.warn({ error, reminderId: reminder.id }, 'Failed to deliver reminder');
            }
        }
    }
    async createWarning(input) {
        const warning = await this.adminState.addWarning(input);
        const warnings = this.adminState.listWarnings(input.guildId, input.userId);
        await this.logModerationAction(input.guildId, this.buildModerationLogEmbed({
            title: 'Warnung erstellt',
            description: `<@${input.userId}> wurde verwarnt.`,
            fields: [
                { name: 'Grund', value: input.reason, inline: false },
                { name: 'Moderator', value: `<@${input.moderatorUserId}>`, inline: true },
                { name: 'Warnungen gesamt', value: String(warnings.length), inline: true },
            ],
        }));
        return warning;
    }
    async handleGuildMemberAdd(member) {
        const config = this.adminState.getGuildConfig(member.guild.id);
        if (!config.welcome.enabled || !config.welcome.channelId) {
            return;
        }
        const channel = await this.client.channels.fetch(config.welcome.channelId);
        if (!channel?.isTextBased() || !channel.isSendable()) {
            return;
        }
        const content = renderWelcomeTemplate(config.welcome.messageTemplate, {
            mention: `<@${member.id}>`,
            username: member.user.username,
            server: member.guild.name,
        });
        await channel.send({
            content,
            allowedMentions: { users: [member.id] },
        });
    }
    async handleMessageCreate(message) {
        if (message.author.bot) {
            return;
        }
        if (message.content.startsWith('!remind ')) {
            await this.handlePrefixReminder(message);
            return;
        }
        if (!message.guild) {
            return;
        }
        await this.applySpamModeration(message);
    }
    async handlePrefixReminder(message) {
        const [, rawDuration, ...rest] = message.content.trim().split(/\s+/);
        const reminderText = rest.join(' ').trim();
        const durationMs = parseReminderDuration(rawDuration ?? '');
        if (!durationMs || !reminderText) {
            await message.reply('Nutze `!remind 2h Ranked starten` oder einen ähnlichen Zeitwert mit `s`, `m`, `h`, `d`.');
            return;
        }
        if (message.guild) {
            const config = this.adminState.getGuildConfig(message.guild.id);
            if (!config.reminders.enabled) {
                await message.reply('Reminder sind auf diesem Server aktuell deaktiviert.');
                return;
            }
        }
        const dueAt = new Date(Date.now() + durationMs).toISOString();
        await this.adminState.addReminder({
            guildId: message.guild?.id,
            channelId: message.channel.id,
            userId: message.author.id,
            message: reminderText,
            dueAt,
        });
        await message.reply(`Erinnerung gesetzt für ${formatDiscordTimestamp(dueAt)}.`);
    }
    async applySpamModeration(message) {
        if (!message.guild || !message.member) {
            return;
        }
        const config = this.adminState.getGuildConfig(message.guild.id);
        if (!config.moderation.enabled) {
            return;
        }
        const key = `${message.guild.id}:${message.author.id}`;
        const windowMs = config.moderation.spamWindowSeconds * 1000;
        const cutoff = Date.now() - windowMs;
        const timestamps = (this.messageWindows.get(key) ?? []).filter(timestamp => timestamp >= cutoff);
        timestamps.push(Date.now());
        this.messageWindows.set(key, timestamps);
        if (timestamps.length < config.moderation.spamThreshold) {
            return;
        }
        this.messageWindows.set(key, []);
        const reason = `Auto-Mute wegen Spam (${timestamps.length} Nachrichten in ${config.moderation.spamWindowSeconds}s)`;
        await this.createWarning({
            guildId: message.guild.id,
            userId: message.author.id,
            moderatorUserId: this.client.user?.id ?? message.author.id,
            reason,
        });
        if (message.member.moderatable) {
            await message.member.timeout(config.moderation.muteMinutes * 60 * 1000, reason);
        }
        await this.logModerationAction(message.guild.id, this.buildModerationLogEmbed({
            title: 'Auto-Mute ausgelöst',
            description: `<@${message.author.id}> wurde automatisch moderiert.`,
            fields: [
                { name: 'Grund', value: reason, inline: false },
                { name: 'Mute-Dauer', value: `${config.moderation.muteMinutes} Minuten`, inline: true },
                { name: 'Warn-Schwelle', value: String(config.moderation.warnThreshold), inline: true },
            ],
        }));
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
                .setName(CONFIG_COMMAND)
                .setDescription('Verwaltet Discord-Bot-Features für diesen Server.')
                .addSubcommand(subcommand => subcommand
                .setName('show')
                .setDescription('Zeigt die aktuelle Server-Konfiguration an.'))
                .addSubcommand(subcommand => subcommand
                .setName('welcome')
                .setDescription('Konfiguriert die Willkommensnachricht.')
                .addBooleanOption(option => option.setName('enabled').setDescription('Welcome-Nachrichten aktivieren').setRequired(true))
                .addChannelOption(option => option.setName('channel').setDescription('Willkommens-Channel').setRequired(true))
                .addStringOption(option => option.setName('message').setDescription('Template mit {mention}, {user}, {server}').setRequired(true)))
                .addSubcommand(subcommand => subcommand
                .setName('moderation')
                .setDescription('Konfiguriert Auto-Mute bei Spam und Warn-Regeln.')
                .addBooleanOption(option => option.setName('enabled').setDescription('Moderation aktivieren').setRequired(true))
                .addIntegerOption(option => option.setName('spam_threshold').setDescription('Nachrichten bis Spam greift').setRequired(true))
                .addIntegerOption(option => option.setName('spam_window_seconds').setDescription('Zeitfenster in Sekunden').setRequired(true))
                .addIntegerOption(option => option.setName('mute_minutes').setDescription('Mute-Dauer in Minuten').setRequired(true))
                .addIntegerOption(option => option.setName('warn_threshold').setDescription('Warn-Schwelle fürs Frontend/Monitoring').setRequired(true))
                .addChannelOption(option => option.setName('log_channel').setDescription('Moderations-Log-Channel').setRequired(false)))
                .addSubcommand(subcommand => subcommand
                .setName('polls')
                .setDescription('Konfiguriert Umfragen.')
                .addBooleanOption(option => option.setName('enabled').setDescription('Polls aktivieren').setRequired(true))
                .addIntegerOption(option => option.setName('default_duration_minutes').setDescription('Standardlaufzeit in Minuten').setRequired(true)))
                .addSubcommand(subcommand => subcommand
                .setName('reminders')
                .setDescription('Konfiguriert Reminder.')
                .addBooleanOption(option => option.setName('enabled').setDescription('Reminder aktivieren').setRequired(true)))
                .toJSON(),
            new SlashCommandBuilder()
                .setName(POLL_COMMAND)
                .setDescription('Erstellt eine schnelle Umfrage mit Reaktionen.')
                .addStringOption(option => option.setName('question').setDescription('Frage').setRequired(true))
                .addStringOption(option => option.setName('option_1').setDescription('Option 1').setRequired(true))
                .addStringOption(option => option.setName('option_2').setDescription('Option 2').setRequired(true))
                .addStringOption(option => option.setName('option_3').setDescription('Option 3').setRequired(false))
                .addStringOption(option => option.setName('option_4').setDescription('Option 4').setRequired(false))
                .addStringOption(option => option.setName('option_5').setDescription('Option 5').setRequired(false))
                .addStringOption(option => option.setName('option_6').setDescription('Option 6').setRequired(false))
                .addIntegerOption(option => option.setName('duration_minutes').setDescription('Optionale Laufzeit').setRequired(false))
                .toJSON(),
            new SlashCommandBuilder()
                .setName(DELETE_COMMAND)
                .setDescription('Löscht eine Anzahl der letzten Nachrichten im aktuellen Channel.')
                .addIntegerOption(option => option
                .setName('amount')
                .setDescription('Anzahl der zu löschenden Nachrichten (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
                .toJSON(),
            new SlashCommandBuilder()
                .setName(WARN_COMMAND)
                .setDescription('Erstellt eine Warnung für einen Nutzer.')
                .addUserOption(option => option.setName('user').setDescription('Zielnutzer').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Warnungsgrund').setRequired(true))
                .toJSON(),
            new SlashCommandBuilder()
                .setName(WARNINGS_COMMAND)
                .setDescription('Zeigt die Warnungen eines Nutzers an.')
                .addUserOption(option => option.setName('user').setDescription('Zielnutzer').setRequired(true))
                .toJSON(),
            new SlashCommandBuilder()
                .setName(REMIND_COMMAND)
                .setDescription('Erstellt einen Reminder.')
                .addStringOption(option => option.setName('time').setDescription('Zeitformat wie 10m, 2h, 1d').setRequired(true))
                .addStringOption(option => option.setName('message').setDescription('Erinnerungstext').setRequired(true))
                .toJSON(),
            new SlashCommandBuilder()
                .setName(VCT_STATUS_COMMAND)
                .setDescription('Zeigt Snapshot-, Health- und Sync-Status des VALORANT-Moduls an.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(VCT_SYNC_COMMAND)
                .setDescription('Startet sofort einen manuellen VALORANT-VCT-Snapshot-Sync.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(VCT_SCAN_COMMAND)
                .setDescription('Alias für /vct-sync, falls du nach Scan statt Sync suchst.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName(VCT_HELP_COMMAND)
                .setDescription('Zeigt die wichtigsten VALORANT-Bot-Commands und Hinweise an.')
                .toJSON(),
            addCommonValorantFilterOptions(new SlashCommandBuilder()
                .setName(VCT_TOP_COMMAND)
                .setDescription('Zeigt die stärksten Full-Comps für eine Map.')
                .addStringOption(option => option
                .setName('map')
                .setDescription('Mapname, z.B. bind')
                .setRequired(true))).toJSON(),
            addCommonValorantFilterOptions(new SlashCommandBuilder()
                .setName(VCT_AGENT_COMMAND)
                .setDescription('Zeigt einen Agent-Report mit Maps, WR und Top-Comps.')
                .addStringOption(option => option
                .setName('agent')
                .setDescription('Agentname, z.B. jett')
                .setRequired(true))).toJSON(),
            addCommonValorantFilterOptions(new SlashCommandBuilder()
                .setName(VCT_MAP_META_COMMAND)
                .setDescription('Zeigt Map-Meta, Pickrates und Top-Comps für eine Map.')
                .addStringOption(option => option
                .setName('map')
                .setDescription('Mapname, z.B. ascent')
                .setRequired(true))).toJSON(),
            addCommonValorantFilterOptions(new SlashCommandBuilder()
                .setName(VCT_EVENTS_COMMAND)
                .setDescription('Listet die importierten VCT-Events im Snapshot auf.')).toJSON(),
            addCommonValorantFilterOptions(new SlashCommandBuilder()
                .setName(VCT_TEAM_COMMAND)
                .setDescription('Zeigt Team-spezifische Comps, Maps und Winrate.')
                .addStringOption(option => option
                .setName('team_name')
                .setDescription('Teamname, z.B. fnatic')
                .setRequired(true))).toJSON(),
            addCommonValorantFilterOptions(new SlashCommandBuilder()
                .setName(COMP_BUILDER_COMMAND)
                .setDescription('Startet den interaktiven VALORANT Comp Builder mit Filtern.'))
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
        if (interaction.isModalSubmit() && interaction.customId.startsWith(`${COMP_BUILDER_PRESET_MODAL_PREFIX}:`)) {
            await this.handleCompBuilderPresetModal(interaction);
            return;
        }
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
            interaction.commandName !== CONFIG_COMMAND &&
            interaction.commandName !== POLL_COMMAND &&
            interaction.commandName !== DELETE_COMMAND &&
            interaction.commandName !== WARN_COMMAND &&
            interaction.commandName !== WARNINGS_COMMAND &&
            interaction.commandName !== REMIND_COMMAND &&
            interaction.commandName !== VCT_STATUS_COMMAND &&
            interaction.commandName !== VCT_SYNC_COMMAND &&
            interaction.commandName !== VCT_SCAN_COMMAND &&
            interaction.commandName !== VCT_HELP_COMMAND &&
            interaction.commandName !== VCT_TOP_COMMAND &&
            interaction.commandName !== VCT_AGENT_COMMAND &&
            interaction.commandName !== VCT_MAP_META_COMMAND &&
            interaction.commandName !== VCT_EVENTS_COMMAND &&
            interaction.commandName !== VCT_TEAM_COMMAND &&
            interaction.commandName !== COMP_BUILDER_COMMAND) {
            return;
        }
        if ([CONFIG_COMMAND, POLL_COMMAND, DELETE_COMMAND, WARN_COMMAND].includes(interaction.commandName) && !this.isAdminUser(interaction)) {
            await interaction.reply({
                content: 'Du brauchst Administrator- oder Server-Verwalten-Rechte für diesen Command.',
                flags: MessageFlags.Ephemeral,
            });
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
            const builderFilterOptions = readCommonValorantFilterOptions(interaction);
            const snapshot = await this.options.onValorantCompBuilderStart(interaction.user.id, builderFilterOptions);
            await interaction.reply({
                embeds: [formatCompBuilderEmbed(snapshot)],
                components: buildCompBuilderComponents(snapshot),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === CONFIG_COMMAND) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const guildId = interaction.guildId;
            if (!guildId) {
                await interaction.editReply('Dieser Command funktioniert nur auf einem Server.');
                return;
            }
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'show') {
                const config = this.adminState.getGuildConfig(guildId);
                await interaction.editReply(formatGuildConfigSummary(config));
                return;
            }
            if (subcommand === 'welcome') {
                const config = await this.adminState.updateGuildConfig(guildId, current => ({
                    ...current,
                    welcome: {
                        enabled: interaction.options.getBoolean('enabled', true),
                        channelId: interaction.options.getChannel('channel', true).id,
                        messageTemplate: interaction.options.getString('message', true),
                    },
                }));
                await interaction.editReply(`Welcome-Konfiguration gespeichert.\n${formatGuildConfigSummary(config)}`);
                return;
            }
            if (subcommand === 'moderation') {
                const config = await this.adminState.updateGuildConfig(guildId, current => ({
                    ...current,
                    logChannelId: interaction.options.getChannel('log_channel')?.id ?? current.logChannelId,
                    moderation: {
                        enabled: interaction.options.getBoolean('enabled', true),
                        spamThreshold: interaction.options.getInteger('spam_threshold', true),
                        spamWindowSeconds: interaction.options.getInteger('spam_window_seconds', true),
                        muteMinutes: interaction.options.getInteger('mute_minutes', true),
                        warnThreshold: interaction.options.getInteger('warn_threshold', true),
                    },
                }));
                await interaction.editReply(`Moderations-Konfiguration gespeichert.\n${formatGuildConfigSummary(config)}`);
                return;
            }
            if (subcommand === 'polls') {
                const config = await this.adminState.updateGuildConfig(guildId, current => ({
                    ...current,
                    polls: {
                        enabled: interaction.options.getBoolean('enabled', true),
                        defaultDurationMinutes: interaction.options.getInteger('default_duration_minutes', true),
                    },
                }));
                await interaction.editReply(`Poll-Konfiguration gespeichert.\n${formatGuildConfigSummary(config)}`);
                return;
            }
            const config = await this.adminState.updateGuildConfig(guildId, current => ({
                ...current,
                reminders: {
                    enabled: interaction.options.getBoolean('enabled', true),
                },
            }));
            await interaction.editReply(`Reminder-Konfiguration gespeichert.\n${formatGuildConfigSummary(config)}`);
            return;
        }
        const isPublicValorantCommand = [
            VCT_STATUS_COMMAND,
            VCT_HELP_COMMAND,
            VCT_TOP_COMMAND,
            VCT_AGENT_COMMAND,
            VCT_MAP_META_COMMAND,
            VCT_EVENTS_COMMAND,
            VCT_TEAM_COMMAND,
            WARNINGS_COMMAND,
            REMIND_COMMAND,
        ].includes(interaction.commandName);
        if (!isPublicValorantCommand && !DISCORD_ADMIN_USER_IDS.has(interaction.user.id)) {
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
        if (interaction.commandName === VCT_SCAN_COMMAND && !this.options.onValorantSyncRequested) {
            await interaction.reply({
                content: 'VALORANT-Sync ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_HELP_COMMAND && !this.options.onValorantHelpRequested) {
            await interaction.reply({
                content: 'VALORANT-Hilfe ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_TOP_COMMAND && !this.options.onValorantTopRequested) {
            await interaction.reply({
                content: 'VALORANT-Top-Report ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_AGENT_COMMAND && !this.options.onValorantAgentRequested) {
            await interaction.reply({
                content: 'VALORANT-Agent-Report ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_MAP_META_COMMAND && !this.options.onValorantMapMetaRequested) {
            await interaction.reply({
                content: 'VALORANT-Map-Meta ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_EVENTS_COMMAND && !this.options.onValorantEventsRequested) {
            await interaction.reply({
                content: 'VALORANT-Events sind aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.commandName === VCT_TEAM_COMMAND && !this.options.onValorantTeamRequested) {
            await interaction.reply({
                content: 'VALORANT-Team-Report ist aktuell nicht verfügbar.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (interaction.commandName === POLL_COMMAND) {
                const guildId = interaction.guildId;
                if (!guildId || !interaction.channel || !interaction.channel.isTextBased() || !interaction.channel.isSendable()) {
                    await interaction.editReply('Polls funktionieren nur auf einem Server-Channel.');
                    return;
                }
                const config = this.adminState.getGuildConfig(guildId);
                if (!config.polls.enabled) {
                    await interaction.editReply('Polls sind auf diesem Server deaktiviert.');
                    return;
                }
                const options = [1, 2, 3, 4, 5, 6]
                    .map(index => interaction.options.getString(`option_${index}`))
                    .filter((value) => Boolean(value));
                const durationMinutes = interaction.options.getInteger('duration_minutes') ?? config.polls.defaultDurationMinutes;
                const closesAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('Umfrage')
                    .setDescription(interaction.options.getString('question', true))
                    .addFields(options.map((option, index) => ({
                    name: `${POLL_EMOJIS[index]} Option ${index + 1}`,
                    value: option,
                    inline: false,
                })))
                    .setFooter({ text: `Poll • offen bis ${new Date(closesAt).toLocaleString('de-DE')}` });
                const sent = await interaction.channel.send({
                    embeds: [embed],
                    allowedMentions: { parse: [] },
                });
                for (const emoji of POLL_EMOJIS.slice(0, options.length)) {
                    await sent.react(emoji);
                }
                await interaction.editReply(`Umfrage erstellt: ${sent.url}`);
                return;
            }
            if (interaction.commandName === DELETE_COMMAND) {
                const amount = interaction.options.getInteger('amount', true);
                if (!interaction.channel || !interaction.channel.isTextBased() || !('bulkDelete' in interaction.channel)) {
                    await interaction.editReply('Dieser Command funktioniert nur in Text-Channels.');
                    return;
                }
                const deletedMessages = await interaction.channel.bulkDelete(amount, true);
                await interaction.editReply(`${deletedMessages.size} Nachrichten wurden gelöscht.`);
                return;
            }
            if (interaction.commandName === WARN_COMMAND) {
                const guildId = interaction.guildId;
                if (!guildId) {
                    await interaction.editReply('Warnungen funktionieren nur auf einem Server.');
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason', true);
                const warning = await this.createWarning({
                    guildId,
                    userId: user.id,
                    moderatorUserId: interaction.user.id,
                    reason,
                });
                await interaction.editReply(`Warnung erstellt für ${user.tag}. ID: ${warning.id}`);
                return;
            }
            if (interaction.commandName === WARNINGS_COMMAND) {
                const guildId = interaction.guildId;
                if (!guildId) {
                    await interaction.editReply('Warnungen funktionieren nur auf einem Server.');
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const warnings = this.adminState.listWarnings(guildId, user.id);
                await interaction.editReply(warnings.length === 0
                    ? `${user.tag} hat keine Warnungen.`
                    : warnings.slice(-10).map((warning, index) => `${index + 1}. ${warning.createdAt}: ${warning.reason}`).join('\n'));
                return;
            }
            if (interaction.commandName === REMIND_COMMAND) {
                const durationMs = parseReminderDuration(interaction.options.getString('time', true));
                if (!durationMs) {
                    await interaction.editReply('Ungültiges Zeitformat. Nutze z. B. `10m`, `2h`, `1d`.');
                    return;
                }
                if (interaction.guildId) {
                    const config = this.adminState.getGuildConfig(interaction.guildId);
                    if (!config.reminders.enabled) {
                        await interaction.editReply('Reminder sind auf diesem Server deaktiviert.');
                        return;
                    }
                }
                const dueAt = new Date(Date.now() + durationMs).toISOString();
                await this.adminState.addReminder({
                    guildId: interaction.guildId ?? undefined,
                    channelId: interaction.channelId,
                    userId: interaction.user.id,
                    message: interaction.options.getString('message', true),
                    dueAt,
                });
                await interaction.editReply(`Reminder gesetzt für ${formatDiscordTimestamp(dueAt)}.`);
                return;
            }
            if (interaction.commandName === VCT_HELP_COMMAND) {
                const text = await this.options.onValorantHelpRequested?.();
                await interaction.editReply(text ?? 'VALORANT-Hilfe ist aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_STATUS_COMMAND) {
                const status = await this.options.onValorantStatusRequested?.();
                await interaction.editReply(status ? formatValorantStatusMessage(status) : 'VALORANT-Status ist aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_SYNC_COMMAND || interaction.commandName === VCT_SCAN_COMMAND) {
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
            if (interaction.commandName === VCT_TOP_COMMAND) {
                const text = await this.options.onValorantTopRequested?.({
                    mapQuery: interaction.options.getString('map', true),
                    ...readCommonValorantFilterOptions(interaction),
                });
                await interaction.editReply(text ?? 'VALORANT-Top-Report ist aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_AGENT_COMMAND) {
                const text = await this.options.onValorantAgentRequested?.({
                    agentQuery: interaction.options.getString('agent', true),
                    ...readCommonValorantFilterOptions(interaction),
                });
                await interaction.editReply(text ?? 'VALORANT-Agent-Report ist aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_MAP_META_COMMAND) {
                const text = await this.options.onValorantMapMetaRequested?.({
                    mapQuery: interaction.options.getString('map', true),
                    ...readCommonValorantFilterOptions(interaction),
                });
                await interaction.editReply(text ?? 'VALORANT-Map-Meta ist aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_EVENTS_COMMAND) {
                const text = await this.options.onValorantEventsRequested?.(readCommonValorantFilterOptions(interaction));
                await interaction.editReply(text ?? 'VALORANT-Events sind aktuell nicht verfügbar.');
                return;
            }
            if (interaction.commandName === VCT_TEAM_COMMAND) {
                const text = await this.options.onValorantTeamRequested?.({
                    teamQuery: interaction.options.getString('team_name', true),
                    scope: parseScopeValue(interaction.options.getString('region') ?? undefined),
                    eventQuery: interaction.options.getString('event') ?? undefined,
                    eventStatus: parseStatusValue(interaction.options.getString('status') ?? undefined),
                    days: interaction.options.getInteger('days') ?? undefined,
                });
                await interaction.editReply(text ?? 'VALORANT-Team-Report ist aktuell nicht verfügbar.');
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
            if (interaction.commandName === POLL_COMMAND) {
                await interaction.editReply('Umfrage konnte nicht erstellt werden.');
            }
            else if (interaction.commandName === DELETE_COMMAND) {
                await interaction.editReply('Nachrichten konnten nicht gelöscht werden. Discord löscht per Bulk-Delete nur neuere Nachrichten.');
            }
            else if (interaction.commandName === WARN_COMMAND) {
                await interaction.editReply('Warnung konnte nicht erstellt werden.');
            }
            else if (interaction.commandName === WARNINGS_COMMAND) {
                await interaction.editReply('Warnungen konnten nicht geladen werden.');
            }
            else if (interaction.commandName === REMIND_COMMAND) {
                await interaction.editReply('Reminder konnte nicht erstellt werden.');
            }
            else if (interaction.commandName === SCANNER_STATE_RESET_COMMAND) {
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
            else if (interaction.commandName === VCT_SYNC_COMMAND || interaction.commandName === VCT_SCAN_COMMAND) {
                const formattedError = formatInteractionErrorMessage(error);
                await interaction.editReply(formattedError
                    ? `VALORANT-Sync fehlgeschlagen.\n${formattedError}`
                    : 'VALORANT-Sync konnte nicht gestartet werden.');
            }
            else if (interaction.commandName === VCT_STATUS_COMMAND) {
                await interaction.editReply('VALORANT-Status konnte nicht geladen werden.');
            }
            else if (interaction.commandName === VCT_HELP_COMMAND
                || interaction.commandName === VCT_TOP_COMMAND
                || interaction.commandName === VCT_AGENT_COMMAND
                || interaction.commandName === VCT_MAP_META_COMMAND
                || interaction.commandName === VCT_EVENTS_COMMAND
                || interaction.commandName === VCT_TEAM_COMMAND) {
                await interaction.editReply('VALORANT-Report konnte nicht geladen werden.');
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
        if (parsed.action === 'save-preset-open' && interaction.isButton()) {
            const modal = new ModalBuilder()
                .setCustomId(buildPresetModalCustomId(parsed.sessionId))
                .setTitle('Comp Builder Preset speichern')
                .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('preset-name')
                .setLabel('Preset-Name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50)));
            await interaction.showModal(modal);
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
        else if (parsed.action === 'role-select' && interaction.isStringSelectMenu()) {
            const role = parseRoleValue(interaction.values[0]);
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
        else if (parsed.action === 'preset' && interaction.isStringSelectMenu()) {
            const presetId = interaction.values[0];
            if (presetId) {
                action = { type: 'load_preset', presetId };
            }
        }
        else if (parsed.action === 'agent' && interaction.isStringSelectMenu()) {
            const agentKey = interaction.values[0];
            if (agentKey) {
                action = { type: 'pick_agent', agentKey };
            }
        }
        else if (parsed.action === 'utility' && interaction.isStringSelectMenu()) {
            const [utilityAction, utilityValue] = (interaction.values[0] ?? '').split(':', 2);
            if (utilityAction === 'exclude' && utilityValue) {
                action = { type: 'exclude_agent', agentKey: utilityValue };
            }
            else if (utilityAction === 'include' && utilityValue) {
                action = { type: 'include_agent', agentKey: utilityValue };
            }
            else if (utilityAction === 'replace' && utilityValue) {
                action = { type: 'replace_agent', agentKey: utilityValue };
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
    async handleCompBuilderPresetModal(interaction) {
        const sessionId = parsePresetModalCustomId(interaction.customId);
        if (!sessionId || !this.options.onValorantCompBuilderAction) {
            await interaction.reply({
                content: 'Preset konnte nicht gespeichert werden.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const presetName = interaction.fields.getTextInputValue('preset-name').trim();
        const snapshot = await this.options.onValorantCompBuilderAction({
            userId: interaction.user.id,
            sessionId,
            action: { type: 'save_preset', name: presetName },
        });
        if (!snapshot) {
            await interaction.reply({
                content: 'Diese Comp-Builder-Sitzung ist abgelaufen oder gehört dir nicht. Starte `/compbuilder` neu.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.reply({
            content: `Preset \`${presetName}\` wurde gespeichert.`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
