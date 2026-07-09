import { env } from '../../app/env/index.js';
import { loadProfiles } from './domain/profileLoader.js';
import { ScanScheduler, type ManualScanTriggerResult } from './application/scanScheduler.js';
import { ScannerService } from './application/scanner.js';
import type { MarketDashboardSnapshot, GpuProfile } from './domain/models.js';
import type { Notifier } from '../../app/shared/notifier/index.js';
import type { BotCommandBindings } from '../../app/shared/botBindings.js';
import { logger } from '../../app/shared/logger.js';

export class GpuModule {
  private readonly profiles = loadProfiles();
  private scanner?: ScannerService;
  private scheduler?: ScanScheduler;
  private availabilityRefreshTimer: NodeJS.Timeout | null = null;

  attachNotifier(notifier: Notifier): void {
    this.scanner = new ScannerService(notifier);
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
    'onScannerStateReset' | 'onManualScanRequested' | 'onForceRescanRequested' | 'onDebugScanRequested'
    | 'onScanInfoRequested' | 'onReactionRouteRequested' | 'onRegisterReactionRoute'
    | 'onAcceptanceFeedback' | 'onAcceptanceReset'
  > {
    return {
      onScannerStateReset: async () => this.getScanner().resetState(this.profiles),
      onManualScanRequested: async (): Promise<ManualScanTriggerResult> => this.getScheduler().triggerManualScan(),
      onForceRescanRequested: async (): Promise<ManualScanTriggerResult> => this.getScheduler().triggerForceRescan(),
      onDebugScanRequested: async (): Promise<ManualScanTriggerResult> => this.getScheduler().triggerDebugScan(),
      onScanInfoRequested: async () => this.getScheduler().getScanInfo(),
      onReactionRouteRequested: async messageId => this.getScanner().getReactionRoute(messageId),
      onRegisterReactionRoute: async (messageId, route) => this.getScanner().registerReactionRoute(messageId, route),
      onAcceptanceFeedback: async ({ profileName, direction }) =>
        this.getScanner().applyAcceptanceReaction(profileName, direction),
      onAcceptanceReset: async profileName => this.getScanner().resetAcceptanceBias(profileName),
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
      clearTimeout(this.availabilityRefreshTimer);
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
      clearTimeout(this.availabilityRefreshTimer);
    }

    const intervalMs = Math.max(1, env.SCANNER_AVAILABILITY_RECHECK_MINUTES) * 60 * 1000;

    const runAndReschedule = async () => {
      const start = Date.now();
      try {
        const summary = await this.getScanner().refreshAvailability();
        const durationMs = Date.now() - start;
        if (summary.checkedListings > 0 || summary.removedListings > 0 || summary.failedChecks > 0) {
          logger.info({ durationMs, ...summary }, 'availability refresh completed');
          await this.getScanner().exportMarketDashboard(this.profiles).catch(err =>
            logger.warn({ err }, 'Failed to export market dashboard after availability refresh'),
          );
        }
      } catch (error) {
        logger.warn({ error }, 'availability refresh loop failed');
      } finally {
        this.availabilityRefreshTimer = setTimeout(runAndReschedule, intervalMs);
      }
    };

    this.availabilityRefreshTimer = setTimeout(runAndReschedule, intervalMs);
  }
}
