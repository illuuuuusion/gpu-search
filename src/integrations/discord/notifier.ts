import { once } from 'node:events';
import {
  ActivityType,
  Client,
  DiscordAPIError,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type Interaction,
  type Message,
} from 'discord.js';
import { env } from '../../config/env.js';
import type { AlertMessage, Notifier, NotificationReceipt, ScanStatusMessage, ScanStatusSummary } from '../notifier.js';
import { logger } from '../../utils/logger.js';

const DISCORD_ACTIVITY_NAME = 'eBay GPU-Deals';
const SCANNER_STATE_RESET_COMMAND = 'scanner-state-reset';
const SCAN_NOW_COMMAND = 'scan-now';
const FORCE_RESCAN_COMMAND = 'force-rescan';
const DEBUG_SCAN_COMMAND = 'debug-scan';
const SCAN_INFO_COMMAND = 'scan-info';
const ALERT_FOOTER_TEXT = 'GPU-Search';
const AUTOMATIC_SCAN_STATUS_FOOTER_TEXT = 'GPU-Search • Auto-Scan-Status';
const DISCORD_ADMIN_USER_IDS = new Set([
  '504707482547912714',
  '689513442867937321',
]);

interface ScanCommandResult {
  status: 'completed' | 'queued_after_running_scan';
  nextAutomaticScanAt: string;
  summary: ScanStatusSummary;
}

interface DiscordNotifierOptions {
  onScannerStateReset?: () => Promise<{ seenCount: number; observationCount: number }>;
  onManualScanRequested?: () => Promise<ScanCommandResult>;
  onForceRescanRequested?: () => Promise<ScanCommandResult>;
  onDebugScanRequested?: () => Promise<ScanCommandResult>;
  onScanInfoRequested?: () => Promise<{ nextAutomaticScanAt?: string; scanRunning: boolean }>;
}

function toDiscordColor(color: AlertMessage['color']): number {
  return color === 'danger' ? 0xED4245 : 0x57F287;
}

function formatDiscordTimestamp(isoTimestamp: string): string {
  const unixTimestamp = Math.floor(new Date(isoTimestamp).getTime() / 1000);
  return `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)`;
}

function formatScanStats(summary: {
  uniqueListings: number;
  acceptedListings: number;
  seenSkipped: number;
  alertsPosted: number;
  notificationFailures: number;
}): string {
  return [
    `Alerts gepostet: ${summary.alertsPosted}`,
    `Akzeptierte Treffer: ${summary.acceptedListings}`,
    `Unique Listings: ${summary.uniqueListings}`,
    `Wegen Seen übersprungen: ${summary.seenSkipped}`,
    `Sende-Fehler: ${summary.notificationFailures}`,
  ].join(' | ');
}

function formatScanStatusTitle(message: ScanStatusMessage): string {
  if (message.phase === 'started') {
    return 'Automatischer Scan startet';
  }

  if ((message.summary?.alertsPosted ?? 0) > 0) {
    return `Automatischer Scan abgeschlossen: ${message.summary?.alertsPosted ?? 0} neue Alerts`;
  }

  return 'Automatischer Scan abgeschlossen: keine neuen Alerts';
}

