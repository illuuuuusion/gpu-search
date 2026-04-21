import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
function createEmptyMetadata(windowDays, provider) {
    return {
        provider,
        windowDays,
    };
}
function createEmptyState(windowDays, provider) {
    return {
        version: 2,
        metadata: createEmptyMetadata(windowDays, provider),
        sourceEvents: [],
        compositions: [],
        fullCompositionAggregates: [],
        syncRuns: [],
    };
}
function normalizeSyncRuns(syncRuns) {
    if (!Array.isArray(syncRuns)) {
        return [];
    }
    return syncRuns.filter((run) => Boolean(run
        && typeof run === 'object'
        && 'id' in run
        && 'status' in run
        && 'trigger' in run));
}
function normalizeSourceEvents(sourceEvents) {
    if (!Array.isArray(sourceEvents)) {
        return [];
    }
    return sourceEvents.filter((event) => Boolean(event
        && typeof event === 'object'
        && 'id' in event
        && 'title' in event
        && 'scope' in event));
}
function migrateLegacyState(legacyState, windowDays, provider) {
    return {
        version: 2,
        metadata: {
            ...createEmptyMetadata(windowDays, provider),
            ...legacyState.metadata,
            provider,
            windowDays: legacyState.metadata?.windowDays ?? windowDays,
        },
        sourceEvents: [],
        compositions: legacyState.compositions ?? [],
        fullCompositionAggregates: legacyState.fullCompositionAggregates ?? [],
        syncRuns: [],
    };
}
export class FileValorantRepository {
    options;
    constructor(options) {
        this.options = options;
    }
    async load() {
        try {
            const raw = await readFile(this.options.filePath, 'utf8');
            const parsed = JSON.parse(raw);
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
                compositions: parsed.compositions ?? [],
                fullCompositionAggregates: parsed.fullCompositionAggregates ?? [],
                syncRuns: normalizeSyncRuns(parsed.syncRuns),
            };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return createEmptyState(this.options.windowDays, this.options.provider);
            }
            throw error;
        }
    }
    async save(state) {
        await mkdir(dirname(this.options.filePath), { recursive: true });
        await writeFile(this.options.filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    }
    async getStatusSnapshot(syncRunning) {
        const state = await this.load();
        return {
            enabled: this.options.enabled,
            syncRunning,
            provider: state.metadata.provider,
            nextScheduledSyncAt: state.metadata.nextScheduledSyncAt,
            lastAttemptedSyncAt: state.metadata.lastAttemptedSyncAt,
            lastSuccessfulSyncAt: state.metadata.lastSuccessfulSyncAt,
            lastError: state.metadata.lastError,
            importedEvents: state.sourceEvents.length,
            parsedCompositions: state.compositions.length,
            aggregatedFullComps: state.fullCompositionAggregates.length,
        };
    }
}
