import { GpuModule } from '../domains/gpu/module.js';
import { ValorantModule } from '../domains/valorant/module.js';
import { env } from './env/index.js';
import { DiscordNotifier } from '../integrations/discord/notifier.js';
import { GeizhalsReferenceService } from '../domains/gpu/infrastructure/geizhals/referenceService.js';
import { ConsoleNotifier } from './shared/notifier/index.js';
import { logger } from './shared/logger.js';

async function bootstrap(): Promise<void> {
  const marketReferences = env.MARKET_REFERENCE_PROVIDER === 'geizhals'
    ? new GeizhalsReferenceService()
    : undefined;
  const gpuModule = new GpuModule(marketReferences);
  const valorantModule = env.VALORANT_ENABLED
    ? new ValorantModule()
    : undefined;
  const notifier = env.NOTIFIER_PROVIDER === 'discord'
    ? new DiscordNotifier({
        ...gpuModule.getNotifierBindings(),
        ...(valorantModule ? valorantModule.getNotifierBindings() : {}),
      })
    : new ConsoleNotifier();
  gpuModule.attachNotifier(notifier);

  if ('start' in notifier && typeof notifier.start === 'function') {
    await notifier.start();
  }

  if (marketReferences) {
    await marketReferences.start(gpuModule.getProfiles());
  }

  if (valorantModule) {
    valorantModule.attachNotifier(notifier);
    try {
      await valorantModule.start();
    } catch (error) {
      logger.error({ error }, 'valorant module failed to start; continuing without scheduled valorant sync');
    }
  }

  logger.info({
    profiles: gpuModule.getProfiles().length,
    ebayProvider: env.EBAY_PROVIDER,
    notifierProvider: env.NOTIFIER_PROVIDER,
    marketReferenceProvider: env.MARKET_REFERENCE_PROVIDER,
    valorantEnabled: env.VALORANT_ENABLED,
  }, 'gpu-search started');

  await gpuModule.start();
}

bootstrap().catch(error => {
  logger.error({
    error,
    message: error instanceof Error ? error.message : String(error),
    code: typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined,
  }, 'fatal startup error');
  process.exit(1);
});
