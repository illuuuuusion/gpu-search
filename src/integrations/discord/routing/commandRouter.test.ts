import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message } from 'discord.js';
import { CommandRouter } from './commandRouter.js';

const message = { id: 'msg-1' } as Message;

test('the first handler that consumes a message stops the chain', async () => {
  const router = new CommandRouter();
  const calls: string[] = [];
  router.registerMessageHandler('notifier', async () => {
    calls.push('notifier');
    return true;
  });
  router.registerMessageHandler('ai', async () => {
    calls.push('ai');
    return true;
  });

  assert.equal(await router.dispatchMessage(message), 'notifier');
  assert.deepEqual(calls, ['notifier']);
});

test('a failing handler does not block the following ones', async () => {
  const router = new CommandRouter();
  router.registerMessageHandler('broken', async () => {
    throw new Error('boom');
  });
  router.registerMessageHandler('ai', async () => true);

  assert.equal(await router.dispatchMessage(message), 'ai');
});

test('unclaimed messages fall through', async () => {
  const router = new CommandRouter();
  router.registerMessageHandler('notifier', async () => false);
  assert.equal(await router.dispatchMessage(message), null);
});
