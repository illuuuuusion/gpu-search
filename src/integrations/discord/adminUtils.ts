import type { DiscordGuildFeatureConfig } from './adminState.js';

export function parseReminderDuration(input: string): number | null {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * multipliers[unit];
}

export function renderWelcomeTemplate(template: string, input: {
  mention: string;
  username: string;
  server: string;
}): string {
  return template
    .replaceAll('{mention}', input.mention)
    .replaceAll('{user}', input.username)
    .replaceAll('{server}', input.server);
}

export function formatGuildConfigSummary(config: DiscordGuildFeatureConfig): string {
  return [
    `Log-Channel: ${config.logChannelId ?? 'nicht gesetzt'}`,
    `Welcome: ${config.welcome.enabled ? 'aktiv' : 'inaktiv'} | Channel: ${config.welcome.channelId ?? 'nicht gesetzt'} | Template: ${config.welcome.messageTemplate}`,
    `Moderation: ${config.moderation.enabled ? 'aktiv' : 'inaktiv'} | Spam: ${config.moderation.spamThreshold}/${config.moderation.spamWindowSeconds}s | Mute: ${config.moderation.muteMinutes}m | Warn-Schwelle: ${config.moderation.warnThreshold}`,
    `Polls: ${config.polls.enabled ? 'aktiv' : 'inaktiv'} | Default-Dauer: ${config.polls.defaultDurationMinutes}m`,
    `Reminders: ${config.reminders.enabled ? 'aktiv' : 'inaktiv'}`,
  ].join('\n');
}
