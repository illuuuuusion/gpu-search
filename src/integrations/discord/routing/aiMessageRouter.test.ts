import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestContextStore } from '../ai/requestContextStore.js';
import { AiMessageRouter, type AiMessageRouterOptions, type AiRouterMessage } from './aiMessageRouter.js';

const BOT_ID = 'bot-1';

function message(overrides: Partial<AiRouterMessage> = {}): AiRouterMessage {
  return {
    id: 'msg-1',
    content: `<@${BOT_ID}> zeig mir die Rollen`,
    guildId: 'guild-1',
    channelId: 'chan-1',
    author: { id: 'user-1', bot: false },
    mentions: { has: (id: string) => id === BOT_ID },
    ...overrides,
  };
}

function build(options: Partial<AiMessageRouterOptions> = {}) {
  const forwarded: { userId: string; text: string }[] = [];
  const router = new AiMessageRouter(
    {
      enabled: true,
      guildId: 'guild-1',
      allowedUserIds: new Set(['user-1']),
      allowedChannelIds: new Set(['chan-1']),
      requireMention: true,
      botUserId: () => BOT_ID,
      forward: async (context, text) => {
        forwarded.push({ userId: context.userId, text });
      },
      ...options,
    },
    new RequestContextStore(600),
  );
  return { router, forwarded };
}

test('an allowed mention is forwarded with the mention stripped', async () => {
  const { router, forwarded } = build();
  assert.equal(await router.handle(message()), true);
  assert.deepEqual(forwarded, [{ userId: 'user-1', text: 'zeig mir die Rollen' }]);
});

test('foreign users, channels, guilds, bots and webhooks are dropped silently', async () => {
  const { router, forwarded } = build();
  const dropped: AiRouterMessage[] = [
    message({ author: { id: 'stranger', bot: false } }),
    message({ channelId: 'other-chan' }),
    message({ guildId: 'other-guild' }),
    message({ guildId: null }),
    message({ author: { id: 'user-1', bot: true } }),
    message({ webhookId: 'hook-1' }),
    message({ content: `<@${BOT_ID}>   ` }),
  ];

  for (const candidate of dropped) {
    assert.equal(await router.handle(candidate), false);
  }
  assert.deepEqual(forwarded, []);
});

test('mention requirement can only be satisfied by a mention or a reply to an agent message', async () => {
  const { router, forwarded } = build();
  assert.equal(await router.handle(message({ content: 'zeig mir die Rollen', mentions: { has: () => false } })), false);

  router.markAgentMessage('agent-msg');
  const replied = await router.handle(message({
    content: 'und die Channels?',
    mentions: { has: () => false },
    reference: { messageId: 'agent-msg' },
  }));
  assert.equal(replied, true);
  assert.equal(forwarded.at(-1)?.text, 'und die Channels?');
});

test('a running notifier dialog wins over the ai router', async () => {
  const { router, forwarded } = build({ hasActiveDialog: () => true });
  assert.equal(await router.handle(message()), false);
  assert.deepEqual(forwarded, []);
});

test('a disabled router never forwards', async () => {
  const { router, forwarded } = build({ enabled: false });
  assert.equal(await router.handle(message()), false);
  assert.deepEqual(forwarded, []);
});
