import './shared/telemetry.js'; // Seiteneffekt: Telemetrie-SDK vor allem anderen starten
import { GpuModule } from '../domains/gpu/module.js';
import { ValorantModule } from '../domains/valorant/module.js';
import { aiAgentConfig, env } from './env/index.js';
import { DiscordNotifier } from '../integrations/discord/notifier.js';
import { DiscordRuntime } from '../integrations/discord/runtime/discordRuntime.js';
import { AiAgentModule } from '../integrations/discord/ai/agentModule.js';
import { ConsoleNotifier } from './shared/notifier/index.js';
import { logger } from './shared/logger.js';

// Letztes Sicherheitsnetz: bewusst KEIN process.exit(), sonst wird die
// gewuenschte Domain-Isolation wieder ausgehebelt (A5).
process.on('unhandledRejection', reason => {
  logger.error({ reason }, 'unhandled rejection');
});

async function bootstrap(): Promise<void> {
  const gpuModule = new GpuModule();
  const valorantModule = env.VALORANT_ENABLED
    ? new ValorantModule()
    : undefined;
  // Ein Gateway-Client fuer alles: Notifier, Commands, Reactions und KI-Agent.
  const discordRuntime = env.NOTIFIER_PROVIDER === 'discord' ? new DiscordRuntime() : undefined;
  const notifier = discordRuntime
    ? new DiscordNotifier({
        ...gpuModule.getNotifierBindings(),
        ...(valorantModule ? valorantModule.getNotifierBindings() : {}),
      }, discordRuntime)
    : new ConsoleNotifier();
  gpuModule.attachNotifier(notifier);

  if ('start' in notifier && typeof notifier.start === 'function') {
    await notifier.start();
  }

  if (discordRuntime && aiAgentConfig) {
    try {
      const aiAgent = new AiAgentModule(discordRuntime, aiAgentConfig);
      await aiAgent.start();
      process.once('SIGTERM', () => void aiAgent.stop());
      process.once('SIGINT', () => void aiAgent.stop());
    } catch (error) {
      // Faellt die KI-Anbindung aus, laufen Scanner, Commands und Reminder weiter.
      logger.error({ error }, 'ai agent module failed to start; continuing without agent channel');
    }
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
    valorantEnabled: env.VALORANT_ENABLED,
  }, 'gpu-search started');

  try {
    await gpuModule.start();
  } catch (error) {
    // Symmetrisch zum Valorant-Block: Fehler isolieren, Prozess weiterlaufen
    // lassen (Discord/Valorant bleiben verfuegbar), nicht process.exit().
    logger.error({ error }, 'gpu module failed to start; continuing without scheduled scans');
  }
}

bootstrap().catch(error => {
  logger.error({
    error,
    message: error instanceof Error ? error.message : String(error),
    code: typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined,
  }, 'fatal startup error');
  process.exit(1);
});
