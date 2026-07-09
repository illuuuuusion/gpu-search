import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { counters, withSpan } from './telemetry.js';

// Tests laufen mit OTEL_ENABLED ungesetzt (Default false) -> kein offener Port.
test('telemetry does not open the prometheus port when disabled', async () => {
  const inUse = await new Promise<boolean>(resolve => {
    const socket = net
      .connect(9464, '127.0.0.1')
      .once('connect', () => {
        socket.destroy();
        resolve(true);
      })
      .once('error', () => resolve(false));
  });
  assert.equal(inUse, false, 'prometheus port must stay closed when OTEL_ENABLED=false');
});

test('withSpan returns the wrapped result and counters are usable no-ops', async () => {
  const result = await withSpan('test.span', async () => 42);
  assert.equal(result, 42);
  assert.doesNotThrow(() => counters.ebayHttpRetries.add(1));
});

test('withSpan propagates errors from the wrapped function', async () => {
  await assert.rejects(withSpan('test.span.error', async () => {
    throw new Error('boom');
  }), /boom/);
});
