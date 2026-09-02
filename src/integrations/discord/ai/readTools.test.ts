import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DiscordRuntime } from '../runtime/discordRuntime.js';
import { AdminToolExecutor, type ToolExecutionResult } from './adminToolExecutor.js';
import { ApprovalService } from './approvalService.js';
import { AuditLog } from './auditLog.js';
import { READ_LIMITS, registerReadTools } from './readTools.js';
import { RequestContextStore } from './requestContextStore.js';
import { classifyTool } from './toolPolicy.js';

const GUILD_ID = '100000000000000001';

// Minimaler Guild-Doppelgaenger. Er kennt ausschliesslich lesende Methoden --
// ruft ein Handler etwas Schreibendes auf, schlaegt der Test mit TypeError fehl.
function fakeGuild() {
  const role = (id: string, name: string, position: number) => ({
    id, name, position, hexColor: '#ffffff', hoist: false, mentionable: false,
    managed: name === 'Bot', members: new Map(),
    permissions: { toArray: () => ['ViewChannel', 'SendMessages'] },
  });
  const channel = (id: string, name: string, type: number, position: number, parentId: string | null) => ({
    id, name, type, position, parentId,
    permissionOverwrites: { cache: new Map([[ 'everyone', {
      id: 'everyone', type: 0,
      allow: { toArray: () => ['ViewChannel'] },
      deny: { toArray: () => ['SendMessages'] },
    } ]]) },
    isTextBased: () => type === 0,
    messages: {
      fetch: async ({ limit }: { limit: number }) => {
        const all = Array.from({ length: 200 }, (_, index) => ({
          id: `m${index}`,
          author: { id: '400000000000000001', username: 'jamie', bot: false },
          content: `nachricht ${index}`,
          createdAt: new Date(0),
          editedAt: null,
          pinned: false,
          attachments: new Map(),
          embeds: [],
        }));
        return new Map(all.slice(0, limit).map(message => [message.id, message]));
      },
    },
  });

  const channels = new Map<string, ReturnType<typeof channel>>([
    ['200000000000000001', channel('200000000000000001', 'GPU', 4, 0, null)],
    ['200000000000000002', channel('200000000000000002', 'deals', 0, 1, '200000000000000001')],
  ]);
  const roles = new Map([
    ['300000000000000001', role('300000000000000001', 'Admin', 5)],
    ['300000000000000002', role('300000000000000002', 'Bot', 3)],
  ]);

  return {
    id: GUILD_ID,
    name: 'GPU Search',
    ownerId: '400000000000000002',
    memberCount: 42,
    createdAt: new Date(0),
    verificationLevel: 1,
    premiumTier: 0,
    channels: {
      cache: channels,
      fetch: async (id?: string) => (id ? channels.get(id) ?? null : new Map(channels)),
    },
    roles: {
      cache: roles,
      fetch: async (id?: string) => (id ? roles.get(id) ?? null : new Map(roles)),
    },
    invites: {
      fetch: async () => new Map([['abc', {
        code: 'abcdefgh', channelId: '200000000000000002', inviterId: '400000000000000001', uses: 3,
        maxUses: 0, temporary: false, expiresAt: null,
      }]]),
    },
    fetchWebhooks: async () => new Map([['600000000000000001', {
      id: '600000000000000001', name: 'Deal Hook', channelId: '200000000000000002', createdAt: new Date(0),
      owner: { id: '400000000000000001' },
      // Wenn eine Projektion die durchreicht, faellt der Test unten darueber.
      token: 'super-secret-webhook-token',
      url: 'https://discord.com/api/webhooks/w1/super-secret-webhook-token',
    }]]),
  };
}

async function build() {
  const auditFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'read-tools-')), 'audit.log');
  const guild = fakeGuild();
  const runtime = { client: { guilds: { fetch: async () => guild } } } as unknown as DiscordRuntime;
  const contexts = new RequestContextStore(600);
  const executor = new AdminToolExecutor({
    runtime,
    contexts,
    approvals: new ApprovalService({ ttlSeconds: 300, ownerUserIds: new Set(['400000000000000002']) }),
    audit: new AuditLog(auditFile),
    guildId: GUILD_ID,
    destructiveToolsEnabled: false,
  });
  registerReadTools(executor);
  const context = contexts.create({ userId: '400000000000000003', guildId: GUILD_ID, channelId: '200000000000000002', messageId: '500000000000000001' });

  const call = (toolName: string, args?: Record<string, unknown>): Promise<ToolExecutionResult> =>
    executor.execute({ toolName, args, requestId: context.requestId });

  return { executor, call };
}

