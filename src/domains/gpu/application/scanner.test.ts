import test from 'node:test';
import assert from 'node:assert/strict';
import { ScannerService } from './scanner.js';
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
