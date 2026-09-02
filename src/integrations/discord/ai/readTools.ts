import {
  AuditLogEvent,
  ChannelType,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildBasedChannel,
  type NonThreadGuildBasedChannel,
  type GuildMember,
  type Role,
} from 'discord.js';
import { z } from 'zod';
import type { AdminToolExecutor, ToolHandlerInput } from './adminToolExecutor.js';
import { redact } from './auditLog.js';

// Harte Obergrenzen. Sie stehen hier und nicht im Prompt, damit sie das Modell
// nicht verhandeln kann; die Schemas unten lehnen groessere Werte ab.
export const READ_LIMITS = {
  members: 100,
  messages: 50,
  auditLog: 50,
  bans: 100,
} as const;

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a discord id');
const noArgs = z.object({}).strict();

async function getGuild({ runtime, guildId }: ToolHandlerInput): Promise<Guild> {
  return runtime.client.guilds.fetch(guildId);
}

// --- Projektionen: nur was ein Admin-Agent braucht. Keine Tokens, keine
// Avatar-/Banner-URLs, keine Nutzerdaten ueber das Noetige hinaus. ---

function projectChannel(channel: GuildBasedChannel | NonThreadGuildBasedChannel) {
  return {
    id: channel.id,
    name: channel.name,
    type: ChannelType[channel.type],
    parentId: channel.parentId,
    position: 'position' in channel ? channel.position : null,
    nsfw: 'nsfw' in channel ? channel.nsfw : undefined,
    topic: 'topic' in channel ? channel.topic : undefined,
    slowmodeSeconds: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : undefined,
  };
}

function projectRole(role: Role) {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    color: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    memberCount: role.members.size,
  };
}

function projectMember(member: GuildMember) {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    bot: member.user.bot,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    roleIds: [...member.roles.cache.keys()],
    communicationDisabledUntil: member.communicationDisabledUntil?.toISOString() ?? null,
  };
}

function projectAuditEntry(entry: GuildAuditLogsEntry) {
  return {
    id: entry.id,
    action: AuditLogEvent[entry.action] ?? String(entry.action),
    executorId: entry.executorId,
    targetId: entry.targetId,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
    // Changes koennen fremde Inhalte tragen -> durch dieselbe Redaction wie der Audit-Trail.
    changes: redact(entry.changes.map(change => ({ key: change.key, old: change.old, new: change.new }))),
  };
}

