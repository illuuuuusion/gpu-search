import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalService, hashToolCall, normalizeArguments } from './approvalService.js';
import { RequestContextStore } from './requestContextStore.js';

function context(userId = 'requester') {
  return new RequestContextStore(600).create({
    userId, guildId: 'guild-1', channelId: 'chan-1', messageId: 'msg-1',
  });
}

test('argument normalization is key-order independent', () => {
  assert.equal(normalizeArguments({ b: 1, a: 2 }), normalizeArguments({ a: 2, b: 1 }));
  assert.notEqual(hashToolCall('t', { a: 1 }), hashToolCall('t', { a: 2 }));
  assert.notEqual(hashToolCall('t1', { a: 1 }), hashToolCall('t2', { a: 1 }));
});

test('approval is single use and bound to the exact arguments', () => {
  const service = new ApprovalService({ ttlSeconds: 300, ownerUserIds: new Set(['owner']) });
  const approval = service.request({ toolName: 'create_role', args: { name: 'Test' }, context: context() });

  assert.equal(service.consume(approval.approvalId, 'create_role', { name: 'Test' }).ok, false, 'pending must not be consumable');
  assert.equal(service.approve(approval.approvalId, 'owner').ok, true);

  const tampered = service.consume(approval.approvalId, 'create_role', { name: 'Admin' });
  assert.deepEqual(tampered, { ok: false, reason: 'approval does not match tool arguments' });

  assert.equal(service.consume(approval.approvalId, 'create_role', { name: 'Test' }).ok, true);
  assert.deepEqual(
    service.consume(approval.approvalId, 'create_role', { name: 'Test' }),
    { ok: false, reason: 'approval already used' },
  );
});

test('only owners may approve, and approvals expire', () => {
  let now = 1_000;
  const service = new ApprovalService({ ttlSeconds: 300, ownerUserIds: new Set(['owner']) }, () => now);
  const approval = service.request({ toolName: 'send_message', args: {}, context: context('requester') });

  assert.deepEqual(service.approve(approval.approvalId, 'requester'), { ok: false, reason: 'approver is not an owner' });

  now += 300_001;
  assert.deepEqual(service.approve(approval.approvalId, 'owner'), { ok: false, reason: 'approval expired' });
});

test('denied approvals cannot be used', () => {
  const service = new ApprovalService({ ttlSeconds: 300, ownerUserIds: new Set(['owner']) });
  const approval = service.request({ toolName: 'send_message', args: {}, context: context() });
  assert.equal(service.deny(approval.approvalId, 'owner').ok, true);
  assert.deepEqual(service.consume(approval.approvalId, 'send_message', {}), { ok: false, reason: 'approval denied' });
});

test('unknown approval ids are rejected', () => {
  const service = new ApprovalService({ ttlSeconds: 300, ownerUserIds: new Set(['owner']) });
  assert.deepEqual(service.consume('nope', 'send_message', {}), { ok: false, reason: 'unknown approval' });
});
