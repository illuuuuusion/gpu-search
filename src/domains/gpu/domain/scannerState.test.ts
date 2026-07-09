import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ScannerStateStore } from './scannerState.js';
import type { EvaluatedListing, GpuProfile } from '../domain/models.js';

const profile: GpuProfile = {
  name: 'RTX 3090',
  aliases: ['RTX 3090'],
  negativeAliases: [],
  vramGb: 24,
  category: 'High-End / NVIDIA Ampere',
  vramVariants: false,
  excludeNew: true,
  onlyGermany: false,
  prices: {
    buyNowWorking: 430,
    buyNowDefect: 135,
    auctionWorking: 385,
    auctionDefect: 105,
  },
};

function buildResult(overrides: Partial<EvaluatedListing>): EvaluatedListing {
  return {
    profile,
    listing: {
      id: 'listing-1',
      title: 'RTX 3090 defekt',
      itemWebUrl: 'https://example.invalid/item',
      priceEur: 100,
      shippingEur: 5,
      totalEur: 105,
      currency: 'EUR',
      buyingOptions: ['FIXED_PRICE'],
      aspects: [],
      raw: {},
    },
    health: 'DEFECT',
    accepted: true,
    reasons: [],
    score: 12,
    baseLimitEur: 135,
    effectiveLimitEur: 135,
    limitHeadroomPercent: 22,
    ...overrides,
  };
}

test('buildMarketDashboardSnapshot exposes chart-friendly daily and weekly series', async () => {
  const store = new ScannerStateStore();
  await store.load();
  await store.reset();

  await store.recordObservation(buildResult({
    listing: {
      id: 'listing-a',
      title: 'RTX 3090 defekt kein Bild',
      itemWebUrl: 'https://example.invalid/a',
      priceEur: 100,
      shippingEur: 5,
      totalEur: 105,
      currency: 'EUR',
      buyingOptions: ['FIXED_PRICE'],
      aspects: [],
      raw: {},
    },
    score: 10,
  }));
  await store.recordObservation(buildResult({
    listing: {
      id: 'listing-b',
      title: 'RTX 3090 funktioniert',
      itemWebUrl: 'https://example.invalid/b',
      priceEur: 200,
      shippingEur: 8,
      totalEur: 208,
      currency: 'EUR',
      buyingOptions: ['FIXED_PRICE'],
      aspects: [],
      raw: {},
    },
    health: 'WORKING',
    score: 25,
  }));

  const snapshot = store.buildMarketDashboardSnapshot([profile]);

  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.profiles[0]?.profileName, 'RTX 3090');
  assert.ok(snapshot.profiles[0]?.charts.daily.length >= 1);
  assert.ok(snapshot.profiles[0]?.charts.weekly.length >= 1);
  assert.equal(snapshot.barCharts.acceptedCountByProfile[0]?.value, 2);
});

test('availability tracking updates active listing status for web-ready snapshots', async () => {
  const store = new ScannerStateStore();
  await store.load();
  await store.reset();

  await store.recordSent(buildResult({}), {
    messageId: 'message-1',
    channelId: 'channel-1',
  });
  await store.recordAvailabilityCheck('listing-1', '2026-04-26T10:00:00.000Z', 'available', 'available');
  await store.recordAvailabilityFailure('listing-1', '2026-04-26T10:12:00.000Z', 'temporary_error');

  const snapshot = store.buildMarketDashboardSnapshot([profile]);

  assert.equal(snapshot.activeListings.length, 1);
  assert.equal(snapshot.activeListings[0]?.lastAvailabilityState, 'check_failed');
  assert.equal(snapshot.activeListings[0]?.availabilityCheckFailures, 1);
  assert.equal(snapshot.activeListings[0]?.lastAvailabilityReason, 'temporary_error');
});

async function readStatePath(): Promise<string | null> {
  const statePath = process.env['SCANNER_STATE_PATH'];
  if (!statePath) return null;
  try {
    return await fs.readFile(statePath, 'utf-8');
  } catch {
    return null;
  }
}

