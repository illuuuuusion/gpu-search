import type { ValorantStatusSnapshot, ValorantSyncResult } from '../domain/models.js';
import { ValorantSyncService } from '../ingest/pipeline/syncService.js';
import { FileValorantRepository } from '../storage/fileRepository.js';

interface ValorantSyncSchedulerOptions {
  ingestHourUtc: number;
}

function getNextRunAt(ingestHourUtc: number, now = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(ingestHourUtc, 0, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

export class ValorantSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private runningPromise: Promise<ValorantSyncResult> | null = null;

  constructor(
    private readonly repository: FileValorantRepository,
    private readonly syncService: ValorantSyncService,
    private readonly options: ValorantSyncSchedulerOptions,
  ) {}

  private async scheduleNextRun(): Promise<void> {
    const state = await this.repository.load();
    const nextRunAt = getNextRunAt(this.options.ingestHourUtc);

    state.metadata.nextScheduledSyncAt = nextRunAt.toISOString();
    await this.repository.save(state);

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      void this.runAndReschedule('scheduled');
    }, Math.max(0, nextRunAt.getTime() - Date.now()));
  }

  private async runAndReschedule(trigger: 'startup' | 'scheduled' | 'manual'): Promise<ValorantSyncResult> {
    if (!this.runningPromise) {
      this.runningPromise = this.syncService.runSync(trigger).finally(() => {
        this.runningPromise = null;
      });
    }

    try {
      return await this.runningPromise;
    } finally {
      await this.scheduleNextRun();
    }
  }

  async start(): Promise<void> {
    const state = await this.repository.load();
    if (!state.metadata.lastSuccessfulSyncAt) {
      await this.runAndReschedule('startup');
      return;
    }

    await this.scheduleNextRun();
  }

  async triggerManualSync(): Promise<ValorantSyncResult> {
    if (this.runningPromise) {
      return this.runningPromise;
    }

    return this.runAndReschedule('manual');
  }

  async getStatus(): Promise<ValorantStatusSnapshot> {
    return this.repository.getStatusSnapshot(Boolean(this.runningPromise));
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
