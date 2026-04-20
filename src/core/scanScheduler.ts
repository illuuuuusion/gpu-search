import type { Notifier } from '../integrations/notifier.js';
import type { GpuProfile } from '../types/domain.js';
import { logger } from '../utils/logger.js';
import { ScannerService, type ScannerRunSummary } from './scanner.js';

const DEBUG_SCAN_MAX_ALERTS = 10;

export interface ManualScanTriggerResult {
  status: 'completed' | 'queued_after_running_scan';
  nextAutomaticScanAt: string;
  summary: ScannerRunSummary;
}

export class ScanScheduler {
  private currentScanPromise: Promise<ScannerRunSummary> | null = null;
  private nextAutomaticScanTimer: NodeJS.Timeout | null = null;
  private nextAutomaticScanAtMs: number | null = null;

  constructor(
    private readonly scanner: ScannerService,
    private readonly profiles: GpuProfile[],
    private readonly pollIntervalMs: number,
    private readonly notifier?: Notifier,
  ) {}

  async start(): Promise<void> {
    await this.runScan();
    this.scheduleNextAutomaticScan(Date.now() + this.pollIntervalMs);
  }

  async triggerManualScan(): Promise<ManualScanTriggerResult> {
    return this.triggerScan({ forceRescan: false });
  }

  async triggerForceRescan(): Promise<ManualScanTriggerResult> {
    return this.triggerScan({ forceRescan: true });
  }

  async triggerDebugScan(): Promise<ManualScanTriggerResult> {
    return this.triggerScan({ forceRescan: false, debugPricing: true });
  }

  getScanInfo(): { nextAutomaticScanAt?: string; scanRunning: boolean } {
    return {
      nextAutomaticScanAt: this.nextAutomaticScanAtMs
        ? new Date(this.nextAutomaticScanAtMs).toISOString()
        : undefined,
      scanRunning: Boolean(this.currentScanPromise),
    };
  }

  private async triggerScan(options: { forceRescan: boolean; debugPricing?: boolean }): Promise<ManualScanTriggerResult> {
    const requestedAtMs = Date.now();
    const nextAutomaticScanAtMs = requestedAtMs + this.pollIntervalMs;
    this.scheduleNextAutomaticScan(nextAutomaticScanAtMs);
    const hadRunningScan = Boolean(this.currentScanPromise);

    if (this.currentScanPromise) {
      await this.currentScanPromise;
    }

    const summary = await this.runScan(options);

    return {
      status: hadRunningScan ? 'queued_after_running_scan' : 'completed',
      nextAutomaticScanAt: new Date(nextAutomaticScanAtMs).toISOString(),
      summary,
    };
  }

  private scheduleNextAutomaticScan(targetTimeMs: number): void {
    if (this.nextAutomaticScanTimer) {
      clearTimeout(this.nextAutomaticScanTimer);
    }

    this.nextAutomaticScanAtMs = targetTimeMs;
    const delayMs = Math.max(0, targetTimeMs - Date.now());
    this.nextAutomaticScanTimer = setTimeout(() => {
      this.nextAutomaticScanTimer = null;
      void this.runScheduledScan();
    }, delayMs);
  }

  private async runScheduledScan(): Promise<void> {
    const nextAutomaticScanAt = new Date(Date.now() + this.pollIntervalMs).toISOString();

    try {
      if (this.notifier?.sendScanStatus) {
        await this.notifier.sendScanStatus({
          phase: 'started',
          trigger: 'automatic',
          nextAutomaticScanAt,
        }).catch(error => {
          logger.warn({ error }, 'failed to send automatic scan start status');
        });
      }
      const summary = await this.runScan({ forceRescan: false });
      if (this.notifier?.sendScanStatus) {
        await this.notifier.sendScanStatus({
          phase: 'finished',
          trigger: 'automatic',
          nextAutomaticScanAt,
          summary,
        }).catch(error => {
          logger.warn({ error }, 'failed to send automatic scan finished status');
        });
      }
    } catch (error) {
      logger.error({ error }, 'scan failed');
    } finally {
      this.scheduleNextAutomaticScan(Date.now() + this.pollIntervalMs);
    }
  }

  private async runScan(options: { forceRescan: boolean; debugPricing?: boolean } = { forceRescan: false }): Promise<ScannerRunSummary> {
    if (this.currentScanPromise) {
      return this.currentScanPromise;
    }

    const scanPromise = this.scanner.runOnce(this.profiles, options.debugPricing
      ? {
          ignoreSeen: true,
          ignoreBucketWatermarks: true,
          persistState: false,
          evaluationMode: 'debug',
          maxAlerts: DEBUG_SCAN_MAX_ALERTS,
          runAvailabilityCleanup: false,
        }
      : options.forceRescan
        ? {
            ignoreSeen: true,
            ignoreBucketWatermarks: true,
          }
        : undefined);
    this.currentScanPromise = scanPromise;

    try {
      return await scanPromise;
    } finally {
      this.currentScanPromise = null;
    }
  }
}
