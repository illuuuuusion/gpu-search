import { CompBuilderService } from './bot/compBuilderService.js';
import { env } from '../../config/env.js';
import { ValorantSyncService } from './ingest/pipeline/syncService.js';
import { createValorantCompositionProvider } from './providers/index.js';
import { ValorantSyncScheduler } from './scheduler/syncScheduler.js';
import { FileValorantRepository } from './storage/fileRepository.js';
import type { CompBuilderAction, CompBuilderSnapshot, ValorantStatusSnapshot, ValorantSyncResult } from './domain/models.js';

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
  });

  private readonly syncService = new ValorantSyncService(
    this.repository,
    this.provider,
    {
      windowDays: env.VALORANT_WINDOW_DAYS,
      provider: env.VALORANT_PROVIDER,
    },
  );

  private readonly scheduler = new ValorantSyncScheduler(
    this.repository,
    this.syncService,
    {
      ingestHourUtc: env.VALORANT_INGEST_HOUR_UTC,
    },
  );

  private readonly compBuilder = new CompBuilderService(
    this.repository,
    env.VALORANT_BUILDER_SESSION_TTL_MINUTES,
  );

  async start(): Promise<void> {
    await this.scheduler.start();
  }

  async triggerManualSync(): Promise<ValorantSyncResult> {
    return this.scheduler.triggerManualSync();
  }

  async getStatus(): Promise<ValorantStatusSnapshot> {
    return this.scheduler.getStatus();
  }

  async startCompBuilder(userId: string): Promise<CompBuilderSnapshot> {
    return this.compBuilder.startSession(userId);
  }

  async handleCompBuilderAction(userId: string, sessionId: string, action: CompBuilderAction): Promise<CompBuilderSnapshot | null> {
    return this.compBuilder.applyAction(userId, sessionId, action);
  }

  stop(): void {
    this.scheduler.stop();
  }
}
