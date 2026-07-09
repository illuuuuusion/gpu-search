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
  type: 'gpu-alert' | 'acceptance-feedback' | 'acceptance-reset'
    | 'dream-deal-feedback' | 'dream-deal-reset' | string;
  profileName?: string;
  listingId?: string;
}

export interface AcceptanceFeedbackResult {
  adjusted: boolean;
  profileName: string;
  previousBias: number;
  bias: number;
}

export interface DreamDealFeedbackResult {
  adjusted: boolean;
  profileName: string;
  previousThreshold: number;
  threshold: number;
}

export interface ExclusionReportResult {
  status: 'created' | 'blocked';
  term: string;
  blockedBy?: { profileName: string; alias: string };
}

export interface RuntimeExclusionView {
  id: string;
  profileName: string;
  term: string;
  reportedAt: string;
  originalListingTitle: string;
}

export interface ReminderScheduleView {
  scheduled: boolean;
  reason?: 'no_end_date' | 'already_ended' | 'already_scheduled';
  remindAt?: string;
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
  // C1: Dream-Deal-Score-Recalibrierung (🔥/🧊 + ↩️).
  onDreamDealFeedback?: (input: { profileName: string; direction: 'up' | 'down' }) => Promise<DreamDealFeedbackResult | null>;
  onDreamDealReset?: (profileName: string) => Promise<DreamDealFeedbackResult>;
  // C2: Fehltreffer melden (🚫 + Textnachricht) und Admin-Review/Undo.
  onExclusionReport?: (input: {
    profileName: string;
    term: string;
    reportedByUserId: string;
    originalListingId: string;
    originalListingTitle: string;
  }) => Promise<ExclusionReportResult>;
  onExclusionReview?: (days?: number) => Promise<RuntimeExclusionView[]>;
  onExclusionUndo?: (id: string) => Promise<boolean>;
  // D: Auktions-Sniper-Reminder (⏰).
  onAuctionReminderRequested?: (input: {
    listingId: string;
    channelId: string;
    messageId: string;
    userId: string;
  }) => Promise<ReminderScheduleView>;
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
