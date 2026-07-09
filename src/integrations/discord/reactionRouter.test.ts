import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReactionRouter, type ReactionEvent } from './reactionRouter.js';

function event(type: string, emoji: string): ReactionEvent {
  return {
    emoji,
    userId: 'user-1',
    messageId: 'msg-1',
    channelId: 'chan-1',
    route: { type, profileName: 'RTX 3090' },
    // Nur der Router-Dispatch wird getestet; die Message wird hier nicht benutzt.
    reaction: {} as ReactionEvent['reaction'],
  };
}

test('ReactionRouter dispatches only to the handler for the route type', async () => {
  const router = new ReactionRouter();
  const calls: string[] = [];
  router.register('acceptance-feedback', async e => {
    calls.push(`feedback:${e.emoji}`);
  });
  router.register('acceptance-reset', async () => {
    calls.push('reset');
  });

  await router.handle(event('acceptance-feedback', '👍'));
  await router.handle(event('acceptance-reset', '↩️'));
  await router.handle(event('unknown-type', '❓')); // no handler -> silently ignored

  assert.deepEqual(calls, ['feedback:👍', 'reset']);
});
