import { ValorantModule } from './apps/valorant/module.js';
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
  const valorantModule = env.VALORANT_ENABLED
    ? new ValorantModule()
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
        ...(valorantModule
          ? {
              onValorantStatusRequested: async () => valorantModule.getStatus(),
              onValorantSyncRequested: async () => valorantModule.triggerManualSync(),
              onValorantHelpRequested: async () => valorantModule.getHelpText(),
              onValorantTopRequested: async (input: {
                mapQuery: string;
                scope?: import('./apps/valorant/domain/models.js').ValorantTournamentScope;
                eventQuery?: string;
                eventStatus?: import('./apps/valorant/domain/models.js').ValorantSourceEventStatus;
                days?: number;
                teamQuery?: string;
              }) => valorantModule.getTopCompositionsText(input),
              onValorantAgentRequested: async (input: {
                agentQuery: string;
                scope?: import('./apps/valorant/domain/models.js').ValorantTournamentScope;
                eventQuery?: string;
                eventStatus?: import('./apps/valorant/domain/models.js').ValorantSourceEventStatus;
                days?: number;
                teamQuery?: string;
              }) => valorantModule.getAgentText(input),
              onValorantMapMetaRequested: async (input: {
                mapQuery: string;
                scope?: import('./apps/valorant/domain/models.js').ValorantTournamentScope;
                eventQuery?: string;
                eventStatus?: import('./apps/valorant/domain/models.js').ValorantSourceEventStatus;
                days?: number;
                teamQuery?: string;
              }) => valorantModule.getMapMetaText(input),
              onValorantEventsRequested: async (input: {
                scope?: import('./apps/valorant/domain/models.js').ValorantTournamentScope;
                eventQuery?: string;
                eventStatus?: import('./apps/valorant/domain/models.js').ValorantSourceEventStatus;
                days?: number;
                teamQuery?: string;
              }) => valorantModule.getEventsText(input),
              onValorantTeamRequested: async (input: {
                teamQuery: string;
                scope?: import('./apps/valorant/domain/models.js').ValorantTournamentScope;
                eventQuery?: string;
                eventStatus?: import('./apps/valorant/domain/models.js').ValorantSourceEventStatus;
                days?: number;
              }) => valorantModule.getTeamText(input),
              onValorantCompBuilderStart: async (
                userId: string,
                options: {
                  scope?: import('./apps/valorant/domain/models.js').ValorantTournamentScope;
                  eventQuery?: string;
                  eventStatus?: import('./apps/valorant/domain/models.js').ValorantSourceEventStatus;
                  days?: number;
                  teamQuery?: string;
                },
              ) => valorantModule.startCompBuilder(userId, options),
              onValorantCompBuilderAction: async (input: { userId: string; sessionId: string; action: import('./apps/valorant/domain/models.js').CompBuilderAction }) =>
                valorantModule.handleCompBuilderAction(input.userId, input.sessionId, input.action),
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
    valorantModule.attachNotifier(notifier);
    try {
      await valorantModule.start();
    } catch (error) {
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
