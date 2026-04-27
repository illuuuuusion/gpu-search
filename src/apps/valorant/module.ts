import { CompBuilderService } from './bot/compBuilderService.js';
import { env } from '../../config/env.js';
import { ValorantSyncService } from './ingest/pipeline/syncService.js';
import { createValorantCompositionProvider } from './providers/index.js';
import { summarizeMetaChanges } from './query/metaDiff.js';
import { ValorantInsightsService } from './query/insightsService.js';
import { ValorantSyncScheduler } from './scheduler/syncScheduler.js';
import { FileValorantRepository } from './storage/fileRepository.js';
import type {
  CompBuilderAction,
  CompBuilderSnapshot,
  CompBuilderStartOptions,
  ValorantSourceEventStatus,
  ValorantStatusSnapshot,
  ValorantSyncResult,
  ValorantTournamentScope,
} from './domain/models.js';
import type { Notifier } from '../../integrations/notifier.js';
import type { BotCommandBindings } from '../../integrations/botBindings.js';

export class ValorantModule {
  private readonly repository = new FileValorantRepository({
    filePath: env.VALORANT_STORAGE_PATH,
    windowDays: env.VALORANT_WINDOW_DAYS,
    enabled: env.VALORANT_ENABLED,
    provider: env.VALORANT_PROVIDER,
  });

  private readonly provider = createValorantCompositionProvider({
    provider: env.VALORANT_PROVIDER,
    vlrBaseUrl: env.VALORANT_VLR_BASE_URL,
    vlrMinRequestIntervalMs: env.VALORANT_VLR_MIN_REQUEST_INTERVAL_MS,
    vlrMaxEventPages: env.VALORANT_VLR_MAX_EVENT_PAGES,
    vlrMaxMatchTimestampLookups: env.VALORANT_VLR_MAX_MATCH_TIMESTAMP_LOOKUPS,
    vlrRecentMatchDays: env.VALORANT_VLR_RECENT_MATCH_DAYS,
  });

  private readonly syncService = new ValorantSyncService(
    this.repository,
    this.provider,
    {
      windowDays: env.VALORANT_WINDOW_DAYS,
      provider: env.VALORANT_PROVIDER,
      maxRetries: env.VALORANT_SYNC_MAX_RETRIES,
      retryDelayMs: env.VALORANT_SYNC_RETRY_DELAY_MS,
    },
  );

  private readonly insights = new ValorantInsightsService(this.repository);

  private readonly scheduler = new ValorantSyncScheduler(
    this.repository,
    this.syncService,
    {
      ingestHourUtc: env.VALORANT_INGEST_HOUR_UTC,
    },
  );

  private readonly compBuilder = new CompBuilderService(
    this.repository,
    this.insights,
    env.VALORANT_BUILDER_SESSION_TTL_MINUTES,
  );

  async start(): Promise<void> {
    await this.scheduler.start();
  }

  async triggerManualSync(): Promise<ValorantSyncResult> {
    const result = await this.scheduler.triggerManualSync();
    this.insights.primeState(result.state);
    return result;
  }

  async getStatus(): Promise<ValorantStatusSnapshot> {
    return this.scheduler.getStatus();
  }

  async startCompBuilder(userId: string, options: {
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
    presetId?: string;
  }): Promise<CompBuilderSnapshot> {
    const startOptions: CompBuilderStartOptions = {
      filters: await this.insights.resolveFilters(options),
      presetId: options.presetId,
    };

    return this.compBuilder.startSession(userId, startOptions);
  }

  async handleCompBuilderAction(userId: string, sessionId: string, action: CompBuilderAction): Promise<CompBuilderSnapshot | null> {
    return this.compBuilder.applyAction(userId, sessionId, action);
  }

  stop(): void {
    this.scheduler.stop();
  }

  attachNotifier(notifier: Notifier): void {
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

  getNotifierBindings(): Pick<
    BotCommandBindings,
    | 'onValorantStatusRequested'
    | 'onValorantSyncRequested'
    | 'onValorantHelpRequested'
    | 'onValorantTopRequested'
    | 'onValorantAgentRequested'
    | 'onValorantMapMetaRequested'
    | 'onValorantEventsRequested'
    | 'onValorantTeamRequested'
    | 'onValorantCompBuilderStart'
    | 'onValorantCompBuilderAction'
  > {
    return {
      onValorantStatusRequested: async () => this.getStatus(),
      onValorantSyncRequested: async () => this.triggerManualSync(),
      onValorantHelpRequested: async () => this.getHelpText(),
      onValorantTopRequested: async input => this.getTopCompositionsText(input),
      onValorantAgentRequested: async input => this.getAgentText(input),
      onValorantMapMetaRequested: async input => this.getMapMetaText(input),
      onValorantEventsRequested: async input => this.getEventsText(input),
      onValorantTeamRequested: async input => this.getTeamText(input),
      onValorantCompBuilderStart: async (userId, options) => this.startCompBuilder(userId, options),
      onValorantCompBuilderAction: async input => this.handleCompBuilderAction(input.userId, input.sessionId, input.action),
    };
  }

  async getHelpText(): Promise<string> {
    return this.insights.getHelpText();
  }

  async getTopCompositionsText(input: {
    mapQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }): Promise<string> {
    const filters = await this.insights.resolveFilters(input);
    return this.insights.getTopCompositionsText(input.mapQuery, filters);
  }

  async getAgentText(input: {
    agentQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }): Promise<string> {
    const filters = await this.insights.resolveFilters(input);
    return this.insights.getAgentText(input.agentQuery, filters);
  }

  async getMapMetaText(input: {
    mapQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }): Promise<string> {
    const filters = await this.insights.resolveFilters(input);
    return this.insights.getMapMetaText(input.mapQuery, filters);
  }

  async getEventsText(input: {
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  } = {}): Promise<string> {
    const filters = await this.insights.resolveFilters(input);
    return this.insights.getEventsText(filters);
  }

  async getTeamText(input: {
    teamQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
  }): Promise<string> {
    const filters = await this.insights.resolveFilters(input);
    return this.insights.getTeamText(input.teamQuery, filters);
  }
}
