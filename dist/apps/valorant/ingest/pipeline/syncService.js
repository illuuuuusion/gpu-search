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
function buildHealthSnapshot(previousState, nextImportedEvents, nextParsedCompositions, warnings) {
    const reasons = [];
    const previousImportedEvents = previousState.sourceEvents.length;
    const previousParsedCompositions = previousState.compositions.length;
    if (previousImportedEvents >= 4
        && nextImportedEvents < Math.max(2, Math.floor(previousImportedEvents * 0.7))) {
        reasons.push(`Importierte Events stark gefallen: ${previousImportedEvents} -> ${nextImportedEvents}`);
    }
    if (previousParsedCompositions >= 100
        && nextParsedCompositions < Math.max(50, Math.floor(previousParsedCompositions * 0.7))) {
        reasons.push(`Geparste Comps stark gefallen: ${previousParsedCompositions} -> ${nextParsedCompositions}`);
    }
    reasons.push(...warnings.slice(0, 5));
    return {
        healthState: reasons.length > 0 ? 'degraded' : 'healthy',
        healthReasons: reasons,
    };
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
                existingMatchReferences: initialState.matchReferences,
            });
            const fullCompositionAggregates = buildFullCompositionAggregates(imported.compositions);
            const health = buildHealthSnapshot(initialState, imported.sourceEvents.length, imported.compositions.length, imported.warnings);
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
                    healthState: health.healthState,
                    healthReasons: health.healthReasons,
                    lastError: undefined,
                },
                sourceEvents: imported.sourceEvents,
                matchReferences: imported.matchReferences,
                compositions: imported.compositions,
                fullCompositionAggregates,
                builderPresets: initialState.builderPresets,
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
                healthState: health.healthState,
                healthReasons: health.healthReasons,
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
                    healthState: initialState.metadata.healthState ?? 'healthy',
                    healthReasons: initialState.metadata.healthReasons ?? [],
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
