import { CompBuilderService } from './bot/compBuilderService.js';
import { env } from '../../config/env.js';
import { ValorantSyncService } from './ingest/pipeline/syncService.js';
import { createValorantCompositionProvider } from './providers/index.js';
import { summarizeMetaChanges } from './query/metaDiff.js';
import { ValorantInsightsService } from './query/insightsService.js';
import { ValorantSyncScheduler } from './scheduler/syncScheduler.js';
import { FileValorantRepository } from './storage/fileRepository.js';
export class ValorantModule {
    repository = new FileValorantRepository({
        filePath: env.VALORANT_STORAGE_PATH,
        windowDays: env.VALORANT_WINDOW_DAYS,
        enabled: env.VALORANT_ENABLED,
        provider: env.VALORANT_PROVIDER,
    });
    provider = createValorantCompositionProvider({
        provider: env.VALORANT_PROVIDER,
        vlrBaseUrl: env.VALORANT_VLR_BASE_URL,
        vlrMinRequestIntervalMs: env.VALORANT_VLR_MIN_REQUEST_INTERVAL_MS,
        vlrMaxEventPages: env.VALORANT_VLR_MAX_EVENT_PAGES,
        vlrMaxMatchTimestampLookups: env.VALORANT_VLR_MAX_MATCH_TIMESTAMP_LOOKUPS,
        vlrRecentMatchDays: env.VALORANT_VLR_RECENT_MATCH_DAYS,
    });
    syncService = new ValorantSyncService(this.repository, this.provider, {
        windowDays: env.VALORANT_WINDOW_DAYS,
        provider: env.VALORANT_PROVIDER,
    });
    insights = new ValorantInsightsService(this.repository);
    scheduler = new ValorantSyncScheduler(this.repository, this.syncService, {
        ingestHourUtc: env.VALORANT_INGEST_HOUR_UTC,
    });
    compBuilder = new CompBuilderService(this.repository, this.insights, env.VALORANT_BUILDER_SESSION_TTL_MINUTES);
    async start() {
        await this.scheduler.start();
    }
    async triggerManualSync() {
        const result = await this.scheduler.triggerManualSync();
        this.insights.primeState(result.state);
        return result;
    }
    async getStatus() {
        return this.scheduler.getStatus();
    }
    async startCompBuilder(userId, options) {
        const startOptions = {
            filters: await this.insights.resolveFilters(options),
            presetId: options.presetId,
        };
        return this.compBuilder.startSession(userId, startOptions);
    }
    async handleCompBuilderAction(userId, sessionId, action) {
        return this.compBuilder.applyAction(userId, sessionId, action);
    }
    stop() {
        this.scheduler.stop();
    }
    attachNotifier(notifier) {
        this.scheduler.setOnSyncCompleted(async (result, previousState) => {
            this.insights.primeState(result.state);
            if (result.run.trigger !== 'scheduled' || !notifier.sendValorantSyncStatus) {
                return;
            }
            await notifier.sendValorantSyncStatus({
                trigger: result.run.trigger,
                provider: result.run.provider,
                healthState: result.state.metadata.healthState ?? 'healthy',
                healthReasons: result.state.metadata.healthReasons ?? [],
                importedEvents: result.run.importedEvents,
                parsedCompositions: result.run.parsedCompositions,
                aggregatedFullComps: result.run.aggregatedFullComps,
                lastSuccessfulSyncAt: result.state.metadata.lastSuccessfulSyncAt,
                metaChanges: summarizeMetaChanges(previousState, result.state),
            });
        });
    }
    getNotifierBindings() {
        return {
            onValorantStatusRequested: async () => this.getStatus(),
            onValorantSyncRequested: async () => this.triggerManualSync(),
            onValorantHelpRequested: async () => this.getHelpText(),
            onValorantTopRequested: async (input) => this.getTopCompositionsText(input),
            onValorantAgentRequested: async (input) => this.getAgentText(input),
            onValorantMapMetaRequested: async (input) => this.getMapMetaText(input),
            onValorantEventsRequested: async (input) => this.getEventsText(input),
            onValorantTeamRequested: async (input) => this.getTeamText(input),
            onValorantCompBuilderStart: async (userId, options) => this.startCompBuilder(userId, options),
            onValorantCompBuilderAction: async (input) => this.handleCompBuilderAction(input.userId, input.sessionId, input.action),
        };
    }
    async getHelpText() {
        return this.insights.getHelpText();
    }
    async getTopCompositionsText(input) {
        const filters = await this.insights.resolveFilters(input);
        return this.insights.getTopCompositionsText(input.mapQuery, filters);
    }
    async getAgentText(input) {
        const filters = await this.insights.resolveFilters(input);
        return this.insights.getAgentText(input.agentQuery, filters);
    }
    async getMapMetaText(input) {
        const filters = await this.insights.resolveFilters(input);
        return this.insights.getMapMetaText(input.mapQuery, filters);
    }
    async getEventsText(input = {}) {
        const filters = await this.insights.resolveFilters(input);
        return this.insights.getEventsText(filters);
    }
    async getTeamText(input) {
        const filters = await this.insights.resolveFilters(input);
        return this.insights.getTeamText(input.teamQuery, filters);
    }
}
