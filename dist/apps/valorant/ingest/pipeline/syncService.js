import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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
function getErrorCode(error) {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    return 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
}
function getErrorStatus(error) {
    if (!error || typeof error !== 'object' || !('response' in error)) {
        return undefined;
    }
    const response = error.response;
    if (!response || typeof response !== 'object' || !('status' in response)) {
        return undefined;
    }
    return typeof response.status === 'number'
        ? response.status
        : undefined;
}
function isRetryableSyncError(error) {
    const code = getErrorCode(error);
    if (code && new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNREFUSED']).has(code)) {
        return true;
    }
    const status = getErrorStatus(error);
    return status !== undefined && (status === 429 || status >= 500);
}
function buildFailureReason(error) {
    const code = getErrorCode(error);
    const status = getErrorStatus(error);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return 'VLR aktuell per DNS/Netzwerk nicht erreichbar. Bestehende VALORANT-Daten bleiben aktiv.';
    }
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ECONNREFUSED') {
        return 'VLR antwortet aktuell nicht stabil. Bestehende VALORANT-Daten bleiben aktiv.';
    }
    if (status === 429) {
        return 'VLR limitiert die Anfragen aktuell. Bestehende VALORANT-Daten bleiben aktiv.';
    }
    if (status !== undefined && status >= 500) {
        return `VLR liefert aktuell einen Serverfehler (${status}). Bestehende VALORANT-Daten bleiben aktiv.`;
    }
    return 'VALORANT-Sync fehlgeschlagen. Bestehende Daten bleiben aktiv.';
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
    async importWithRetries(initialState, now) {
        const maxAttempts = Math.max(1, this.options.maxRetries + 1);
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                return await this.provider.importData({
                    now,
                    windowDays: this.options.windowDays,
                    existingMatchReferences: initialState.matchReferences,
                });
            }
            catch (error) {
                lastError = error;
                const retryable = isRetryableSyncError(error);
                const willRetry = retryable && attempt < maxAttempts;
                if (!willRetry) {
                    break;
                }
                logger.warn({
                    attempt,
                    maxAttempts,
                    retryDelayMs: this.options.retryDelayMs * attempt,
                    provider: this.options.provider,
                    errorCode: getErrorCode(error),
                    errorStatus: getErrorStatus(error),
                    errorMessage: formatSyncError(error),
                }, 'valorant sync attempt failed, retrying');
                await delay(this.options.retryDelayMs * attempt);
            }
        }
        throw lastError;
    }
    async runSync(trigger) {
        const now = new Date();
        const run = createRun(trigger, this.options.provider);
        const initialState = await this.repository.load();
        try {
            const imported = await this.importWithRetries(initialState, now);
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
            const retryable = isRetryableSyncError(error);
            const failureReason = buildFailureReason(error);
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
                    healthState: 'degraded',
                    healthReasons: [failureReason, ...(initialState.metadata.healthReasons ?? [])]
                        .filter((reason, index, reasons) => reasons.indexOf(reason) === index)
                        .slice(0, 5),
                    lastError: formattedError,
                },
                syncRuns: [
                    failedRun,
                    ...initialState.syncRuns,
                ].slice(0, 25),
            };
            await this.repository.save(failedState);
            logger.error({
                error,
                trigger,
                provider: this.options.provider,
                retryable,
                errorCode: getErrorCode(error),
                errorStatus: getErrorStatus(error),
            }, 'valorant sync failed');
            if (retryable) {
                return {
                    run: failedRun,
                    state: failedState,
                };
            }
            throw error;
        }
    }
}
