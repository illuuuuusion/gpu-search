import { env } from './config/env.js';
import { loadProfiles } from './core/profileLoader.js';
import { ScannerService } from './core/scanner.js';
import { ConsoleNotifier, MatrixNotifier } from './integrations/matrix/notifier.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const profiles = loadProfiles();
  const notifier = env.NOTIFIER_PROVIDER === 'matrix'
    ? new MatrixNotifier()
    : new ConsoleNotifier();

  if ('start' in notifier && typeof notifier.start === 'function') {
    await notifier.start();
  }

  const scanner = new ScannerService(notifier);
  logger.info({
    profiles: profiles.length,
    ebayProvider: env.EBAY_PROVIDER,
    notifierProvider: env.NOTIFIER_PROVIDER,
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
