import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestContextStore } from './requestContextStore.js';

test('contexts are immutable, unique and expire', () => {
  let now = 1_000;
  const store = new RequestContextStore(60, () => now);
  const context = store.create({ userId: 'u1', guildId: 'g1', channelId: 'c1', messageId: 'm1' });

  assert.equal(store.get(context.requestId)?.userId, 'u1');
  assert.throws(() => {
    (context as { userId: string }).userId = 'attacker';
  }, TypeError);

  const other = store.create({ userId: 'u1', guildId: 'g1', channelId: 'c1', messageId: 'm2' });
  assert.notEqual(context.requestId, other.requestId);

  now += 60_001;
  assert.equal(store.get(context.requestId), undefined);
});
