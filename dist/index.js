import { ValorantModule } from './apps/valorant/module.js';
import { env } from './config/env.js';
import { loadProfiles } from './core/profileLoader.js';
import { ScanScheduler } from './core/scanScheduler.js';
import { ScannerService } from './core/scanner.js';
import { DiscordNotifier } from './integrations/discord/notifier.js';
import { GeizhalsReferenceService } from './integrations/geizhals/referenceService.js';
import { ConsoleNotifier } from './integrations/notifier.js';
import { logger } from './utils/logger.js';
async function bootstrap() {
    const profiles = loadProfiles();
    const marketReferences = env.MARKET_REFERENCE_PROVIDER === 'geizhals'
        ? new GeizhalsReferenceService()
        : undefined;
    const valorantModule = env.VALORANT_ENABLED
        ? new ValorantModule()
        : undefined;
    let scanner;
    let scheduler;
    const notifier = env.NOTIFIER_PROVIDER === 'discord'
        ? new DiscordNotifier({
            onScannerStateReset: async () => scanner.resetState(),
            onManualScanRequested: async () => scheduler.triggerManualScan(),
            onForceRescanRequested: async () => scheduler.triggerForceRescan(),
            onDebugScanRequested: async () => scheduler.triggerDebugScan(),
            onScanInfoRequested: async () => scheduler.getScanInfo(),
            ...(valorantModule
                ? {
                    onValorantStatusRequested: async () => valorantModule.getStatus(),
                    onValorantSyncRequested: async () => valorantModule.triggerManualSync(),
                    onValorantCompBuilderStart: async (userId) => valorantModule.startCompBuilder(userId),
                    onValorantCompBuilderAction: async (input) => valorantModule.handleCompBuilderAction(input.userId, input.sessionId, input.action),
                }
                : {}),
        })
        : new ConsoleNotifier();
    scanner = new ScannerService(notifier, marketReferences);
    scheduler = new ScanScheduler(scanner, profiles, env.POLL_INTERVAL_SECONDS * 1000, notifier);
    if ('start' in notifier && typeof notifier.start === 'function') {
        await notifier.start();
    }
    if (marketReferences) {
        await marketReferences.start(profiles);
    }
    if (valorantModule) {
        try {
            await valorantModule.start();
        }
        catch (error) {
            logger.error({ error }, 'valorant module failed to start; continuing without scheduled valorant sync');
        }
    }
    logger.info({
        profiles: profiles.length,
        ebayProvider: env.EBAY_PROVIDER,
        notifierProvider: env.NOTIFIER_PROVIDER,
        marketReferenceProvider: env.MARKET_REFERENCE_PROVIDER,
        valorantEnabled: env.VALORANT_ENABLED,
    }, 'gpu-search started');
    await scheduler.start();
}
bootstrap().catch(error => {
    logger.error({ error }, 'fatal startup error');
    process.exit(1);
});