test('batch mode defers disk writes until commitBatch', async () => {
  const store = new ScannerStateStore();
  await store.load();
  await store.reset();

  const afterReset = await readStatePath();
  assert.ok(afterReset, 'state file should exist after reset');

  store.beginBatch();

  await store.recordObservation(buildResult({ listing: { ...buildResult({}).listing, id: 'batch-listing-1' } }));
  await store.recordObservation(buildResult({ listing: { ...buildResult({}).listing, id: 'batch-listing-2' } }));

  const duringBatch = await readStatePath();
  assert.equal(duringBatch, afterReset, 'file should not be updated during active batch');

  await store.commitBatch();

  const afterCommit = await readStatePath();
  assert.notEqual(afterCommit, afterReset, 'file should be updated after commitBatch');
  assert.ok(afterCommit?.includes('batch-listing-1'), 'committed state should contain first listing');
  assert.ok(afterCommit?.includes('batch-listing-2'), 'committed state should contain second listing');
});

test('commitBatch without beginBatch is a no-op', async () => {
  const store = new ScannerStateStore();
  await store.load();
  await store.reset();

  const afterReset = await readStatePath();

  await store.commitBatch();

  const afterCommit = await readStatePath();
  assert.equal(afterCommit, afterReset, 'file should be unchanged when commitBatch called without beginBatch');
});

async function freshStore(): Promise<ScannerStateStore> {
  const store = new ScannerStateStore();
  await store.load();
  await store.reset();
  return store;
}

test('recordAcceptanceReaction only adjusts bias at 3 of 5 same-direction reactions', async () => {
  const store = await freshStore();

  const first = await store.recordAcceptanceReaction('RTX 3090', 'down');
  const second = await store.recordAcceptanceReaction('RTX 3090', 'down');
  assert.equal(first.adjusted, false);
  assert.equal(second.adjusted, false);
  assert.equal(store.getAcceptanceBias('RTX 3090'), 0);

  const third = await store.recordAcceptanceReaction('RTX 3090', 'down');
  assert.equal(third.adjusted, true);
  assert.equal(third.bias, -0.05);
  assert.equal(store.getAcceptanceBias('RTX 3090'), -0.05);
});

test('acceptance bias stays within [-0.15, 0.15] under repeated feedback', async () => {
  const store = await freshStore();

  for (let step = 0; step < 10; step += 1) {
    await store.recordAcceptanceReaction('RTX 3090', 'up');
    await store.recordAcceptanceReaction('RTX 3090', 'up');
    await store.recordAcceptanceReaction('RTX 3090', 'up');
  }

  assert.equal(store.getAcceptanceBias('RTX 3090'), 0.15);
});

test('resetAcceptanceBias returns the bias to zero', async () => {
  const store = await freshStore();

  await store.recordAcceptanceReaction('RTX 3090', 'up');
  await store.recordAcceptanceReaction('RTX 3090', 'up');
  await store.recordAcceptanceReaction('RTX 3090', 'up');
  assert.equal(store.getAcceptanceBias('RTX 3090'), 0.05);

  const result = await store.resetAcceptanceBias('RTX 3090');
  assert.equal(result.adjusted, true);
  assert.equal(store.getAcceptanceBias('RTX 3090'), 0);
});

test('applyBiasDecay pulls the bias toward zero over simulated time', async () => {
  const store = await freshStore();

  await store.recordAcceptanceReaction('RTX 3090', 'up');
  await store.recordAcceptanceReaction('RTX 3090', 'up');
  await store.recordAcceptanceReaction('RTX 3090', 'up');
  const before = store.getAcceptanceBias('RTX 3090');
  assert.ok(before > 0);

  await store.applyBiasDecay(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const after = store.getAcceptanceBias('RTX 3090');
  assert.ok(after < before, `expected decay: ${after} < ${before}`);

  await store.applyBiasDecay(Date.now() + 400 * 24 * 60 * 60 * 1000);
  assert.equal(store.getAcceptanceBias('RTX 3090'), 0);
});

test('reaction routes are registered on send and resolvable afterwards', async () => {
  const store = await freshStore();

  await store.recordSent(buildResult({}), { messageId: 'msg-42', channelId: 'chan-1' });
  const route = store.getReactionRoute('msg-42');
  assert.equal(route?.type, 'acceptance-feedback');
  assert.equal(route?.profileName, 'RTX 3090');
  assert.equal(route?.listingId, 'listing-1');

  await store.registerReactionRoute({ messageId: 'msg-99', type: 'acceptance-reset', profileName: 'RTX 3090' });
  assert.equal(store.getReactionRoute('msg-99')?.type, 'acceptance-reset');
});
