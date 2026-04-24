import { env } from '../../config/env.js';
import { loadProfiles } from '../../core/profileLoader.js';
import { ScanScheduler } from '../../core/scanScheduler.js';
import { ScannerService } from '../../core/scanner.js';
export class GpuModule {
    marketReferences;
    profiles = loadProfiles();
    scanner;
    scheduler;
    constructor(marketReferences) {
        this.marketReferences = marketReferences;
    }
    attachNotifier(notifier) {
        this.scanner = new ScannerService(notifier, this.marketReferences);
        this.scheduler = new ScanScheduler(this.scanner, this.profiles, env.POLL_INTERVAL_SECONDS * 1000, notifier);
    }
    getProfiles() {
        return this.profiles;
    }
    getNotifierBindings() {
        return {
            onScannerStateReset: async () => this.getScanner().resetState(this.profiles),
            onManualScanRequested: async () => this.getScheduler().triggerManualScan(),
            onForceRescanRequested: async () => this.getScheduler().triggerForceRescan(),
            onDebugScanRequested: async () => this.getScheduler().triggerDebugScan(),
            onScanInfoRequested: async () => this.getScheduler().getScanInfo(),
        };
    }
    async start() {
        await this.getScanner().exportMarketDashboard(this.profiles);
        await this.getScheduler().start();
    }
    stop() {
        this.scheduler?.stop();
    }
    async exportMarketDashboard() {
        return this.getScanner().exportMarketDashboard(this.profiles);
    }
    getScanner() {
        if (!this.scanner) {
            throw new Error('GPU module is not attached to a notifier');
        }
        return this.scanner;
    }
    getScheduler() {
        if (!this.scheduler) {
            throw new Error('GPU module is not attached to a notifier');
        }
        return this.scheduler;
    }
}
