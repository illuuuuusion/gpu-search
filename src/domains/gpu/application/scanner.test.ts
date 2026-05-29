import test from 'node:test';
import assert from 'node:assert/strict';
import { ScannerService } from './scanner.js';
import { searchBuckets } from '../config/searchBuckets.js';
import type { GpuProfile } from '../domain/models.js';
import type { AlertMessage, NotificationReceipt, Notifier } from '../../../app/shared/notifier/index.js';

const profile: GpuProfile = {
  name: 'RTX 3090',
  aliases: ['RTX 3090'],
  negativeAliases: [],
  vramGb: 24,
  category: 'High-End / NVIDIA Ampere',
  targetHealth: 'WORKING',
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

class RecordingNotifier implements Notifier {
  public readonly sentMessages: AlertMessage[] = [];

  constructor(private readonly activeListingIdsProvider: () => string[]) {}

  async send(message: AlertMessage): Promise<NotificationReceipt> {
    this.sentMessages.push(message);
    return {
      messageId: `message-${this.sentMessages.length}`,
      channelId: 'channel-1',
    };
  }

  async listActiveGpuListingIds(): Promise<string[]> {
    return this.activeListingIdsProvider();
  }
}

test('scanner skips reposting listings that are still present in Discord', async () => {
  const activeListingIds = new Set<string>();
  const notifier = new RecordingNotifier(() => Array.from(activeListingIds));
  const scanner = new ScannerService(notifier);

  await scanner.resetState([profile]);

  const firstRun = await scanner.runOnce([profile], {
    ignoreBucketWatermarks: true,
    runAvailabilityCleanup: false,
    maxAlerts: 1,
  });
  const firstListingId = notifier.sentMessages[0]?.listingId;

  assert.equal(firstRun.alertsPosted, 1);
  assert.ok(firstListingId);

  activeListingIds.add(firstListingId);
  notifier.sentMessages.length = 0;

  const secondRun = await scanner.runOnce([profile], {
    ignoreBucketWatermarks: true,
    runAvailabilityCleanup: false,
    maxAlerts: 1,
  });

  assert.equal(secondRun.alertsPosted, 0);
  assert.equal(secondRun.seenSkipped, 1);
  assert.equal(notifier.sentMessages.length, 0);
});

test('scanner reposts listings when they no longer exist in Discord even if they are in local seen state', async () => {
  const activeListingIds = new Set<string>();
  const notifier = new RecordingNotifier(() => Array.from(activeListingIds));
  const scanner = new ScannerService(notifier);

  await scanner.resetState([profile]);

  const firstRun = await scanner.runOnce([profile], {
    ignoreBucketWatermarks: true,
    runAvailabilityCleanup: false,
    maxAlerts: 1,
  });
  const firstListingId = notifier.sentMessages[0]?.listingId;

  assert.equal(firstRun.alertsPosted, 1);
  assert.ok(firstListingId);

  notifier.sentMessages.length = 0;

  const secondRun = await scanner.runOnce([profile], {
    ignoreBucketWatermarks: true,
    runAvailabilityCleanup: false,
    maxAlerts: 1,
  });

  assert.equal(secondRun.alertsPosted, 1);
  assert.equal(secondRun.seenSkipped, 0);
  assert.equal(notifier.sentMessages.length, 1);
  assert.equal(notifier.sentMessages[0]?.listingId, firstListingId);
});

type ScannerInternals = { bucketWatermarks: Map<string, string> };
function getWatermarks(scanner: ScannerService): Map<string, string> {
  return (scanner as unknown as ScannerInternals).bucketWatermarks;
}

test('bucket watermarks are set to valid ISO dates after a successful scan', async () => {
  const notifier = new RecordingNotifier(() => []);
  const scanner = new ScannerService(notifier);
  await scanner.resetState([profile]);

  assert.equal(getWatermarks(scanner).size, 0, 'watermarks should be empty before first scan');

  await scanner.runOnce([profile], { runAvailabilityCleanup: false, maxAlerts: 0 });

  assert.ok(getWatermarks(scanner).size > 0, 'watermarks should be populated after scan');
  for (const [, watermark] of getWatermarks(scanner)) {
    assert.ok(!Number.isNaN(Date.parse(watermark)), `watermark should be a valid ISO date string: ${watermark}`);
  }
});

test('far-future watermark causes scan to collect zero listings', async () => {
  const notifier = new RecordingNotifier(() => []);
  const scanner = new ScannerService(notifier);
  await scanner.resetState([profile]);

  const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  for (const bucket of searchBuckets) {
    getWatermarks(scanner).set(bucket.id, farFuture);
  }

  const result = await scanner.runOnce([profile], {
    ignoreSeen: true,
    runAvailabilityCleanup: false,
    maxAlerts: 0,
  });

  assert.equal(result.uniqueListings, 0, 'all listings should be filtered when watermark is far in the future');
});

test('overlap window includes listings that are slightly older than the watermark', async () => {
  const notifier = new RecordingNotifier(() => []);
  const scanner = new ScannerService(notifier);
  await scanner.resetState([profile]);

  // Baseline: collect everything ignoring watermarks
  const baseline = await scanner.runOnce([profile], {
    ignoreSeen: true,
    ignoreBucketWatermarks: true,
    runAvailabilityCleanup: false,
    maxAlerts: 0,
  });
  assert.ok(baseline.uniqueListings > 0, 'baseline scan should find listings');

  // Set watermark to 1 minute ago. Without overlap cutoff = now-1min and mock
  // listings 2-3 minutes old would be excluded. With 10-minute overlap the
  // cutoff shifts to now-11min so all mock listings (max 3min old) still pass.
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  for (const bucket of searchBuckets) {
    getWatermarks(scanner).set(bucket.id, oneMinuteAgo);
  }

  const result = await scanner.runOnce([profile], {
    ignoreSeen: true,
    runAvailabilityCleanup: false,
    maxAlerts: 0,
  });

  assert.equal(
    result.uniqueListings,
    baseline.uniqueListings,
    'overlap window should include listings near the watermark boundary',
  );
});