function formatScanStatusDescription(message: ScanStatusMessage): string {
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

function isUnknownInteractionError(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 10062;
}

function isAlreadyAcknowledgedInteractionError(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 40060;
}

export class DiscordNotifier implements Notifier {
  private readonly client = new Client({
    intents: [GatewayIntentBits.Guilds],
    presence: {
      activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
      status: 'online',
    },
  });

  private nextSendAt = 0;
  private readyPromise: Promise<void> | null = null;
  private commandsRegistered = false;
  private activeAutomaticScanStatus: NotificationReceipt | null = null;

  constructor(private readonly options: DiscordNotifierOptions = {}) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
      throw new Error('Missing Discord configuration');
    }

    this.client.on(Events.InteractionCreate, interaction => {
      void this.handleInteraction(interaction).catch(error => {
        if (isUnknownInteractionError(error)) {
          logger.warn({
            commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
            interactionId: interaction.id,
          }, 'Discord interaction expired before it could be acknowledged');
          return;
        }

        if (isAlreadyAcknowledgedInteractionError(error)) {
          logger.warn({
            commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
            interactionId: interaction.id,
          }, 'Discord interaction had already been acknowledged');
          return;
        }

        logger.error({
          error,
          commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
          interactionId: interaction.id,
        }, 'Failed to handle Discord interaction');
      });
    });
  }

  async start(): Promise<void> {
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

  private async waitForSendWindow(): Promise<void> {
    const waitMs = this.nextSendAt - Date.now();
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  async send(message: AlertMessage): Promise<NotificationReceipt> {
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

  async sendScanStatus(message: ScanStatusMessage): Promise<void> {
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
      } else {
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
    } else {
      await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    }

    this.nextSendAt = Date.now() + env.DISCORD_SEND_DELAY_MS;
  }

  async delete(receipt: NotificationReceipt): Promise<void> {
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
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10008) {
        return;
      }

      throw error;
    }
  }

  private buildAlertEmbed(message: AlertMessage): EmbedBuilder {
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

  private buildScanStatusEmbed(message: ScanStatusMessage): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(message.phase === 'started' ? 0x5865F2 : ((message.summary?.alertsPosted ?? 0) > 0 ? 0x57F287 : 0xFEE75C))
      .setTitle(formatScanStatusTitle(message))
      .setDescription(formatScanStatusDescription(message))
      .setFooter({ text: message.trigger === 'automatic' ? AUTOMATIC_SCAN_STATUS_FOOTER_TEXT : ALERT_FOOTER_TEXT });

    if (message.summary) {
      embed.addFields(
        { name: 'Alerts gepostet', value: String(message.summary.alertsPosted), inline: true },
        { name: 'Akzeptierte Treffer', value: String(message.summary.acceptedListings), inline: true },
        { name: 'Unique Listings', value: String(message.summary.uniqueListings), inline: true },
        { name: 'Wegen Seen übersprungen', value: String(message.summary.seenSkipped), inline: true },
        { name: 'Sende-Fehler', value: String(message.summary.notificationFailures), inline: true },
      );
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

  private async fetchMessageChannel() {
    const channel = await this.client.channels.fetch(env.DISCORD_CHANNEL_ID);
    if (!channel?.isTextBased() || !channel.isSendable() || !('messages' in channel)) {
      throw new Error('Configured Discord channel is not a sendable text channel');
    }

    return channel;
  }

  private async fetchLatestMessage(channel: Awaited<ReturnType<DiscordNotifier['fetchMessageChannel']>>): Promise<Message | null> {
    const messages = await channel.messages.fetch({ limit: 1 });
    return messages.first() ?? null;
  }

  private isAutomaticScanStatusMessage(message: Message): boolean {
    return message.author.id === this.client.user?.id
      && message.embeds.some(embed => embed.footer?.text === AUTOMATIC_SCAN_STATUS_FOOTER_TEXT);
  }

  private async updateActiveAutomaticScanStatus(
    channel: Awaited<ReturnType<DiscordNotifier['fetchMessageChannel']>>,
    embed: EmbedBuilder,
  ): Promise<boolean> {
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
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10008) {
        this.activeAutomaticScanStatus = null;
        return false;
      }

      throw error;
    }
  }

  private async registerCommands(): Promise<void> {
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
    ];

    if (guildId) {
      await this.client.application.commands.set(commands, guildId);
    } else {
      await this.client.application.commands.set(commands);
    }

    this.commandsRegistered = true;
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (
      interaction.commandName !== SCANNER_STATE_RESET_COMMAND &&
      interaction.commandName !== SCAN_NOW_COMMAND &&
      interaction.commandName !== FORCE_RESCAN_COMMAND &&
      interaction.commandName !== DEBUG_SCAN_COMMAND &&
      interaction.commandName !== SCAN_INFO_COMMAND
    ) {
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
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
        await interaction.editReply(
          interaction.commandName === FORCE_RESCAN_COMMAND
            ? 'Force-Rescan ist aktuell nicht verfügbar.'
            : interaction.commandName === DEBUG_SCAN_COMMAND
              ? 'Debug-Scan ist aktuell nicht verfügbar.'
              : 'Manueller Scan ist aktuell nicht verfügbar.',
        );
        return;
      }

      if (result.status === 'queued_after_running_scan') {
        await interaction.editReply(
          interaction.commandName === FORCE_RESCAN_COMMAND
            ? `Es läuft bereits ein Scan. Der Force-Rescan wurde danach ausgeführt. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
            : interaction.commandName === DEBUG_SCAN_COMMAND
              ? `Es läuft bereits ein Scan. Der Debug-Scan wurde danach ausgeführt. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
              : `Es läuft bereits ein Scan. Der manuelle Scan wurde danach ausgeführt. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`,
        );
        return;
      }

      await interaction.editReply(
        interaction.commandName === FORCE_RESCAN_COMMAND
          ? `Force-Rescan abgeschlossen. Bereits gepostete Listings wurden für dieses Fenster ignoriert. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
          : interaction.commandName === DEBUG_SCAN_COMMAND
            ? `Debug-Scan abgeschlossen. Nur die Preislogik wurde stark gelockert, Wort-/Zubehörfilter blieben aktiv. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`
            : `Manueller Scan abgeschlossen. ${formatScanStats(result.summary)}. Nächster automatischer Scan: ${formatDiscordTimestamp(result.nextAutomaticScanAt)}.`,
      );
    } catch (error) {
      if (interaction.commandName === SCANNER_STATE_RESET_COMMAND) {
        await interaction.editReply('Scanner-State konnte nicht zurückgesetzt werden.');
      } else if (interaction.commandName === FORCE_RESCAN_COMMAND) {
        await interaction.editReply('Force-Rescan konnte nicht gestartet werden.');
      } else if (interaction.commandName === DEBUG_SCAN_COMMAND) {
        await interaction.editReply('Debug-Scan konnte nicht gestartet werden.');
      } else if (interaction.commandName === SCAN_INFO_COMMAND) {
        await interaction.editReply('Scan-Info konnte nicht geladen werden.');
      } else {
        await interaction.editReply('Manueller Scan konnte nicht gestartet werden.');
      }
      throw error;
    }
  }
}
