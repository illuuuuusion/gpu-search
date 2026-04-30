import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValorantSyncService } from './syncService.js';
import { FileValorantRepository } from '../../storage/fileRepository.js';
import type {
  ValorantAppState,
  ValorantCompositionProvider,
  ValorantSourceEvent,
} from '../../domain/models.js';
import type {
  ValorantCompositionDataProvider,
  ValorantProviderImportResult,
} from '../../providers/types.js';

function createRepository() {
  return new FileValorantRepository({
    filePath: join(tmpdir(), `gpu-search-valorant-sync-${randomUUID()}.json`),
    windowDays: 90,
    enabled: true,
    provider: 'vlr',
  });
}

function createProvider(
  importData: ValorantCompositionDataProvider['importData'],
  name: ValorantCompositionProvider = 'vlr',
): ValorantCompositionDataProvider {
  return {
    name,
    importData,
  };
}

async function seedState(repository: FileValorantRepository): Promise<ValorantAppState> {
  const state: ValorantAppState = {
    version: 2,
    metadata: {
      provider: 'vlr',
      windowDays: 90,
      lastSuccessfulSyncAt: '2026-04-25T08:00:00.000Z',
      healthState: 'healthy',
      healthReasons: [],
    },
    sourceEvents: [{
      id: 'event-1',
      slug: 'vct-event',
      title: 'VCT Event',
      scope: 'emea',
      status: 'completed',
      sourceUrl: 'https://example.invalid/event',
      agentsUrl: 'https://example.invalid/event/agents',
    }],
    matchReferences: [{
      path: '/match/1',
      playedAt: '2026-04-24T10:00:00.000Z',
      fetchedAt: '2026-04-24T12:00:00.000Z',
    }],
    compositions: [{
      id: 'comp-1',
      matchPageTitle: 'Match 1',
      mapName: 'Ascent',
      teamName: 'Team Alpha',
      agents: ['Jett', 'Sova', 'Omen', 'Killjoy', 'Skye'],
      won: true,
      playedAt: '2026-04-24T10:00:00.000Z',
      scope: 'emea',
      sourceEventId: 'event-1',
      sourceUrl: 'https://example.invalid/match/1',
      eventStatus: 'completed',
    }],
    fullCompositionAggregates: [],
    builderPresets: [],
    syncRuns: [],
  };

  await repository.save(state);
  return state;
}

test('runSync returns degraded failed result for retryable network errors and preserves existing data', async () => {
  const repository = createRepository();
  const initialState = await seedState(repository);
  let attempts = 0;

  const service = new ValorantSyncService(
    repository,
    createProvider(async () => {
      attempts += 1;
      const error = new Error('getaddrinfo ENOTFOUND www.vlr.gg') as Error & { code: string };
      error.code = 'ENOTFOUND';
      throw error;
    }),
    {
      windowDays: 90,
      provider: 'vlr',
      maxRetries: 2,
      retryDelayMs: 1,
    },
  );

  const result = await service.runSync('manual');
  const savedState = await repository.load();

  assert.equal(attempts, 3);
  assert.equal(result.run.status, 'failed');
  assert.equal(result.state.metadata.healthState, 'degraded');
  assert.match(result.state.metadata.healthReasons?.[0] ?? '', /DNS\/Netzwerk nicht erreichbar/);
  assert.equal(result.state.metadata.lastSuccessfulSyncAt, initialState.metadata.lastSuccessfulSyncAt);
  assert.equal(result.state.sourceEvents.length, initialState.sourceEvents.length);
  assert.equal(result.state.compositions.length, initialState.compositions.length);
  assert.equal(savedState.syncRuns[0]?.status, 'failed');
});

test('runSync retries transient failures and succeeds on a later attempt', async () => {
  const repository = createRepository();
  await seedState(repository);
  let attempts = 0;

  const importedEvent: ValorantSourceEvent = {
    id: 'event-2',
    slug: 'vct-stage-2',
    title: 'VCT Stage 2',
    scope: 'emea',
    status: 'ongoing',
    sourceUrl: 'https://example.invalid/event-2',
    agentsUrl: 'https://example.invalid/event-2/agents',
  };

  const importedResult: ValorantProviderImportResult = {
    provider: 'vlr',
    sourceEvents: [importedEvent],
    matchReferences: [],
    compositions: [],
    warnings: [],
  };

  const service = new ValorantSyncService(
    repository,
    createProvider(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('socket hang up') as Error & { code: string };
        error.code = 'ECONNRESET';
        throw error;
      }

      return importedResult;
    }),
    {
      windowDays: 90,
      provider: 'vlr',
      maxRetries: 2,
      retryDelayMs: 1,
    },
  );

  const result = await service.runSync('manual');

  assert.equal(attempts, 2);
  assert.equal(result.run.status, 'success');
  assert.equal(result.state.metadata.healthState, 'healthy');
  assert.equal(result.state.sourceEvents[0]?.id, 'event-2');
});
