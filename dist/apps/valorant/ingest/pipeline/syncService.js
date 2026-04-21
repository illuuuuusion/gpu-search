import { randomUUID } from 'node:crypto';
import { buildFullCompositionAggregates } from '../../analytics/aggregateBuilder.js';
import { logger } from '../../../../utils/logger.js';
function createRun(trigger, provider) {
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
function formatSyncError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
export class ValorantSyncService {
    repository;
    provider;
    options;
    constructor(repository, provider, options) {
        this.repository = repository;
        this.provider = provider;
        this.options = options;
    }
    async runSync(trigger) {
        const now = new Date();
        const run = createRun(trigger, this.options.provider);
        const initialState = await this.repository.load();
        try {
            const imported = await this.provider.importData({
                now,
                windowDays: this.options.windowDays,
            });
            const fullCompositionAggregates = buildFullCompositionAggregates(imported.compositions);
            const completedRun = {
                ...run,
                finishedAt: new Date().toISOString(),
                status: 'success',
                importedEvents: imported.sourceEvents.length,
                parsedCompositions: imported.compositions.length,
                aggregatedFullComps: fullCompositionAggregates.length,
            };
            const nextState = {
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
        }
        catch (error) {
            const formattedError = formatSyncError(error);
            const failedRun = {
                ...run,
                finishedAt: new Date().toISOString(),
                status: 'failed',
                error: formattedError,
            };
            const failedState = {
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
