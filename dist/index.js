import { GpuModule } from './apps/gpu/module.js';
import { ValorantModule } from './apps/valorant/module.js';
import { env } from './config/env.js';
import { DiscordNotifier } from './integrations/discord/notifier.js';
import { GeizhalsReferenceService } from './integrations/geizhals/referenceService.js';
import { ConsoleNotifier } from './integrations/notifier.js';
import { logger } from './utils/logger.js';
async function bootstrap() {
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
        }
        catch (error) {
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
    logger.error({ error }, 'fatal startup error');
    process.exit(1);
});
