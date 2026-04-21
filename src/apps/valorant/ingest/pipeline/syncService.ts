import { randomUUID } from 'node:crypto';
import { buildFullCompositionAggregates } from '../../analytics/aggregateBuilder.js';
import type {
  ValorantAppState,
  ValorantCompositionProvider,
  ValorantSyncResult,
  ValorantSyncRun,
  ValorantSyncTrigger,
} from '../../domain/models.js';
import type { ValorantCompositionDataProvider } from '../../providers/types.js';
import { FileValorantRepository } from '../../storage/fileRepository.js';
import { logger } from '../../../../utils/logger.js';

interface SyncServiceOptions {
  windowDays: number;
  provider: ValorantCompositionProvider;
}

function createRun(
  trigger: ValorantSyncTrigger,
  provider: ValorantCompositionProvider,
): ValorantSyncRun {
  return {
    id: randomUUID(),
    provider,
    trigger,
    startedAt: new Date().toISOString(),
    status: 'running',
    importedEvents: 0,
    parsedCompositions: 0,
    aggregatedFullComps: 0,
  };
}

function formatSyncError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class ValorantSyncService {
  constructor(
    private readonly repository: FileValorantRepository,
    private readonly provider: ValorantCompositionDataProvider,
    private readonly options: SyncServiceOptions,
  ) {}

  async runSync(trigger: ValorantSyncTrigger): Promise<ValorantSyncResult> {
    const now = new Date();
    const run = createRun(trigger, this.options.provider);
    const initialState = await this.repository.load();

    try {
      const imported = await this.provider.importData({
        now,
        windowDays: this.options.windowDays,
      });
      const fullCompositionAggregates = buildFullCompositionAggregates(imported.compositions);
      const completedRun: ValorantSyncRun = {
        ...run,
        finishedAt: new Date().toISOString(),
        status: 'success',
        importedEvents: imported.sourceEvents.length,
        parsedCompositions: imported.compositions.length,
        aggregatedFullComps: fullCompositionAggregates.length,
      };
      const nextState: ValorantAppState = {
        version: 2,
        metadata: {
          ...initialState.metadata,
          provider: imported.provider,
          windowDays: this.options.windowDays,
          lastAttemptedSyncAt: now.toISOString(),
          lastSuccessfulSyncAt: now.toISOString(),
          lastError: undefined,
        },
        sourceEvents: imported.sourceEvents,
        compositions: imported.compositions,
        fullCompositionAggregates,
        syncRuns: [
          completedRun,
          ...initialState.syncRuns,
        ].slice(0, 25),
      };

      await this.repository.save(nextState);

      logger.info({
        trigger,
        provider: imported.provider,
        importedEvents: imported.sourceEvents.length,
        parsedCompositions: imported.compositions.length,
        aggregatedFullComps: fullCompositionAggregates.length,
      }, 'valorant sync completed');

      return {
        run: completedRun,
        state: nextState,
      };
    } catch (error) {
      const formattedError = formatSyncError(error);
      const failedRun: ValorantSyncRun = {
        ...run,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: formattedError,
      };
      const failedState: ValorantAppState = {
        ...initialState,
        metadata: {
          ...initialState.metadata,
          provider: this.options.provider,
          windowDays: this.options.windowDays,
          lastAttemptedSyncAt: now.toISOString(),
          lastError: formattedError,
        },
        syncRuns: [
          failedRun,
          ...initialState.syncRuns,
        ].slice(0, 25),
      };

      await this.repository.save(failedState);
      logger.error({ error, trigger, provider: this.options.provider }, 'valorant sync failed');
      throw error;
    }
  }
}
