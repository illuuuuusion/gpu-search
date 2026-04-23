export type ValorantAgentRole = 'Duelist' | 'Sentinel' | 'Controller' | 'Initiator';

export type ValorantTournamentScope =
  | 'americas'
  | 'emea'
  | 'pacific'
  | 'china'
  | 'masters'
  | 'champions';

export type ValorantSyncTrigger = 'startup' | 'scheduled' | 'manual';
export type ValorantCompositionProvider = 'vlr' | 'grid';
export type ValorantSourceEventStatus = 'upcoming' | 'ongoing' | 'completed';
export type ValorantHealthState = 'healthy' | 'degraded';

export interface StaticAgentDefinition {
  key: string;
  displayName: string;
  role: ValorantAgentRole;
  aliases: string[];
}

export interface StaticMapDefinition {
  key: string;
  displayName: string;
  aliases: string[];
}

export interface LiquipediaTournamentSeed {
  key: string;
  scope: ValorantTournamentScope;
  pageTitleTemplates: string[];
  searchQueries: string[];
}

export interface DiscoveredTournamentPage {
  seedKey: string;
  scope: ValorantTournamentScope;
  pageTitle: string;
  source: 'template' | 'search';
  discoveredAt: string;
}

export interface CachedMatchPage {
  title: string;
  sourceUrl: string;
  discoveredFromPageTitle: string;
  scope: ValorantTournamentScope;
  capturedAt: string;
  playedAt?: string;
  teamOneName?: string;
  teamTwoName?: string;
}

export interface MatchPageArtifact {
  title: string;
  capturedAt: string;
  content: string;
}

export interface CompositionRecord {
  id: string;
  matchPageTitle: string;
  mapName: string;
  teamName: string;
  agents: string[];
  won: boolean;
  playedAt: string;
  scope: ValorantTournamentScope;
  sourceEventId?: string;
  sourceUrl?: string;
  eventStatus?: ValorantSourceEventStatus;
}

export interface FullCompositionAggregate {
  id: string;
  mapName: string;
  agentKeys: string[];
  games: number;
  wins: number;
  rawWinRate: number;
  smoothedWinRate: number;
  lastPlayedAt: string;
  scopes: ValorantTournamentScope[];
  sourceEventIds: string[];
  sourceUrls: string[];
  latestSourceUrl?: string;
  exampleTeams: string[];
}

export interface ValorantSyncRun {
  id: string;
  provider: ValorantCompositionProvider;
  trigger: ValorantSyncTrigger;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed';
  importedEvents: number;
  parsedCompositions: number;
  aggregatedFullComps: number;
  error?: string;
}

export interface ValorantSourceEvent {
  id: string;
  slug: string;
  title: string;
  scope: ValorantTournamentScope;
  status: ValorantSourceEventStatus;
  sourceUrl: string;
  agentsUrl: string;
  startDate?: string;
  endDate?: string;
}

export interface ValorantSnapshotMetadata {
  provider: ValorantCompositionProvider;
  windowDays: number;
  nextScheduledSyncAt?: string;
  lastAttemptedSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  healthState?: ValorantHealthState;
  healthReasons?: string[];
  lastError?: string;
}

export interface ValorantMatchReference {
  path: string;
  playedAt: string;
  fetchedAt: string;
}

export interface CompBuilderFilters {
  scope?: ValorantTournamentScope;
  eventId?: string;
  eventStatus?: ValorantSourceEventStatus;
  days?: number;
  teamQuery?: string;
}

export interface CompBuilderPreset {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  filters: CompBuilderFilters;
  selectedMapKey?: string;
  selectedAgentKeys: string[];
  excludedAgentKeys: string[];
}

export interface CompBuilderPresetSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface CompBuilderStartOptions {
  filters: CompBuilderFilters;
  presetId?: string;
}

export interface ValorantSnapshotState {
  version: 2;
  metadata: ValorantSnapshotMetadata;
  sourceEvents: ValorantSourceEvent[];
  matchReferences: ValorantMatchReference[];
  compositions: CompositionRecord[];
  fullCompositionAggregates: FullCompositionAggregate[];
  builderPresets: CompBuilderPreset[];
  syncRuns: ValorantSyncRun[];
}

export type ValorantStateMetadata = ValorantSnapshotMetadata;
export type ValorantAppState = ValorantSnapshotState;

export interface ValorantSyncResult {
  run: ValorantSyncRun;
  state: ValorantSnapshotState;
}

export interface ValorantStatusSnapshot {
  enabled: boolean;
  syncRunning: boolean;
  provider: ValorantCompositionProvider;
  nextScheduledSyncAt?: string;
  lastAttemptedSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  healthState: ValorantHealthState;
  healthReasons: string[];
  lastError?: string;
  importedEvents: number;
  parsedCompositions: number;
  aggregatedFullComps: number;
}

export interface CompBuilderMapOption {
  key: string;
  displayName: string;
  aggregateCount: number;
}

export interface CompBuilderRoleOption {
  role: ValorantAgentRole;
  agentCount: number;
}

export interface CompBuilderAgentOption {
  key: string;
  displayName: string;
  role: ValorantAgentRole;
  bestSmoothedWinRate: number;
  supportingGames: number;
  supportingCompCount: number;
}

export interface CompBuilderRecommendedComposition {
  id: string;
  agentKeys: string[];
  agentDisplayNames: string[];
  games: number;
  wins: number;
  rawWinRate: number;
  smoothedWinRate: number;
  confidenceLabel: string;
  lastPlayedAt: string;
  exampleTeams: string[];
  eventIds: string[];
  eventNames: string[];
  latestSourceUrl?: string;
}

export interface CompBuilderSnapshot {
  sessionId: string;
  expiresAt: string;
  provider: ValorantCompositionProvider;
  importedEvents: number;
  lastSuccessfulSyncAt?: string;
  healthState: ValorantHealthState;
  selectedMapKey?: string;
  selectedRole?: ValorantAgentRole;
  selectedAgentKeys: string[];
  selectedAgentDisplayNames: string[];
  excludedAgentKeys: string[];
  excludedAgentDisplayNames: string[];
  filters: CompBuilderFilters;
  availableMaps: CompBuilderMapOption[];
  availableRoles: CompBuilderRoleOption[];
  candidateAgents: CompBuilderAgentOption[];
  topCompositions: CompBuilderRecommendedComposition[];
  exactComposition?: CompBuilderRecommendedComposition;
  savedPresets: CompBuilderPresetSummary[];
  replacementAgentKey?: string;
  completed: boolean;
}

export type CompBuilderAction =
  | { type: 'set_map'; mapKey: string }
  | { type: 'set_role'; role: ValorantAgentRole }
  | { type: 'pick_agent'; agentKey: string }
  | { type: 'exclude_agent'; agentKey: string }
  | { type: 'include_agent'; agentKey: string }
  | { type: 'replace_agent'; agentKey: string }
  | { type: 'save_preset'; name: string }
  | { type: 'load_preset'; presetId: string }
  | { type: 'back' }
  | { type: 'reset' };
