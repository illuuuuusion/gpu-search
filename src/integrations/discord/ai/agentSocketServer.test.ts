import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AgentSocketServer, type AgentSocketHandlers } from './agentSocketServer.js';

async function socketPath(): Promise<string> {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-sock-')), 'channel.sock');
}

function connect(file: string): Promise<{ socket: net.Socket; next: () => Promise<Record<string, unknown>> }> {
  return new Promise(resolve => {
    const socket = net.createConnection(file, () => {
      let buffer = '';
      const queue: Record<string, unknown>[] = [];
      const waiting: ((frame: Record<string, unknown>) => void)[] = [];
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const frame = JSON.parse(buffer.slice(0, index)) as Record<string, unknown>;
          buffer = buffer.slice(index + 1);
          const resolveNext = waiting.shift();
          if (resolveNext) resolveNext(frame);
          else queue.push(frame);
          index = buffer.indexOf('\n');
        }
      });
      const next = () => new Promise<Record<string, unknown>>(res => {
        const queued = queue.shift();
        if (queued) res(queued);
        else waiting.push(res);
      });
      resolve({ socket, next });
    });
  });
}

function handlers(calls: string[]): AgentSocketHandlers {
  return {
    reply: async input => {
      calls.push(`reply:${input.requestId}:${input.content}`);
      return { messageId: 'sent-1' };
    },
    react: async () => undefined,
    editMessage: async () => undefined,
    adminTool: async input => ({ status: 'denied', reason: `no tools yet: ${input.toolName}` }),
    health: async () => ({ ok: true }),
    listTools: async () => [{ name: 'list_roles', risk: 'read', requiresApproval: false, args: [] }],
  };
}

test('the socket rejects a wrong secret and is not world readable', async () => {
  const file = await socketPath();
  const server = new AgentSocketServer({ socketPath: file, secret: 'right', handlers: handlers([]) });
  await server.start();

  const stat = await fs.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);

  const client = await connect(file);
  client.socket.write(`${JSON.stringify({ type: 'auth', secret: 'wrong' })}\n`);
  assert.deepEqual(await client.next(), { type: 'auth_result', ok: false });

  await server.stop();
});

test('an authenticated sidecar can round-trip frames and receive inbound messages', async () => {
  const file = await socketPath();
  const calls: string[] = [];
  const server = new AgentSocketServer({ socketPath: file, secret: 'right', handlers: handlers(calls) });
  await server.start();

  const client = await connect(file);
  client.socket.write(`${JSON.stringify({ type: 'auth', secret: 'right' })}\n`);
  assert.deepEqual(await client.next(), { type: 'auth_result', ok: true });

  server.sendInboundMessage(
    { requestId: 'req-1', userId: 'u', guildId: 'g', channelId: 'c', messageId: 'm', createdAt: '', expiresAt: 0 },
    'hallo',
  );
  assert.deepEqual(await client.next(), { type: 'inbound_message', requestId: 'req-1', channelId: 'c', text: 'hallo' });

  client.socket.write(`${JSON.stringify({ type: 'reply', id: '1', requestId: 'req-1', content: 'hi' })}\n`);
  assert.deepEqual(await client.next(), { type: 'result', id: '1', ok: true, result: { messageId: 'sent-1' } });
  assert.deepEqual(calls, ['reply:req-1:hi']);

  client.socket.write(`${JSON.stringify({ type: 'nonsense', id: '2' })}\n`);
  const unknown = await client.next();
  assert.equal(unknown.ok, false);

  client.socket.destroy();
  await server.stop();
});

test('frames before authentication are refused', async () => {
  const file = await socketPath();
  const server = new AgentSocketServer({ socketPath: file, secret: 'right', handlers: handlers([]) });
  await server.start();

  const client = await connect(file);
  client.socket.write(`${JSON.stringify({ type: 'reply', requestId: 'req-1', content: 'hi' })}\n`);
  assert.deepEqual(await client.next(), { type: 'auth_result', ok: false });

  await server.stop();
  await assert.rejects(fs.stat(file));
});
