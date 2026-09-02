import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { DiscordRuntime } from '../runtime/discordRuntime.js';
import { AdminToolExecutor, type ToolHandlerInput } from './adminToolExecutor.js';
import { ApprovalService } from './approvalService.js';
import { AuditLog } from './auditLog.js';
import { RequestContextStore } from './requestContextStore.js';

const runtime = {} as DiscordRuntime;

async function build(options: { destructiveToolsEnabled?: boolean } = {}) {
  const auditFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-exec-')), 'audit.log');
  const contexts = new RequestContextStore(600);
  const approvals = new ApprovalService({ ttlSeconds: 300, ownerUserIds: new Set(['owner']) });
  const executor = new AdminToolExecutor({
    runtime,
    contexts,
    approvals,
    audit: new AuditLog(auditFile),
    guildId: 'guild-config',
    destructiveToolsEnabled: options.destructiveToolsEnabled ?? false,
  });
  const context = contexts.create({ userId: 'user-1', guildId: 'guild-config', channelId: 'chan-1', messageId: 'msg-1' });
  return { executor, approvals, context, auditFile };
}

test('read tools run without approval and get the configured guild id', async () => {
  const { executor, context } = await build();
  const seen: ToolHandlerInput[] = [];
  executor.register('list_roles', async input => {
    seen.push(input);
    return ['role-1'];
  });

  const result = await executor.execute({
    toolName: 'list_roles',
    args: { guildId: 'guild-config', actorUserId: 'attacker', limit: 5 },
    requestId: context.requestId,
  });

  assert.deepEqual(result, { status: 'ok', result: ['role-1'] });
  assert.equal(seen[0].guildId, 'guild-config');
  assert.deepEqual(seen[0].args, { limit: 5 }, 'identity arguments must be stripped');
  assert.equal(seen[0].context.userId, 'user-1');
});

test('a foreign guild id is rejected instead of silently ignored', async () => {
  const { executor, context } = await build();
  let called = false;
  executor.register('list_roles', async () => {
    called = true;
    return [];
  });

  for (const key of ['guildId', 'guild_id']) {
    const result = await executor.execute({
      toolName: 'list_roles',
      args: { [key]: 'attacker-guild' },
      requestId: context.requestId,
    });
    assert.deepEqual(result, { status: 'denied', reason: `guild id is fixed by configuration: ${key}` });
  }
  assert.equal(called, false);
});

test('arguments are validated against the tool schema before anything runs', async () => {
  const { executor, context } = await build();
  let called = false;
  executor.register('get_messages', async () => {
    called = true;
    return [];
  }, z.object({ channelId: z.string(), limit: z.number().int().max(50).optional() }).strict());

  const tooMany = await executor.execute({
    toolName: 'get_messages',
    args: { channelId: 'c1', limit: 5000 },
    requestId: context.requestId,
  });
  assert.equal(tooMany.status, 'denied');
  assert.match((tooMany as { reason: string }).reason, /invalid arguments -- limit/);

  const unknownArg = await executor.execute({
    toolName: 'get_messages',
    args: { channelId: 'c1', sneaky: true },
    requestId: context.requestId,
  });
  assert.equal(unknownArg.status, 'denied');
  assert.equal(called, false);
});

test('a failing handler is reported as an error, not as a success', async () => {
  const { executor, context, auditFile } = await build();
  executor.register('list_roles', async () => {
    throw new Error('discord is down');
  });

  const result = await executor.execute({ toolName: 'list_roles', requestId: context.requestId });
  assert.deepEqual(result, { status: 'error', message: 'discord is down' });

  const lines = (await fs.readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.at(-1).event, 'tool_failed');
});

test('unknown and unregistered tools are denied', async () => {
  const { executor, context } = await build();
  const unknown = await executor.execute({ toolName: 'rm_rf', requestId: context.requestId });
  assert.deepEqual(unknown, { status: 'denied', reason: 'unknown tool: rm_rf' });

  const unregistered = await executor.execute({ toolName: 'list_roles', requestId: context.requestId });
  assert.deepEqual(unregistered, { status: 'denied', reason: 'tool is not registered: list_roles' });
});

test('an unknown request id is denied before anything runs', async () => {
  const { executor } = await build();
  let called = false;
  executor.register('list_roles', async () => {
    called = true;
    return null;
  });

  const result = await executor.execute({ toolName: 'list_roles', requestId: 'made-up' });
  assert.deepEqual(result, { status: 'denied', reason: 'unknown or expired request context' });
  assert.equal(called, false);
});

test('write tools stay blocked until an owner approval is consumed', async () => {
  const { executor, approvals, context } = await build();
  let executions = 0;
  executor.register('create_role', async () => {
    executions += 1;
    return { id: 'role-9' };
  });

  const pending = await executor.execute({
    toolName: 'create_role',
    args: { name: 'Test' },
    requestId: context.requestId,
  });
  assert.equal(pending.status, 'approval_required');
  assert.equal(executions, 0);

  const approvalId = (pending as { approvalId: string }).approvalId;
  const denied = await executor.execute({
    toolName: 'create_role', args: { name: 'Test' }, requestId: context.requestId, approvalId,
  });
  assert.deepEqual(denied, { status: 'denied', reason: 'approval is pending' });

  approvals.approve(approvalId, 'owner');
  const tampered = await executor.execute({
    toolName: 'create_role', args: { name: 'Admin' }, requestId: context.requestId, approvalId,
  });
  assert.equal(tampered.status, 'denied');
  assert.equal(executions, 0);

  const ok = await executor.execute({
    toolName: 'create_role', args: { name: 'Test' }, requestId: context.requestId, approvalId,
  });
  assert.deepEqual(ok, { status: 'ok', result: { id: 'role-9' } });

  const replay = await executor.execute({
    toolName: 'create_role', args: { name: 'Test' }, requestId: context.requestId, approvalId,
  });
  assert.deepEqual(replay, { status: 'denied', reason: 'approval already used' });
  assert.equal(executions, 1);
});

test('destructive tools cannot even be registered without the feature flag', async () => {
  const { executor } = await build();
  assert.throws(() => executor.register('ban_member', async () => null), /AI_DESTRUCTIVE_TOOLS_ENABLED/);
  assert.throws(() => executor.register('not_a_tool', async () => null), /unclassified/);
  assert.deepEqual(executor.registeredTools, []);
});

test('denials and executions are written to the audit log', async () => {
  const { executor, context, auditFile } = await build();
  await executor.execute({ toolName: 'rm_rf', requestId: context.requestId });
  const lines = (await fs.readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines[0].event, 'tool_denied');
  assert.equal(lines[0].actorUserId, 'user-1');
  assert.equal(lines[0].guildId, 'guild-config');
});
