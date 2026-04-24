import { logger } from '../utils/logger.js';
const DEBUG_SCAN_MAX_ALERTS = 10;
export class ScanScheduler {
    scanner;
    profiles;
    pollIntervalMs;
    notifier;
    currentScanPromise = null;
    nextAutomaticScanTimer = null;
    nextAutomaticScanAtMs = null;
    constructor(scanner, profiles, pollIntervalMs, notifier) {
        this.scanner = scanner;
        this.profiles = profiles;
        this.pollIntervalMs = pollIntervalMs;
        this.notifier = notifier;
    }
    async start() {
        await this.runScan();
        this.scheduleNextAutomaticScan(Date.now() + this.pollIntervalMs);
    }
    stop() {
        if (this.nextAutomaticScanTimer) {
            clearTimeout(this.nextAutomaticScanTimer);
            this.nextAutomaticScanTimer = null;
        }
        this.nextAutomaticScanAtMs = null;
    }
    async triggerManualScan() {
        return this.triggerScan({ forceRescan: false });
    }
    async triggerForceRescan() {
        return this.triggerScan({ forceRescan: true });
    }
    async triggerDebugScan() {
        return this.triggerScan({ forceRescan: false, debugPricing: true });
    }
    getScanInfo() {
        return {
            nextAutomaticScanAt: this.nextAutomaticScanAtMs
                ? new Date(this.nextAutomaticScanAtMs).toISOString()
                : undefined,
            scanRunning: Boolean(this.currentScanPromise),
        };
    }
    async triggerScan(options) {
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
    scheduleNextAutomaticScan(targetTimeMs) {
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
    async runScheduledScan() {
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
            if (this.notifier?.sendMarketDigest) {
                for (const cadence of ['daily', 'weekly']) {
                    try {
                        const digest = await this.scanner.maybeCreateMarketDigest(this.profiles, cadence);
                        if (!digest) {
                            continue;
                        }
                        await this.notifier.sendMarketDigest(digest);
                        await this.scanner.markMarketDigestSent(cadence, digest.generatedAt);
                    }
                    catch (error) {
                        logger.warn({ error, cadence }, 'failed to send market digest');
                    }
                }
            }
        }
        catch (error) {
            logger.error({ error }, 'scan failed');
        }
        finally {
            this.scheduleNextAutomaticScan(Date.now() + this.pollIntervalMs);
        }
    }
    async runScan(options = { forceRescan: false }) {
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
        }
        finally {
            this.currentScanPromise = null;
        }
    }
}
