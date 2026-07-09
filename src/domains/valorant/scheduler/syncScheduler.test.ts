import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValorantSyncScheduler } from './syncScheduler.js';
import type { FileValorantRepository } from '../storage/fileRepository.js';
import type { ValorantSyncService } from '../ingest/pipeline/syncService.js';

test('a failing runSync still reschedules the next run (error isolation)', async () => {
  let saveCount = 0;
  const repository = {
    load: async () => ({ metadata: {} }),
    save: async () => {
      saveCount += 1;
    },
  } as unknown as FileValorantRepository;

  const syncService = {
    runSync: async () => {
      throw new Error('boom');
    },
  } as unknown as ValorantSyncService;

  const scheduler = new ValorantSyncScheduler(repository, syncService, { ingestHourUtc: 1 });
  try {
    // manual trigger propagates the error to its caller ...
    await assert.rejects(scheduler.triggerManualSync(), /boom/);
    // ... but the next run was still scheduled (save wrote nextScheduledSyncAt).
    assert.ok(saveCount >= 1, 'expected reschedule after a failed sync');
  } finally {
    scheduler.stop();
  }
});
