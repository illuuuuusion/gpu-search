import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
const DEFAULT_ADMIN_STATE_PATH = path.resolve(process.cwd(), 'data/discord-admin-state.json');
function getStatePath() {
    return env.DISCORD_ADMIN_STATE_PATH ?? DEFAULT_ADMIN_STATE_PATH;
}
function defaultGuildConfig(guildId) {
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
function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
export class DiscordAdminStateStore {
    state = {
        version: 1,
        updatedAt: new Date().toISOString(),
        guildConfigs: [],
        warnings: [],
        reminders: [],
    };
    loadPromise = null;
    async load() {
        if (!this.loadPromise) {
            this.loadPromise = this.loadInternal();
        }
        await this.loadPromise;
    }
    getGuildConfig(guildId) {
        const existing = this.state.guildConfigs.find(config => config.guildId === guildId);
        if (existing) {
            return existing;
        }
        const created = defaultGuildConfig(guildId);
        this.state.guildConfigs.push(created);
        return created;
    }
    async updateGuildConfig(guildId, updater) {
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
    async addWarning(input) {
        await this.load();
        const warning = {
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
    listWarnings(guildId, userId) {
        return this.state.warnings
            .filter(warning => warning.guildId === guildId && warning.userId === userId)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    async addReminder(input) {
        await this.load();
        const reminder = {
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
    getDueReminders(referenceTime = new Date().toISOString()) {
        return this.state.reminders
            .filter(reminder => reminder.status === 'pending' && reminder.dueAt <= referenceTime)
            .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    }
    async markReminderSent(reminderId, sentAt = new Date().toISOString()) {
        await this.load();
        this.state.reminders = this.state.reminders.map(reminder => reminder.id === reminderId
            ? { ...reminder, status: 'sent', sentAt }
            : reminder);
        await this.persist();
    }
    async loadInternal() {
        try {
            const raw = await fs.readFile(getStatePath(), 'utf8');
            const parsed = JSON.parse(raw);
            this.state = {
                version: 1,
                updatedAt: parsed.updatedAt ?? new Date().toISOString(),
                guildConfigs: parsed.guildConfigs ?? [],
                warnings: parsed.warnings ?? [],
                reminders: parsed.reminders ?? [],
            };
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT') {
                throw error;
            }
        }
    }
    async persist() {
        this.state.updatedAt = new Date().toISOString();
        const statePath = getStatePath();
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
    }
}