// Registriert ausschliesslich lesende Werkzeuge. Kein Handler hier ruft eine
// schreibende Discord-Methode auf -- Writes kommen erst in Phase 3.
export function registerReadTools(executor: AdminToolExecutor): void {
  executor.register('get_guild_info', async input => {
    const guild = await getGuild(input);
    return {
      id: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount,
      createdAt: guild.createdAt.toISOString(),
      verificationLevel: guild.verificationLevel,
      premiumTier: guild.premiumTier,
      channelCount: guild.channels.cache.size,
      roleCount: guild.roles.cache.size,
    };
  }, noArgs);

  executor.register('list_channels', async input => {
    const guild = await getGuild(input);
    const channels = await guild.channels.fetch();
    return [...channels.values()]
      .filter((channel): channel is NonThreadGuildBasedChannel => channel !== null)
      .sort((a, b) => a.position - b.position)
      .map(projectChannel);
  }, noArgs);

  executor.register('view_channel_permissions', async input => {
    const guild = await getGuild(input);
    const channel = await guild.channels.fetch(String(input.args.channelId));
    if (!channel || !('permissionOverwrites' in channel)) {
      throw new Error('channel not found in this guild or has no own permissions');
    }
    return {
      channelId: channel.id,
      name: channel.name,
      overwrites: [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
        id: overwrite.id,
        type: overwrite.type === 0 ? 'role' : 'member',
        allow: overwrite.allow.toArray(),
        deny: overwrite.deny.toArray(),
      })),
    };
  }, z.object({ channelId: snowflake }).strict());

  executor.register('list_roles', async input => {
    const guild = await getGuild(input);
    const roles = await guild.roles.fetch();
    return [...roles.values()].sort((a, b) => b.position - a.position).map(projectRole);
  }, noArgs);

  executor.register('get_role_permissions', async input => {
    const guild = await getGuild(input);
    const role = await guild.roles.fetch(String(input.args.roleId));
    if (!role) {
      throw new Error('role not found in this guild');
    }
    return { ...projectRole(role), permissions: role.permissions.toArray() };
  }, z.object({ roleId: snowflake }).strict());

  executor.register('list_members', async input => {
    const guild = await getGuild(input);
    const members = await guild.members.list({
      limit: Number(input.args.limit ?? 50),
      ...(input.args.after ? { after: String(input.args.after) } : {}),
    });
    return [...members.values()].map(projectMember);
  }, z.object({
    limit: z.number().int().min(1).max(READ_LIMITS.members).optional(),
    after: snowflake.optional(),
  }).strict());

  executor.register('get_member', async input => {
    const guild = await getGuild(input);
    return projectMember(await guild.members.fetch(String(input.args.userId)));
  }, z.object({ userId: snowflake }).strict());

  executor.register('get_member_permissions', async input => {
    const guild = await getGuild(input);
    const member = await guild.members.fetch(String(input.args.userId));
    const channelId = input.args.channelId ? String(input.args.channelId) : undefined;
    const channel = channelId ? await guild.channels.fetch(channelId) : null;
    if (channelId && !channel) {
      throw new Error('channel not found in this guild');
    }
    return {
      userId: member.id,
      guildPermissions: member.permissions.toArray(),
      channelId: channel?.id ?? null,
      channelPermissions: channel ? (channel.permissionsFor(member)?.toArray() ?? []) : null,
    };
  }, z.object({ userId: snowflake, channelId: snowflake.optional() }).strict());

  executor.register('get_audit_log', async input => {
    const guild = await getGuild(input);
    const logs = await guild.fetchAuditLogs({ limit: Number(input.args.limit ?? 25) });
    return [...logs.entries.values()].map(projectAuditEntry);
  }, z.object({ limit: z.number().int().min(1).max(READ_LIMITS.auditLog).optional() }).strict());

  executor.register('list_bans', async input => {
    const guild = await getGuild(input);
    const bans = await guild.bans.fetch({ limit: Number(input.args.limit ?? 50) });
    return [...bans.values()].map(ban => ({
      userId: ban.user.id,
      username: ban.user.username,
      reason: ban.reason,
    }));
  }, z.object({ limit: z.number().int().min(1).max(READ_LIMITS.bans).optional() }).strict());

  executor.register('list_invites', async input => {
    const guild = await getGuild(input);
    const invites = await guild.invites.fetch();
    // Der Invite-Code selbst ist ein Zugangsmittel -> nur gekuerzt ausgeben.
    return [...invites.values()].map(invite => ({
      code: `${invite.code.slice(0, 3)}***`,
      channelId: invite.channelId,
      inviterId: invite.inviterId,
      uses: invite.uses,
      maxUses: invite.maxUses,
      temporary: invite.temporary,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    }));
  }, noArgs);

  executor.register('list_webhooks', async input => {
    const guild = await getGuild(input);
    const webhooks = await guild.fetchWebhooks();
    // Niemals `token` oder `url` herausgeben -- damit koennte jeder in den Channel posten.
    return [...webhooks.values()].map(webhook => ({
      id: webhook.id,
      name: webhook.name,
      channelId: webhook.channelId,
      ownerId: webhook.owner?.id ?? null,
      createdAt: webhook.createdAt.toISOString(),
    }));
  }, noArgs);

  executor.register('list_automod_rules', async input => {
    const guild = await getGuild(input);
    const rules = await guild.autoModerationRules.fetch();
    return [...rules.values()].map(rule => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      eventType: rule.eventType,
      triggerType: rule.triggerType,
      actionTypes: rule.actions.map(action => action.type),
      exemptRoleIds: [...rule.exemptRoles.keys()],
      exemptChannelIds: [...rule.exemptChannels.keys()],
    }));
  }, noArgs);

  executor.register('get_messages', async input => {
    const guild = await getGuild(input);
    const channel = await guild.channels.fetch(String(input.args.channelId));
    if (!channel?.isTextBased()) {
      throw new Error('channel is not a readable text channel in this guild');
    }
    const messages = await channel.messages.fetch({ limit: Number(input.args.limit ?? 25) });
    return [...messages.values()].map(message => ({
      id: message.id,
      authorId: message.author.id,
      authorUsername: message.author.username,
      authorIsBot: message.author.bot,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      pinned: message.pinned,
      attachmentCount: message.attachments.size,
      embedCount: message.embeds.length,
    }));
  }, z.object({
    channelId: snowflake,
    limit: z.number().int().min(1).max(READ_LIMITS.messages).optional(),
  }).strict());
}
