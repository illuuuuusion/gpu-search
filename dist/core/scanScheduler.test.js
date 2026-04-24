import test from 'node:test';
import assert from 'node:assert/strict';
import { ScanScheduler } from './scanScheduler.js';
const profiles = [];
test('triggerManualScan waits for an active scan and reports queued status', async () => {
    let releaseFirstScan;
    let runCount = 0;
    const scanner = {
        async runOnce() {
            runCount += 1;
            if (runCount === 1) {
                await new Promise(resolve => {
                    releaseFirstScan = resolve;
                });
            }
            return {
                uniqueListings: 0,
                acceptedListings: 0,
                seenSkipped: 0,
                alertsPosted: 0,
                notificationFailures: 0,
                availabilityRemovals: 0,
            };
        },
    };
    const scheduler = new ScanScheduler(scanner, profiles, 60_000);
    const firstScan = scheduler.start();
    const queuedScan = scheduler.triggerManualScan();
    await new Promise(resolve => setTimeout(resolve, 10));
    releaseFirstScan?.();
    await firstScan;
    const result = await queuedScan;
    scheduler.stop();
    assert.equal(result.status, 'queued_after_running_scan');
    assert.equal(runCount, 2);
    assert.equal(scheduler.getScanInfo().scanRunning, false);
});
