import { env } from './config/env.js';
import { loadProfiles } from './core/profileLoader.js';
import { ScannerService } from './core/scanner.js';
import { DiscordNotifier } from './integrations/discord/notifier.js';
import { GeizhalsReferenceService } from './integrations/geizhals/referenceService.js';
import { ConsoleNotifier } from './integrations/notifier.js';
import { logger } from './utils/logger.js';
async function bootstrap() {
    const profiles = loadProfiles();
    const notifier = env.NOTIFIER_PROVIDER === 'discord'
        ? new DiscordNotifier()
        : new ConsoleNotifier();
    if ('start' in notifier && typeof notifier.start === 'function') {
        await notifier.start();
    }
    const marketReferences = env.MARKET_REFERENCE_PROVIDER === 'geizhals'
        ? new GeizhalsReferenceService()
        : undefined;
    if (marketReferences) {
        await marketReferences.start(profiles);
    }
    const scanner = new ScannerService(notifier, marketReferences);
    logger.info({
        profiles: profiles.length,
        ebayProvider: env.EBAY_PROVIDER,
        notifierProvider: env.NOTIFIER_PROVIDER,
        marketReferenceProvider: env.MARKET_REFERENCE_PROVIDER,
    }, 'gpu-search started');
    await scanner.runOnce(profiles);
    setInterval(() => {
        scanner.runOnce(profiles).catch(error => logger.error({ error }, 'scan failed'));
    }, env.POLL_INTERVAL_SECONDS * 1000);
}
bootstrap().catch(error => {
    logger.error({ error }, 'fatal startup error');
    process.exit(1);
});
