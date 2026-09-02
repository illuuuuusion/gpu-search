import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AuditLog, redact } from './auditLog.js';

test('redaction removes secret-ish keys at any depth', () => {
  const redacted = redact({
    toolName: 'send_message',
    args: { content: 'hi', authorization: 'Bearer x', nested: { botToken: 'abc', apiKey: 'k' } },
  }) as Record<string, Record<string, unknown>>;

  assert.equal(redacted.args.content, 'hi');
  assert.equal(redacted.args.authorization, '[redacted]');
  assert.deepEqual(redacted.args.nested, { botToken: '[redacted]', apiKey: '[redacted]' });
});

test('audit entries are appended as JSON lines', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-audit-')), 'audit.log');
  const log = new AuditLog(file);
  await log.record({ event: 'tool_denied', toolName: 'ban_member', reason: 'destructive tools are disabled' });
  await log.record({ event: 'tool_executed', toolName: 'list_roles', args: { secret: 'nope' } });

  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'tool_denied');
  assert.equal(lines[1].args.secret, '[redacted]');
  assert.ok(Date.parse(lines[0].at) > 0);
});
