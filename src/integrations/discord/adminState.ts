import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

const DEFAULT_ADMIN_STATE_PATH = path.resolve(process.cwd(), 'data/discord-admin-state.json');

export interface DiscordGuildFeatureConfig {
  guildId: string;
  updatedAt: string;
  logChannelId?: string;
  welcome: {
    enabled: boolean;
    channelId?: string;
    messageTemplate: string;
  };
  moderation: {
    enabled: boolean;
    spamThreshold: number;
    spamWindowSeconds: number;
    muteMinutes: number;
    warnThreshold: number;
  };
  polls: {
    enabled: boolean;
    defaultDurationMinutes: number;
  };
  reminders: {
    enabled: boolean;
  };
}

export interface WarningRecord {
  id: string;
  guildId: string;
  userId: string;
  moderatorUserId: string;
  reason: string;
  createdAt: string;
}

export interface ReminderRecord {
  id: string;
  guildId?: string;
  channelId: string;
  userId: string;
  message: string;
  dueAt: string;
  createdAt: string;
  status: 'pending' | 'sent';
  sentAt?: string;
}

interface DiscordAdminStateFile {
  version: 1;
  updatedAt: string;
  guildConfigs: DiscordGuildFeatureConfig[];
  warnings: WarningRecord[];
  reminders: ReminderRecord[];
}

function getStatePath(): string {
  return env.DISCORD_ADMIN_STATE_PATH ?? DEFAULT_ADMIN_STATE_PATH;
}

function defaultGuildConfig(guildId: string): DiscordGuildFeatureConfig {
  return {
    guildId,
    updatedAt: new Date().toISOString(),
    logChannelId: undefined,
    welcome: {
      enabled: false,
      channelId: undefined,
      messageTemplate: 'Willkommen {mention} auf **{server}**!',
    },
    moderation: {
      enabled: false,
      spamThreshold: 5,
      spamWindowSeconds: 8,
      muteMinutes: 10,
      warnThreshold: 3,
    },
    polls: {
      enabled: true,
      defaultDurationMinutes: 60,
    },
    reminders: {
      enabled: true,
    },
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class DiscordAdminStateStore {
  private state: DiscordAdminStateFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    guildConfigs: [],
    warnings: [],
    reminders: [],
  };

  private loadPromise: Promise<void> | null = null;

  async load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadInternal();
    }

    await this.loadPromise;
  }

  getGuildConfig(guildId: string): DiscordGuildFeatureConfig {
    const existing = this.state.guildConfigs.find(config => config.guildId === guildId);
    if (existing) {
      return existing;
    }

    const created = defaultGuildConfig(guildId);
    this.state.guildConfigs.push(created);
    return created;
  }

  async updateGuildConfig(
    guildId: string,
    updater: (current: DiscordGuildFeatureConfig) => DiscordGuildFeatureConfig,
  ): Promise<DiscordGuildFeatureConfig> {
    await this.load();
    const current = this.getGuildConfig(guildId);
    const next = {
      ...updater(current),
      guildId,
      updatedAt: new Date().toISOString(),
    };

    this.state.guildConfigs = this.state.guildConfigs
      .filter(config => config.guildId !== guildId)
      .concat(next);
    await this.persist();
    return next;
  }

  async addWarning(input: {
    guildId: string;
    userId: string;
    moderatorUserId: string;
    reason: string;
  }): Promise<WarningRecord> {
    await this.load();
    const warning: WarningRecord = {
      id: createId('warn'),
      guildId: input.guildId,
      userId: input.userId,
      moderatorUserId: input.moderatorUserId,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };
    this.state.warnings.push(warning);
    await this.persist();
    return warning;
  }

  listWarnings(guildId: string, userId: string): WarningRecord[] {
    return this.state.warnings
      .filter(warning => warning.guildId === guildId && warning.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async addReminder(input: {
    guildId?: string;
    channelId: string;
    userId: string;
    message: string;
    dueAt: string;
  }): Promise<ReminderRecord> {
    await this.load();
    const reminder: ReminderRecord = {
      id: createId('remind'),
      guildId: input.guildId,
      channelId: input.channelId,
      userId: input.userId,
      message: input.message,
      dueAt: input.dueAt,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.state.reminders.push(reminder);
    await this.persist();
    return reminder;
  }

  getDueReminders(referenceTime = new Date().toISOString()): ReminderRecord[] {
    return this.state.reminders
      .filter(reminder => reminder.status === 'pending' && reminder.dueAt <= referenceTime)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async markReminderSent(reminderId: string, sentAt = new Date().toISOString()): Promise<void> {
    await this.load();
    this.state.reminders = this.state.reminders.map(reminder =>
      reminder.id === reminderId
        ? { ...reminder, status: 'sent', sentAt }
        : reminder);
    await this.persist();
  }

  private async loadInternal(): Promise<void> {
    try {
      const raw = await fs.readFile(getStatePath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<DiscordAdminStateFile>;
      this.state = {
        version: 1,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        guildConfigs: parsed.guildConfigs ?? [],
        warnings: parsed.warnings ?? [],
        reminders: parsed.reminders ?? [],
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async persist(): Promise<void> {
    this.state.updatedAt = new Date().toISOString();
    const statePath = getStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
  }
}
