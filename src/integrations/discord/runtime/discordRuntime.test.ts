import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Client } from 'discord.js';
import { DiscordRuntime } from './discordRuntime.js';

class FakeClient extends EventEmitter {
  logins = 0;
  user = { id: 'bot-1', setPresence: () => undefined };
  isReady(): boolean {
    return this.logins > 0;
  }
  async login(token: string): Promise<string> {
    assert.equal(token, 'token');
    this.logins += 1;
    return token;
  }
}

test('login happens exactly once, even with concurrent and repeated calls', async () => {
  const fake = new FakeClient();
  const runtime = new DiscordRuntime(fake as unknown as Client);

  await Promise.all([runtime.login('token'), runtime.login('token')]);
  await runtime.login('token');

  assert.equal(fake.logins, 1);
  assert.equal(runtime.botUserId, 'bot-1');
});

test('gateway events are dispatched through the shared router', async () => {
  const fake = new FakeClient();
  const runtime = new DiscordRuntime(fake as unknown as Client);
  const seen: string[] = [];
  runtime.router.registerMessageHandler('test', async message => {
    seen.push(message.id);
    return true;
  });

  fake.emit('messageCreate', { id: 'msg-1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen, ['msg-1']);
});