function expectOk(result: ToolExecutionResult): unknown {
  assert.equal(result.status, 'ok', `expected ok, got ${JSON.stringify(result)}`);
  return (result as { result: unknown }).result;
}

test('every tool registered in this milestone is classified read-only', async () => {
  const { executor } = await build();
  assert.ok(executor.registeredTools.length >= 14);
  for (const toolName of executor.registeredTools) {
    assert.equal(classifyTool(toolName), 'read', `${toolName} must be read-only in phase 2`);
  }
});

test('roles and channel structure come back complete and ordered', async () => {
  const { call } = await build();

  const roles = expectOk(await call('list_roles')) as { name: string; position: number }[];
  assert.deepEqual(roles.map(role => role.name), ['Admin', 'Bot'], 'highest role first');

  const channels = expectOk(await call('list_channels')) as { name: string; type: string; parentId: string | null }[];
  assert.deepEqual(channels.map(channel => channel.name), ['GPU', 'deals']);
  assert.equal(channels[0].type, 'GuildCategory');
  assert.equal(channels[1].parentId, '200000000000000001');
});

test('guild info and channel permissions are projected, not passed through', async () => {
  const { call } = await build();

  const guild = expectOk(await call('get_guild_info')) as Record<string, unknown>;
  assert.equal(guild.name, 'GPU Search');
  assert.equal(guild.memberCount, 42);

  const permissions = expectOk(await call('view_channel_permissions', { channelId: '200000000000000002' })) as {
    overwrites: { type: string; allow: string[]; deny: string[] }[];
  };
  assert.deepEqual(permissions.overwrites[0], { id: 'everyone', type: 'role', allow: ['ViewChannel'], deny: ['SendMessages'] });
});

test('webhook tokens and full invite codes never leave the process', async () => {
  const { call } = await build();

  const webhooks = expectOk(await call('list_webhooks')) as Record<string, unknown>[];
  assert.deepEqual(Object.keys(webhooks[0]).sort(), ['channelId', 'createdAt', 'id', 'name', 'ownerId']);
  assert.ok(!JSON.stringify(webhooks).includes('super-secret-webhook-token'));

  const invites = expectOk(await call('list_invites')) as { code: string }[];
  assert.equal(invites[0].code, 'abc***');
  assert.ok(!JSON.stringify(invites).includes('abcdefgh'));
});

test('message history is capped by the schema, not by the model', async () => {
  const { call } = await build();

  const capped = await call('get_messages', { channelId: '200000000000000002', limit: READ_LIMITS.messages + 1 });
  assert.equal(capped.status, 'denied');
  assert.match((capped as { reason: string }).reason, /invalid arguments -- limit/);

  const allowed = expectOk(await call('get_messages', { channelId: '200000000000000002', limit: READ_LIMITS.messages })) as unknown[];
  assert.equal(allowed.length, READ_LIMITS.messages);

  const defaulted = expectOk(await call('get_messages', { channelId: '200000000000000002' })) as unknown[];
  assert.equal(defaulted.length, 25, 'no limit means a safe default, not "everything"');
});

test('oversized list limits are rejected for every paged read tool', async () => {
  const { call } = await build();
  const cases: [string, Record<string, unknown>][] = [
    ['list_members', { limit: READ_LIMITS.members + 1 }],
    ['get_audit_log', { limit: READ_LIMITS.auditLog + 1 }],
    ['list_bans', { limit: READ_LIMITS.bans + 1 }],
  ];

  for (const [toolName, args] of cases) {
    const result = await call(toolName, args);
    assert.equal(result.status, 'denied', `${toolName} must reject an oversized limit`);
  }
});

test('unknown channels and roles surface as errors, not as empty successes', async () => {
  const { call } = await build();
  assert.deepEqual(await call('view_channel_permissions', { channelId: '999999999999999999' }), {
    status: 'error', message: 'channel not found in this guild or has no own permissions',
  });
  assert.deepEqual(await call('get_role_permissions', { roleId: '999999999999999999' }), {
    status: 'error', message: 'role not found in this guild',
  });
});

test('malformed ids are rejected before discord is contacted', async () => {
  const { call } = await build();
  const result = await call('get_member', { userId: 'not-a-snowflake' });
  assert.equal(result.status, 'denied');
  assert.match((result as { reason: string }).reason, /must be a discord id/);
});
