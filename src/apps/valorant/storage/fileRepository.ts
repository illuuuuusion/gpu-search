import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CompositionRecord,
  CompBuilderPreset,
  FullCompositionAggregate,
  ValorantHealthState,
  ValorantAppState,
  ValorantCompositionProvider,
  ValorantMatchReference,
  ValorantSnapshotMetadata,
  ValorantSourceEvent,
  ValorantStatusSnapshot,
  ValorantSyncRun,
} from '../domain/models.js';

interface FileValorantRepositoryOptions {
  filePath: string;
  windowDays: number;
  enabled: boolean;
  provider: ValorantCompositionProvider;
}

interface LegacyValorantState {
  metadata?: {
    windowDays?: number;
    nextScheduledSyncAt?: string;
    lastAttemptedSyncAt?: string;
    lastSuccessfulSyncAt?: string;
    healthState?: ValorantHealthState;
    healthReasons?: string[];
    lastError?: string;
  };
  compositions?: CompositionRecord[];
  fullCompositionAggregates?: FullCompositionAggregate[];
}

function createEmptyMetadata(
  windowDays: number,
  provider: ValorantCompositionProvider,
): ValorantSnapshotMetadata {
  return {
    provider,
    windowDays,
  };
}

function createEmptyState(
  windowDays: number,
  provider: ValorantCompositionProvider,
): ValorantAppState {
  return {
    version: 2,
    metadata: createEmptyMetadata(windowDays, provider),
    sourceEvents: [],
    matchReferences: [],
    compositions: [],
    fullCompositionAggregates: [],
    builderPresets: [],
    syncRuns: [],
  };
}

function normalizeSyncRuns(syncRuns: unknown): ValorantSyncRun[] {
  if (!Array.isArray(syncRuns)) {
    return [];
  }

  return syncRuns.filter((run): run is ValorantSyncRun =>
    Boolean(
      run
      && typeof run === 'object'
      && 'id' in run
      && 'status' in run
      && 'trigger' in run,
    ),
  );
}

function normalizeSourceEvents(sourceEvents: unknown): ValorantSourceEvent[] {
  if (!Array.isArray(sourceEvents)) {
    return [];
  }

  return sourceEvents.filter((event): event is ValorantSourceEvent =>
    Boolean(
      event
      && typeof event === 'object'
      && 'id' in event
      && 'title' in event
      && 'scope' in event,
    ),
  );
}

function normalizeMatchReferences(matchReferences: unknown): ValorantMatchReference[] {
  if (!Array.isArray(matchReferences)) {
    return [];
  }

  return matchReferences.filter((matchReference): matchReference is ValorantMatchReference =>
    Boolean(
      matchReference
      && typeof matchReference === 'object'
      && 'path' in matchReference
      && 'playedAt' in matchReference
      && 'fetchedAt' in matchReference,
    ),
  );
}

function normalizeBuilderPresets(builderPresets: unknown): CompBuilderPreset[] {
  if (!Array.isArray(builderPresets)) {
    return [];
  }

  return builderPresets.filter((preset): preset is CompBuilderPreset =>
    Boolean(
      preset
      && typeof preset === 'object'
      && 'id' in preset
      && 'userId' in preset
      && 'name' in preset,
    ),
  );
}

function migrateLegacyState(
  legacyState: LegacyValorantState,
  windowDays: number,
  provider: ValorantCompositionProvider,
): ValorantAppState {
  return {
    version: 2,
    metadata: {
      ...createEmptyMetadata(windowDays, provider),
      ...legacyState.metadata,
      provider,
      windowDays: legacyState.metadata?.windowDays ?? windowDays,
    },
    sourceEvents: [],
    matchReferences: [],
    compositions: legacyState.compositions ?? [],
    fullCompositionAggregates: legacyState.fullCompositionAggregates ?? [],
    builderPresets: [],
    syncRuns: [],
  };
}

export class FileValorantRepository {
  constructor(private readonly options: FileValorantRepositoryOptions) {}

  async load(): Promise<ValorantAppState> {
    try {
      const raw = await readFile(this.options.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ValorantAppState> & LegacyValorantState;
      if (parsed.version !== 2) {
        return migrateLegacyState(parsed, this.options.windowDays, this.options.provider);
      }

      return {
        ...createEmptyState(this.options.windowDays, this.options.provider),
        ...parsed,
        metadata: {
          ...createEmptyMetadata(this.options.windowDays, this.options.provider),
          ...parsed.metadata,
          provider: parsed.metadata?.provider ?? this.options.provider,
          windowDays: parsed.metadata?.windowDays ?? this.options.windowDays,
        },
        sourceEvents: normalizeSourceEvents(parsed.sourceEvents),
        matchReferences: normalizeMatchReferences(parsed.matchReferences),
        compositions: parsed.compositions ?? [],
        fullCompositionAggregates: parsed.fullCompositionAggregates ?? [],
        builderPresets: normalizeBuilderPresets(parsed.builderPresets),
        syncRuns: normalizeSyncRuns(parsed.syncRuns),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return createEmptyState(this.options.windowDays, this.options.provider);
      }

      throw error;
    }
  }

  async save(state: ValorantAppState): Promise<void> {
    await mkdir(dirname(this.options.filePath), { recursive: true });
    await writeFile(this.options.filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  async getStatusSnapshot(syncRunning: boolean): Promise<ValorantStatusSnapshot> {
    const state = await this.load();

    return {
      enabled: this.options.enabled,
      syncRunning,
      provider: state.metadata.provider,
      nextScheduledSyncAt: state.metadata.nextScheduledSyncAt,
      lastAttemptedSyncAt: state.metadata.lastAttemptedSyncAt,
      lastSuccessfulSyncAt: state.metadata.lastSuccessfulSyncAt,
      healthState: state.metadata.healthState ?? 'healthy',
      healthReasons: state.metadata.healthReasons ?? [],
      lastError: state.metadata.lastError,
      importedEvents: state.sourceEvents.length,
      parsedCompositions: state.compositions.length,
      aggregatedFullComps: state.fullCompositionAggregates.length,
    };
  }
}
