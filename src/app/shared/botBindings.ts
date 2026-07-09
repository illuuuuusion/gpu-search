import type {
  CompBuilderAction,
  CompBuilderSnapshot,
  ValorantCompositionProvider,
  ValorantSourceEventStatus,
  ValorantTournamentScope,
} from '../../domains/valorant/domain/models.js';
import type { ScanStatusSummary } from './notifier/index.js';

export interface ScanCommandResult {
  status: 'completed' | 'queued_after_running_scan';
  nextAutomaticScanAt: string;
  summary: ScanStatusSummary;
}

export interface ReactionRoute {
  type: 'acceptance-feedback' | 'acceptance-reset' | string;
  profileName?: string;
  listingId?: string;
}

export interface AcceptanceFeedbackResult {
  adjusted: boolean;
  profileName: string;
  previousBias: number;
  bias: number;
}

export interface BotCommandBindings {
  onScannerStateReset?: () => Promise<{ seenCount: number; observationCount: number }>;
  onManualScanRequested?: () => Promise<ScanCommandResult>;
  onForceRescanRequested?: () => Promise<ScanCommandResult>;
  onDebugScanRequested?: () => Promise<ScanCommandResult>;
  onScanInfoRequested?: () => Promise<{ nextAutomaticScanAt?: string; scanRunning: boolean }>;
  // Reaction-Feedback (A7/B5). Persistierte messageId -> Route-Zuordnung + Bias-Anpassung.
  onReactionRouteRequested?: (messageId: string) => Promise<ReactionRoute | null>;
  onRegisterReactionRoute?: (messageId: string, route: ReactionRoute & { channelId?: string }) => Promise<void>;
  onAcceptanceFeedback?: (input: { profileName: string; direction: 'up' | 'down' }) => Promise<AcceptanceFeedbackResult | null>;
  onAcceptanceReset?: (profileName: string) => Promise<AcceptanceFeedbackResult>;
  onValorantStatusRequested?: () => Promise<{
    enabled: boolean;
    syncRunning: boolean;
    provider: ValorantCompositionProvider;
    nextScheduledSyncAt?: string;
    lastAttemptedSyncAt?: string;
    lastSuccessfulSyncAt?: string;
    healthState: 'healthy' | 'degraded';
    healthReasons: string[];
    lastError?: string;
    importedEvents: number;
    parsedCompositions: number;
    aggregatedFullComps: number;
  }>;
  onValorantSyncRequested?: () => Promise<{
    run: {
      status: 'running' | 'success' | 'failed';
      provider: ValorantCompositionProvider;
      importedEvents: number;
      parsedCompositions: number;
      aggregatedFullComps: number;
      error?: string;
    };
    state: {
      metadata: {
        provider: ValorantCompositionProvider;
        lastSuccessfulSyncAt?: string;
        lastError?: string;
      };
    };
  }>;
  onValorantHelpRequested?: () => Promise<string>;
  onValorantTopRequested?: (input: {
    mapQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }) => Promise<string>;
  onValorantAgentRequested?: (input: {
    agentQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }) => Promise<string>;
  onValorantMapMetaRequested?: (input: {
    mapQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }) => Promise<string>;
  onValorantEventsRequested?: (input: {
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }) => Promise<string>;
  onValorantTeamRequested?: (input: {
    teamQuery: string;
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
  }) => Promise<string>;
  onValorantCompBuilderStart?: (userId: string, options: {
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }) => Promise<CompBuilderSnapshot>;
  onValorantCompBuilderAction?: (input: {
    userId: string;
    sessionId: string;
    action: CompBuilderAction;
  }) => Promise<CompBuilderSnapshot | null>;
}
