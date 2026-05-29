import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompBuilderService } from './compBuilderService.js';
import { ValorantInsightsService } from '../query/insightsService.js';
import { FileValorantRepository } from '../storage/fileRepository.js';
import type { CompositionRecord, CompBuilderPreset, ValorantAppState } from '../domain/models.js';

// Comp A: jett + sova + omen + killjoy + skye  (unique agents: sova, omen, killjoy, skye)
// Comp B: jett + fade + viper + cypher + breach (shares jett with A)
// Comp C: neon + fade + viper + cypher + breach (shares fade/viper/cypher/breach with B)
const COMP_A = ['jett', 'sova', 'omen', 'killjoy', 'skye'];
const COMP_B = ['jett', 'fade', 'viper', 'cypher', 'breach'];
const COMP_C = ['neon', 'fade', 'viper', 'cypher', 'breach'];

function makeCompositions(agents: string[], count: number, mapName = 'ascent'): CompositionRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    matchPageTitle: `Match ${i}`,
    mapName,
    teamName: `Team ${i}`,
    agents,
    won: true,
    playedAt: '2026-01-01T00:00:00.000Z',
    scope: 'emea' as const,
  }));
}

function buildState(overrides: Partial<Pick<ValorantAppState, 'compositions' | 'builderPresets'>> = {}): ValorantAppState {
  return {
    version: 2,
    metadata: { provider: 'vlr', windowDays: 90, healthState: 'healthy', healthReasons: [] },
    sourceEvents: [],
    matchReferences: [],
    compositions: [
      ...makeCompositions(COMP_A, 3),
      ...makeCompositions(COMP_B, 3),
      ...makeCompositions(COMP_C, 3),
    ],
    fullCompositionAggregates: [],
    builderPresets: [],
    syncRuns: [],
    ...overrides,
  };
}

function createService(state: ValorantAppState): CompBuilderService {
  const repository = new FileValorantRepository({
    filePath: join(tmpdir(), `gpu-search-compbuilder-test-${randomUUID()}.json`),
    windowDays: 90,
    enabled: true,
    provider: 'vlr',
  });
  const insights = new ValorantInsightsService(repository);
  insights.primeState(state);
  return new CompBuilderService(repository, insights, 30);
}

const USER = 'user-1';

test('auto-complete: pick_agent reduces to 1 comp → completed with all 5 agents', async () => {
  const service = createService(buildState());
  const session = await service.startSession(USER, { filters: {} });

  await service.applyAction(USER, session.sessionId, { type: 'set_map', mapKey: 'ascent' });
  // 'sova' only appears in Comp A → 1 candidate → auto-complete
  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'sova' });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.autoCompleted, true);
  assert.equal(snapshot.selectedAgentKeys.length, 5);
  assert.ok(COMP_A.every(k => snapshot.selectedAgentKeys.includes(k)), 'all Comp A agents selected');
  assert.ok(snapshot.exactComposition, 'exactComposition is set');
});

test('auto-complete: pick_agent with 2 comps remaining → no auto-complete', async () => {
  const service = createService(buildState());
  const session = await service.startSession(USER, { filters: {} });

  await service.applyAction(USER, session.sessionId, { type: 'set_map', mapKey: 'ascent' });
  // 'jett' appears in Comp A and Comp B → 2 candidates → no auto-complete
  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'jett' });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.autoCompleted, undefined);
  assert.equal(snapshot.selectedAgentKeys.length, 1);
});

test('auto-complete: second pick_agent narrows to 1 comp → auto-complete', async () => {
  const service = createService(buildState());
  const session = await service.startSession(USER, { filters: {} });

  await service.applyAction(USER, session.sessionId, { type: 'set_map', mapKey: 'ascent' });
  await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'jett' }); // A + B remain
  // 'sova' is only in Comp A → 1 candidate → auto-complete
  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'sova' });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.autoCompleted, true);
  assert.equal(snapshot.selectedAgentKeys.length, 5);
});

test('auto-complete: exclude_agent reduces to 1 comp → auto-complete', async () => {
  const service = createService(buildState());
  const session = await service.startSession(USER, { filters: {} });

  await service.applyAction(USER, session.sessionId, { type: 'set_map', mapKey: 'ascent' });
  await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'jett' }); // A + B remain
  // 'fade' is only in Comp B → excluding fade removes Comp B → only Comp A
  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'exclude_agent', agentKey: 'fade' });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.autoCompleted, true);
  assert.equal(snapshot.selectedAgentKeys.length, 5);
  assert.ok(COMP_A.every(k => snapshot.selectedAgentKeys.includes(k)));
});

test('auto-complete: load_preset with 1 candidate comp → auto-complete', async () => {
  const presetId = randomUUID();
  const preset: CompBuilderPreset = {
    id: presetId,
    userId: USER,
    name: 'Test Preset',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    filters: {},
    selectedMapKey: 'ascent',
    selectedAgentKeys: ['sova'], // sova is unique to Comp A
    excludedAgentKeys: [],
  };
  const service = createService(buildState({ builderPresets: [preset] }));
  const session = await service.startSession(USER, { filters: {} });

  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'load_preset', presetId });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.autoCompleted, true);
  assert.equal(snapshot.selectedAgentKeys.length, 5);
});

test('auto-complete: replace_agent not in trigger list → no auto-complete', async () => {
  const service = createService(buildState());
  const session = await service.startSession(USER, { filters: {} });

  await service.applyAction(USER, session.sessionId, { type: 'set_map', mapKey: 'ascent' });
  const afterAutoComplete = await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'sova' });
  assert.equal(afterAutoComplete?.completed, true, 'pre-condition: auto-complete triggered');

  // replace_agent is not in the trigger list → auto-complete is never attempted
  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'replace_agent', agentKey: 'jett' });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.autoCompleted, undefined);
  assert.equal(snapshot.replacementAgentKey, 'jett');
});

test('back after auto-complete: removes last agent, completed = false', async () => {
  const service = createService(buildState());
  const session = await service.startSession(USER, { filters: {} });

  await service.applyAction(USER, session.sessionId, { type: 'set_map', mapKey: 'ascent' });
  const afterAutoComplete = await service.applyAction(USER, session.sessionId, { type: 'pick_agent', agentKey: 'sova' });
  assert.equal(afterAutoComplete?.completed, true, 'pre-condition: auto-complete triggered');

  const snapshot = await service.applyAction(USER, session.sessionId, { type: 'back' });

  assert.ok(snapshot);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.selectedAgentKeys.length, 4);
});
