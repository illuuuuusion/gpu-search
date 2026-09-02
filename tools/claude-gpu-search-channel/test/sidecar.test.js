import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { SocketClient } from '../src/socketClient/index.js';
import { assertNoDiscordCredentials, readSecret } from '../src/index.js';

const packageRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return files.flat();
}

test('the sidecar never depends on or imports discord.js', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, {});

  for (const file of await listFiles(path.join(packageRoot, 'src'))) {
    const source = await fs.readFile(file, 'utf8');
    assert.ok(!/discord\.js/.test(source), `${file} must not reference discord.js`);
    assert.ok(!/DISCORD_BOT_TOKEN['"]?\s*[:=]/.test(source), `${file} must not read a bot token`);
  }
});

test('inherited discord credentials abort the start', () => {
  assert.doesNotThrow(() => assertNoDiscordCredentials({ AI_SOCKET_PATH: '/tmp/x.sock' }));
  assert.throws(() => assertNoDiscordCredentials({ DISCORD_BOT_TOKEN: 'x' }), /must not inherit/);
  assert.throws(() => assertNoDiscordCredentials({ DISCORD_BOT_TOKEN_FILE: '/run/secrets/x' }), /must not inherit/);
});

test('the socket secret is read from a file, never from a plain env var', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-')), 'secret');
  await fs.writeFile(file, ' s3cret\n');
  assert.equal(readSecret({ AI_SOCKET_SECRET_FILE: file }), 's3cret');
  assert.throws(() => readSecret({ AI_SOCKET_SECRET: 's3cret' }), /AI_SOCKET_SECRET_FILE is required/);
});

test('the socket client authenticates first and correlates responses', async () => {
  const socketPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-sock-')), 'channel.sock');
  const received = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        const frame = JSON.parse(line);
        received.push(frame);
        if (frame.type === 'auth') {
          socket.write(`${JSON.stringify({ type: 'auth_result', ok: frame.secret === 'right' })}\n`);
        } else {
          socket.write(`${JSON.stringify({ type: 'result', id: frame.id, ok: true, result: { messageId: 'm1' } })}\n`);
        }
      }
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve));

  const inbound = [];
  const client = new SocketClient({ socketPath, secret: 'right', onInbound: frame => inbound.push(frame) });
  await client.connect();
  assert.equal(received[0].type, 'auth');

  assert.deepEqual(await client.request('reply', { requestId: 'req-1', content: 'hi' }), { messageId: 'm1' });
  assert.equal(received[1].requestId, 'req-1');

  client.close();
  await new Promise(resolve => server.close(resolve));
});

test('a wrong secret rejects the connection', async () => {
  const socketPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-sock-')), 'channel.sock');
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.on('data', () => socket.write(`${JSON.stringify({ type: 'auth_result', ok: false })}\n`));
  });
  await new Promise(resolve => server.listen(socketPath, resolve));

  const client = new SocketClient({ socketPath, secret: 'wrong' });
  await assert.rejects(client.connect(), /authentication rejected/);
  await assert.rejects(client.request('health'), /not authenticated/);

  client.close();
  await new Promise(resolve => server.close(resolve));
});
