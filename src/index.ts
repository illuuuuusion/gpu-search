import { env } from './config/env.js';
import { loadProfiles } from './core/profileLoader.js';
import { ScanScheduler } from './core/scanScheduler.js';
import { ScannerService } from './core/scanner.js';
import { DiscordNotifier } from './integrations/discord/notifier.js';
import { GeizhalsReferenceService } from './integrations/geizhals/referenceService.js';
import { ConsoleNotifier } from './integrations/notifier.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const profiles = loadProfiles();
  const marketReferences = env.MARKET_REFERENCE_PROVIDER === 'geizhals'
    ? new GeizhalsReferenceService()
    : undefined;
  let scanner: ScannerService;
  let scheduler: ScanScheduler;
  const notifier = env.NOTIFIER_PROVIDER === 'discord'
    ? new DiscordNotifier({
        onScannerStateReset: async () => scanner.resetState(),
        onManualScanRequested: async () => scheduler.triggerManualScan(),
        onForceRescanRequested: async () => scheduler.triggerForceRescan(),
        onDebugScanRequested: async () => scheduler.triggerDebugScan(),
        onScanInfoRequested: async () => scheduler.getScanInfo(),
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

  logger.info({
    profiles: profiles.length,
    ebayProvider: env.EBAY_PROVIDER,
    notifierProvider: env.NOTIFIER_PROVIDER,
    marketReferenceProvider: env.MARKET_REFERENCE_PROVIDER,
  }, 'gpu-search started');

  await scheduler.start();
}

bootstrap().catch(error => {
  logger.error({ error }, 'fatal startup error');
  process.exit(1);
});
