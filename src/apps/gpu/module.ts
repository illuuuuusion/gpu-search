import { env } from '../../config/env.js';
import { loadProfiles } from '../../core/profileLoader.js';
import { ScanScheduler, type ManualScanTriggerResult } from '../../core/scanScheduler.js';
import { ScannerService } from '../../core/scanner.js';
import type { MarketDashboardSnapshot, GpuProfile } from '../../types/domain.js';
import type { MarketReferenceReader } from '../../integrations/geizhals/referenceService.js';
import type { Notifier } from '../../integrations/notifier.js';
import type { BotCommandBindings } from '../../integrations/botBindings.js';
import { logger } from '../../utils/logger.js';

export class GpuModule {
  private readonly profiles = loadProfiles();
  private scanner?: ScannerService;
  private scheduler?: ScanScheduler;
  private availabilityRefreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly marketReferences?: MarketReferenceReader,
  ) {}

  attachNotifier(notifier: Notifier): void {
    this.scanner = new ScannerService(notifier, this.marketReferences);
    this.scheduler = new ScanScheduler(
      this.scanner,
      this.profiles,
      env.POLL_INTERVAL_SECONDS * 1000,
      notifier,
    );
  }

  getProfiles(): GpuProfile[] {
    return this.profiles;
  }

  getNotifierBindings(): Pick<
    BotCommandBindings,
    'onScannerStateReset' | 'onManualScanRequested' | 'onForceRescanRequested' | 'onDebugScanRequested' | 'onScanInfoRequested'
  > {
    return {
      onScannerStateReset: async () => this.getScanner().resetState(this.profiles),
      onManualScanRequested: async (): Promise<ManualScanTriggerResult> => this.getScheduler().triggerManualScan(),
      onForceRescanRequested: async (): Promise<ManualScanTriggerResult> => this.getScheduler().triggerForceRescan(),
      onDebugScanRequested: async (): Promise<ManualScanTriggerResult> => this.getScheduler().triggerDebugScan(),
      onScanInfoRequested: async () => this.getScheduler().getScanInfo(),
    };
  }

  async start(): Promise<void> {
    await this.getScanner().exportMarketDashboard(this.profiles);
    this.startAvailabilityRefreshLoop();
    await this.getScheduler().start();
  }

  stop(): void {
    this.scheduler?.stop();
    if (this.availabilityRefreshTimer) {
      clearInterval(this.availabilityRefreshTimer);
      this.availabilityRefreshTimer = null;
    }
  }

  async exportMarketDashboard(): Promise<MarketDashboardSnapshot> {
    return this.getScanner().exportMarketDashboard(this.profiles);
  }

  private getScanner(): ScannerService {
    if (!this.scanner) {
      throw new Error('GPU module is not attached to a notifier');
    }

    return this.scanner;
  }

  private getScheduler(): ScanScheduler {
    if (!this.scheduler) {
      throw new Error('GPU module is not attached to a notifier');
    }

    return this.scheduler;
  }

  private startAvailabilityRefreshLoop(): void {
    if (!env.SCANNER_AVAILABILITY_REFRESH_ENABLED) {
      return;
    }

    if (this.availabilityRefreshTimer) {
      clearInterval(this.availabilityRefreshTimer);
    }

    const intervalMs = Math.max(1, env.SCANNER_AVAILABILITY_RECHECK_MINUTES) * 60 * 1000;
    this.availabilityRefreshTimer = setInterval(() => {
      void this.getScanner().refreshAvailability()
        .then(summary => {
          if (summary.checkedListings > 0 || summary.removedListings > 0 || summary.failedChecks > 0) {
            return this.getScanner().exportMarketDashboard(this.profiles);
          }

          return undefined;
        })
        .catch(error => {
          logger.warn({ error }, 'availability refresh loop failed');
        });
    }, intervalMs);
  }
}
