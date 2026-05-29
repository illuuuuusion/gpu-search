import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './http.js';

function makeHttpError(status: number, retryAfterSeconds?: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: {
      status,
      headers: retryAfterSeconds !== undefined ? { 'retry-after': String(retryAfterSeconds) } : {},
    },
  });
}

function makeNetworkError(code: string): Error {
  return Object.assign(new Error(code), { isAxiosError: true, code });
}

test('withRetry succeeds on second attempt after 500', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw makeHttpError(500);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('withRetry retries on 429 and respects Retry-After header', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw makeHttpError(429, 0);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('withRetry does not retry on 400', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw makeHttpError(400);
    }),
    { message: 'HTTP 400' },
  );
  assert.equal(calls, 1);
});

test('withRetry does not retry on 401', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw makeHttpError(401);
    }),
  );
  assert.equal(calls, 1);
});

test('withRetry retries ETIMEDOUT and exhausts max retries', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw makeNetworkError('ETIMEDOUT');
    }),
    { message: 'ETIMEDOUT' },
  );
  // initial call + EBAY_HTTP_MAX_RETRIES (default 3) retries = 4 total
  assert.ok(calls > 1, `expected multiple attempts, got ${calls}`);
});

test('withRetry does not retry non-axios errors', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new Error('not an axios error');
    }),
    { message: 'not an axios error' },
  );
  assert.equal(calls, 1);
});
