import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOL_RISK_CLASSES, classifyTool, evaluateTool } from './toolPolicy.js';

const RISK_CLASSES = new Set(['read', 'low-write', 'structural-write', 'moderation', 'destructive', 'external']);

test('every classified tool has exactly one known risk class', () => {
  const names = Object.keys(TOOL_RISK_CLASSES);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.ok(RISK_CLASSES.has(TOOL_RISK_CLASSES[name]), `${name} has an unknown risk class`);
  }
  assert.equal(new Set(names).size, names.length);
});

test('unknown tools are denied', () => {
  assert.equal(classifyTool('definitely_not_a_tool'), undefined);
  assert.deepEqual(
    evaluateTool('definitely_not_a_tool', { destructiveToolsEnabled: false }),
    { allow: false, reason: 'unknown tool: definitely_not_a_tool' },
  );
});

test('read tools are allowed without approval, writes require approval', () => {
  assert.deepEqual(evaluateTool('list_roles', { destructiveToolsEnabled: false }), {
    allow: true, risk: 'read', requiresApproval: false,
  });
  assert.deepEqual(evaluateTool('create_role', { destructiveToolsEnabled: false }), {
    allow: true, risk: 'structural-write', requiresApproval: true,
  });
  assert.deepEqual(evaluateTool('timeout_member', { destructiveToolsEnabled: false }), {
    allow: true, risk: 'moderation', requiresApproval: true,
  });
});

test('destructive tools stay denied without the feature flag and external tools always', () => {
  const denied = evaluateTool('ban_member', { destructiveToolsEnabled: false });
  assert.equal(denied.allow, false);
  const enabled = evaluateTool('ban_member', { destructiveToolsEnabled: true });
  assert.deepEqual(enabled, { allow: true, risk: 'destructive', requiresApproval: true });

  for (const flag of [false, true]) {
    assert.equal(evaluateTool('create_webhook', { destructiveToolsEnabled: flag }).allow, false);
    assert.equal(evaluateTool('send_direct_message', { destructiveToolsEnabled: flag }).allow, false);
  }
});
