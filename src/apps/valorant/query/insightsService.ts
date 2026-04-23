import { buildFullCompositionAggregates } from '../analytics/aggregateBuilder.js';
import { VALORANT_AGENTS } from '../config/agents.js';
import { VALORANT_MAPS } from '../config/maps.js';
import type {
  CompBuilderFilters,
  FullCompositionAggregate,
  ValorantAgentRole,
  ValorantAppState,
  ValorantHealthState,
  ValorantSourceEvent,
  ValorantSourceEventStatus,
  ValorantTournamentScope,
} from '../domain/models.js';
import { FileValorantRepository } from '../storage/fileRepository.js';

const CACHE_TTL_MS = 15_000;
const AGENT_BY_KEY = new Map(VALORANT_AGENTS.map(agent => [agent.key, agent]));
const MAP_BY_KEY = new Map(VALORANT_MAPS.map(map => [map.key, map]));

interface CommandFilters extends CompBuilderFilters {
  mapKey?: string;
}

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function formatDate(value?: string): string {
  if (!value) {
    return 'unbekannt';
  }

  return new Date(value).toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function getConfidenceLabel(games: number): string {
  if (games >= 18) {
    return 'sehr stabil';
  }

  if (games >= 8) {
    return 'solide Daten';
  }

  return 'kleine Stichprobe';
}

function matchScope(scope: ValorantTournamentScope, filterScope: ValorantTournamentScope | undefined): boolean {
  if (!filterScope) {
    return true;
  }

  return scope === filterScope;
}

function matchEventStatus(
  eventStatus: ValorantSourceEventStatus | undefined,
  filterStatus: ValorantSourceEventStatus | undefined,
): boolean {
  if (!filterStatus) {
    return true;
  }

  return eventStatus === filterStatus;
}

function matchTeam(teamName: string, teamQuery: string | undefined): boolean {
  if (!teamQuery) {
    return true;
  }

  return normalizeLookup(teamName).includes(normalizeLookup(teamQuery));
}

function matchWindow(playedAt: string, days: number | undefined, now: Date): boolean {
  if (!days) {
    return true;
  }

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return Date.parse(playedAt) >= cutoff.getTime();
}

function describeFilters(filters: CompBuilderFilters, eventById: Map<string, ValorantSourceEvent>): string {
  const parts: string[] = [];

  if (filters.scope) {
    parts.push(filters.scope.toUpperCase());
  }

  if (filters.eventId) {
    const event = eventById.get(filters.eventId);
    parts.push(event ? event.title : filters.eventId);
  }

  if (filters.eventStatus) {
    parts.push(`Status: ${filters.eventStatus}`);
  }

  if (filters.days) {
    parts.push(`letzte ${filters.days} Tage`);
  }

  if (filters.teamQuery) {
    parts.push(`Team: ${filters.teamQuery}`);
  }

  return parts.length > 0 ? parts.join(' • ') : 'alle Daten';
}

export function filterCompositions(
  state: ValorantAppState,
  filters: CompBuilderFilters,
  now: Date,
) {
  const eventById = new Map(state.sourceEvents.map(event => [event.id, event]));

  return state.compositions.filter(composition => {
    const sourceEvent = composition.sourceEventId ? eventById.get(composition.sourceEventId) : undefined;
    return matchScope(composition.scope, filters.scope)
      && (!filters.eventId || composition.sourceEventId === filters.eventId)
      && matchEventStatus(sourceEvent?.status ?? composition.eventStatus, filters.eventStatus)
      && matchWindow(composition.playedAt, filters.days, now)
      && matchTeam(composition.teamName, filters.teamQuery);
  });
}

export function buildFilteredAggregates(
  state: ValorantAppState,
  filters: CompBuilderFilters,
  now: Date,
): FullCompositionAggregate[] {
  return buildFullCompositionAggregates(filterCompositions(state, filters, now));
}

function resolveEventId(
  sourceEvents: ValorantSourceEvent[],
  eventQuery: string | undefined,
): string | undefined {
  if (!eventQuery) {
    return undefined;
  }

  const normalizedQuery = normalizeLookup(eventQuery);
  return sourceEvents.find(event =>
    normalizeLookup(event.id) === normalizedQuery
    || normalizeLookup(event.slug) === normalizedQuery
    || normalizeLookup(event.title).includes(normalizedQuery),
  )?.id;
}

function findAgentKey(agentQuery: string): string | undefined {
  const normalizedQuery = normalizeLookup(agentQuery);
  return VALORANT_AGENTS.find(agent =>
    normalizeLookup(agent.key) === normalizedQuery
    || normalizeLookup(agent.displayName) === normalizedQuery
    || agent.aliases.some(alias => normalizeLookup(alias) === normalizedQuery),
  )?.key;
}

function findMapKey(mapQuery: string): string | undefined {
  const normalizedQuery = normalizeLookup(mapQuery);
  return VALORANT_MAPS.find(map =>
    normalizeLookup(map.key) === normalizedQuery
    || normalizeLookup(map.displayName) === normalizedQuery
    || map.aliases.some(alias => normalizeLookup(alias) === normalizedQuery),
  )?.key;
}

function summarizeComposition(
  aggregate: FullCompositionAggregate,
  eventById: Map<string, ValorantSourceEvent>,
): string {
  const eventNames = aggregate.sourceEventIds
    .map(eventId => eventById.get(eventId)?.title)
    .filter((eventName): eventName is string => Boolean(eventName))
    .slice(0, 2);

  return [
    `${aggregate.agentKeys.map(agentKey => AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey).join(', ')}`,
    `${formatPercent(aggregate.smoothedWinRate)} smoothed • ${formatPercent(aggregate.rawWinRate)} raw • ${aggregate.games} Maps • ${getConfidenceLabel(aggregate.games)}`,
    `Zuletzt: ${formatDate(aggregate.lastPlayedAt)} • Teams: ${aggregate.exampleTeams.join(', ')}`,
    eventNames.length > 0 ? `Events: ${eventNames.join(' | ')}` : undefined,
    aggregate.latestSourceUrl ? `Quelle: ${aggregate.latestSourceUrl}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export class ValorantInsightsService {
  private cachedState: ValorantAppState | null = null;
  private cachedAt = 0;

  constructor(private readonly repository: FileValorantRepository) {}

  async getState(): Promise<ValorantAppState> {
    if (this.cachedState && (Date.now() - this.cachedAt) < CACHE_TTL_MS) {
      return this.cachedState;
    }

    const state = await this.repository.load();
    this.cachedState = state;
    this.cachedAt = Date.now();
    return state;
  }

  primeState(state: ValorantAppState): void {
    this.cachedState = state;
    this.cachedAt = Date.now();
  }

  clearCache(): void {
    this.cachedState = null;
    this.cachedAt = 0;
  }

  async resolveFilters(input: {
    scope?: ValorantTournamentScope;
    eventQuery?: string;
    eventStatus?: ValorantSourceEventStatus;
    days?: number;
    teamQuery?: string;
  }): Promise<CompBuilderFilters> {
    const state = await this.getState();
    return {
      scope: input.scope,
      eventId: resolveEventId(state.sourceEvents, input.eventQuery),
      eventStatus: input.eventStatus,
      days: input.days,
      teamQuery: input.teamQuery?.trim() || undefined,
    };
  }

  async getHelpText(): Promise<string> {
    const state = await this.getState();
    return [
      'VALORANT Commands',
      `/compbuilder: interaktiver Builder mit Filtern für Region/Event/Status/Tage`,
      `/vct-top map:<map>: beste Full-Comps für eine Map`,
      `/vct-agent agent:<agent>: Agent-Report mit besten Maps und Comps`,
      `/vct-map-meta map:<map>: Map-Meta, Pickrates und Top-Comps`,
      `/vct-events: importierte Snapshot-Events`,
      `/vct-team team:<name>: Team-spezifische Comps`,
      `/vct-status: Snapshot- und Sync-Status`,
      `/vct-sync oder /vct-scan: manueller Snapshot-Refresh`,
      `Aktueller Datensatz: ${state.sourceEvents.length} Events • ${state.compositions.length} Comps • Stand ${formatDate(state.metadata.lastSuccessfulSyncAt)}`,
    ].join('\n');
  }

  async getTopCompositionsText(mapQuery: string, filters: CompBuilderFilters): Promise<string> {
    const state = await this.getState();
    const mapKey = findMapKey(mapQuery);
    if (!mapKey) {
      return `Unbekannte Map: ${mapQuery}`;
    }

    const eventById = new Map(state.sourceEvents.map(event => [event.id, event]));
    const aggregates = buildFilteredAggregates(state, { ...filters }, new Date())
      .filter(aggregate => aggregate.mapName === mapKey)
      .slice(0, 5);

    if (aggregates.length === 0) {
      return `Keine Full-Comps gefunden für ${MAP_BY_KEY.get(mapKey)?.displayName ?? mapKey} (${describeFilters(filters, eventById)}).`;
    }

    return [
      `Top-Comps auf ${MAP_BY_KEY.get(mapKey)?.displayName ?? mapKey}`,
      `Filter: ${describeFilters(filters, eventById)}`,
      ...aggregates.map((aggregate, index) => `${index + 1}. ${summarizeComposition(aggregate, eventById)}`),
    ].join('\n\n');
  }

  async getAgentText(agentQuery: string, filters: CompBuilderFilters): Promise<string> {
    const state = await this.getState();
    const agentKey = findAgentKey(agentQuery);
    if (!agentKey) {
      return `Unbekannter Agent: ${agentQuery}`;
    }

    const now = new Date();
    const eventById = new Map(state.sourceEvents.map(event => [event.id, event]));
    const compositions = filterCompositions(state, filters, now)
      .filter(composition => composition.agents.includes(agentKey));

    if (compositions.length === 0) {
      return `Keine Daten gefunden für ${AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey} (${describeFilters(filters, eventById)}).`;
    }

    const wins = compositions.filter(composition => composition.won).length;
    const mapStats = new Map<string, { games: number; wins: number }>();

    for (const composition of compositions) {
      const mapStat = mapStats.get(composition.mapName) ?? { games: 0, wins: 0 };
      mapStat.games += 1;
      mapStat.wins += composition.won ? 1 : 0;
      mapStats.set(composition.mapName, mapStat);
    }

    const topMaps = [...mapStats.entries()]
      .sort((left, right) =>
        (right[1].wins / right[1].games) - (left[1].wins / left[1].games)
          || right[1].games - left[1].games,
      )
      .slice(0, 3);
    const topCompositions = buildFilteredAggregates(state, filters, now)
      .filter(aggregate => aggregate.agentKeys.includes(agentKey))
      .slice(0, 3);

    return [
      `Agent-Report: ${AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey}`,
      `Filter: ${describeFilters(filters, eventById)}`,
      `Maps: ${compositions.length} • Winrate: ${formatPercent(wins / compositions.length)} • Zuletzt gesehen: ${formatDate(compositions[0]?.playedAt)}`,
      topMaps.length > 0
        ? `Beste Maps: ${topMaps.map(([mapName, stat]) => `${MAP_BY_KEY.get(mapName)?.displayName ?? mapName} ${formatPercent(stat.wins / stat.games)} bei ${stat.games} Maps`).join(' | ')}`
        : 'Beste Maps: keine',
      topCompositions.length > 0
        ? `Top-Comps:\n${topCompositions.map((aggregate, index) => `${index + 1}. ${summarizeComposition(aggregate, eventById)}`).join('\n\n')}`
        : 'Top-Comps: keine',
    ].join('\n');
  }

  async getMapMetaText(mapQuery: string, filters: CompBuilderFilters): Promise<string> {
    const state = await this.getState();
    const mapKey = findMapKey(mapQuery);
    if (!mapKey) {
      return `Unbekannte Map: ${mapQuery}`;
    }

    const now = new Date();
    const eventById = new Map(state.sourceEvents.map(event => [event.id, event]));
    const compositions = filterCompositions(state, filters, now)
      .filter(composition => composition.mapName === mapKey);

    if (compositions.length === 0) {
      return `Keine Map-Meta gefunden für ${MAP_BY_KEY.get(mapKey)?.displayName ?? mapKey} (${describeFilters(filters, eventById)}).`;
    }

    const agentStats = new Map<string, { picks: number; wins: number }>();
    for (const composition of compositions) {
      for (const agentKey of composition.agents) {
        const agentStat = agentStats.get(agentKey) ?? { picks: 0, wins: 0 };
        agentStat.picks += 1;
        agentStat.wins += composition.won ? 1 : 0;
        agentStats.set(agentKey, agentStat);
      }
    }

    const topAgents = [...agentStats.entries()]
      .sort((left, right) =>
        right[1].picks - left[1].picks
          || (right[1].wins / right[1].picks) - (left[1].wins / left[1].picks),
      )
      .slice(0, 6);
    const topCompositions = buildFilteredAggregates(state, filters, now)
      .filter(aggregate => aggregate.mapName === mapKey)
      .slice(0, 3);

    return [
      `Map-Meta: ${MAP_BY_KEY.get(mapKey)?.displayName ?? mapKey}`,
      `Filter: ${describeFilters(filters, eventById)}`,
      `Maps im Datensatz: ${compositions.length} • Zuletzt gesehen: ${formatDate(compositions[0]?.playedAt)}`,
      `Top Agents: ${topAgents.map(([agentKey, stat]) =>
        `${AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey} ${formatPercent(stat.picks / compositions.length)} Pickrate • ${formatPercent(stat.wins / stat.picks)} WR`
      ).join(' | ')}`,
      topCompositions.length > 0
        ? `Top Full-Comps:\n${topCompositions.map((aggregate, index) => `${index + 1}. ${summarizeComposition(aggregate, eventById)}`).join('\n\n')}`
        : 'Top Full-Comps: keine',
    ].join('\n');
  }

  async getEventsText(filters: CompBuilderFilters = {}): Promise<string> {
    const state = await this.getState();
    const now = new Date();
    const compositions = filterCompositions(state, filters, now);
    const compCountByEventId = new Map<string, number>();

    for (const composition of compositions) {
      if (!composition.sourceEventId) {
        continue;
      }

      compCountByEventId.set(
        composition.sourceEventId,
        (compCountByEventId.get(composition.sourceEventId) ?? 0) + 1,
      );
    }

    const visibleEvents = state.sourceEvents
      .filter(event =>
        matchScope(event.scope, filters.scope)
        && (!filters.eventId || event.id === filters.eventId)
        && matchEventStatus(event.status, filters.eventStatus),
      )
      .sort((left, right) =>
        (right.endDate ?? right.startDate ?? '').localeCompare(left.endDate ?? left.startDate ?? '')
          || left.title.localeCompare(right.title),
      )
      .slice(0, 10);

    if (visibleEvents.length === 0) {
      return `Keine Events gefunden (${describeFilters(filters, new Map(state.sourceEvents.map(event => [event.id, event])))}).`;
    }

    return [
      `Snapshot-Events (${visibleEvents.length})`,
      `Filter: ${describeFilters(filters, new Map(state.sourceEvents.map(event => [event.id, event])))}`,
      ...visibleEvents.map(event =>
        `${event.title} • ${event.scope.toUpperCase()} • ${event.status} • ${compCountByEventId.get(event.id) ?? 0} Comps • ${formatDate(event.startDate)} -> ${formatDate(event.endDate)}`,
      ),
    ].join('\n');
  }

  async getTeamText(teamQuery: string, filters: CompBuilderFilters): Promise<string> {
    const state = await this.getState();
    const now = new Date();
    const eventById = new Map(state.sourceEvents.map(event => [event.id, event]));
    const compositions = filterCompositions(state, { ...filters, teamQuery }, now);

    if (compositions.length === 0) {
      return `Keine Team-Daten gefunden für ${teamQuery} (${describeFilters(filters, eventById)}).`;
    }

    const normalizedTeamQuery = normalizeLookup(teamQuery);
    const matchingTeamName = compositions.find(composition =>
      normalizeLookup(composition.teamName).includes(normalizedTeamQuery),
    )?.teamName ?? teamQuery;
    const wins = compositions.filter(composition => composition.won).length;
    const mapStats = new Map<string, number>();

    for (const composition of compositions) {
      mapStats.set(composition.mapName, (mapStats.get(composition.mapName) ?? 0) + 1);
    }

    const topCompositions = buildFullCompositionAggregates(compositions).slice(0, 3);

    return [
      `Team-Report: ${matchingTeamName}`,
      `Filter: ${describeFilters(filters, eventById)}`,
      `Maps: ${compositions.length} • Winrate: ${formatPercent(wins / compositions.length)} • Zuletzt gespielt: ${formatDate(compositions[0]?.playedAt)}`,
      `Meiste Maps: ${[...mapStats.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([mapName, games]) => `${MAP_BY_KEY.get(mapName)?.displayName ?? mapName} (${games})`)
        .join(' | ')}`,
      topCompositions.length > 0
        ? `Lieblings-Comps:\n${topCompositions.map((aggregate, index) => `${index + 1}. ${summarizeComposition(aggregate, eventById)}`).join('\n\n')}`
        : 'Lieblings-Comps: keine',
    ].join('\n');
  }
}

export function getRoleForAgent(agentKey: string): ValorantAgentRole | undefined {
  return AGENT_BY_KEY.get(agentKey)?.role;
}

export function getEventNamesFromIds(
  sourceEvents: ValorantSourceEvent[],
  eventIds: string[],
): string[] {
  const eventById = new Map(sourceEvents.map(event => [event.id, event]));
  return eventIds
    .map(eventId => eventById.get(eventId)?.title)
    .filter((eventName): eventName is string => Boolean(eventName));
}
