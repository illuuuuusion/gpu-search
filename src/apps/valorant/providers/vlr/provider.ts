import axios, { type AxiosInstance } from 'axios';
import { VALORANT_AGENTS } from '../../config/agents.js';
import { VALORANT_MAPS } from '../../config/maps.js';
import type {
  CompositionRecord,
  ValorantSourceEvent,
  ValorantSourceEventStatus,
  ValorantTournamentScope,
} from '../../domain/models.js';
import type {
  ValorantCompositionDataProvider,
  ValorantProviderImportOptions,
  ValorantProviderImportResult,
} from '../types.js';
import { logger } from '../../../../utils/logger.js';

interface VlrProviderOptions {
  baseUrl: string;
  minRequestIntervalMs: number;
  maxEventPages: number;
}

interface VlrEventCard {
  id: string;
  slug: string;
  title: string;
  status: ValorantSourceEventStatus;
  sourceUrl: string;
  agentsUrl: string;
}

const RELEVANT_EVENT_PATTERNS: Array<{
  scope: ValorantTournamentScope;
  expression: RegExp;
}> = [
  { scope: 'americas', expression: /^VCT\s+\d{4}:\s+Americas(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
  { scope: 'emea', expression: /^VCT\s+\d{4}:\s+EMEA(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
  { scope: 'pacific', expression: /^VCT\s+\d{4}:\s+Pacific(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
  { scope: 'china', expression: /^VCT\s+\d{4}:\s+China(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
  { scope: 'masters', expression: /^VALORANT\s+Masters\b/i },
  { scope: 'champions', expression: /^VALORANT\s+Champions\b/i },
];

const AGENT_KEY_BY_ALIAS = new Map<string, string>(
  VALORANT_AGENTS.flatMap(agent => [
    [normalizeLookup(agent.key), agent.key],
    [normalizeLookup(agent.displayName), agent.key],
    ...agent.aliases.map(alias => [normalizeLookup(alias), agent.key] as const),
  ]),
);

const MAP_KEY_BY_ALIAS = new Map<string, string>(
  VALORANT_MAPS.flatMap(map => [
    [normalizeLookup(map.key), map.key],
    [normalizeLookup(map.displayName), map.key],
    ...map.aliases.map(alias => [normalizeLookup(alias), map.key] as const),
  ]),
);

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'')
    .replaceAll('&apos;', '\'')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&ndash;', '-')
    .replaceAll('&mdash;', '-');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(stripTags(value))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function inferScopeFromTitle(title: string): ValorantTournamentScope | undefined {
  return RELEVANT_EVENT_PATTERNS.find(pattern => pattern.expression.test(title))?.scope;
}

function extractYearFromTitle(title: string): number | undefined {
  const yearMatch = title.match(/\b(20\d{2})\b/);
  return yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;
}

function getRelevantYears(now: Date, windowDays: number): Set<number> {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);

  return new Set([now.getUTCFullYear(), cutoff.getUTCFullYear()]);
}

function parseDateValue(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = normalizeWhitespace(rawValue);
  if (!normalized || normalized.toLowerCase() === 'tbd') {
    return undefined;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parseEventDateRange(rawValue: string | undefined): {
  startDate?: string;
  endDate?: string;
} {
  if (!rawValue) {
    return {};
  }

  const separator = rawValue.includes(' - ') ? ' - ' : rawValue.includes('—') ? '—' : undefined;
  if (!separator) {
    return {
      startDate: parseDateValue(rawValue),
    };
  }

  const [rawStartDate, rawEndDate] = rawValue.split(separator).map(value => value.trim());
  return {
    startDate: parseDateValue(rawStartDate),
    endDate: parseDateValue(rawEndDate),
  };
}

function resolveCompositionPlayedAt(event: ValorantSourceEvent, now: Date): string {
  const candidateTimestamps = [event.endDate, event.startDate]
    .filter((value): value is string => Boolean(value))
    .map(value => Date.parse(value))
    .filter(value => !Number.isNaN(value));

  if (candidateTimestamps.length === 0) {
    return now.toISOString();
  }

  return new Date(Math.min(Math.max(...candidateTimestamps), now.getTime())).toISOString();
}

function extractEventCards(html: string, baseUrl: string): VlrEventCard[] {
  const cards: VlrEventCard[] = [];
  const expression = /<a class="wf-card mod-flex event-item" href="([^"]+)"[\s\S]*?<div class="event-item-title">\s*([\s\S]*?)\s*<\/div>[\s\S]*?<span class="event-item-desc-item-status mod-([a-z]+)">([^<]+)<\/span>/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(html))) {
    const href = match[1];
    const title = normalizeWhitespace(match[2]);
    const status = normalizeWhitespace(match[4]).toLowerCase() as ValorantSourceEventStatus;
    const eventPathMatch = href.match(/^\/event\/(\d+)\/([^/?#]+)/);
    if (!eventPathMatch) {
      continue;
    }

    const [, id, slug] = eventPathMatch;
    cards.push({
      id,
      slug,
      title,
      status: status === 'completed' ? 'completed' : status === 'ongoing' ? 'ongoing' : 'upcoming',
      sourceUrl: new URL(href, baseUrl).toString(),
      agentsUrl: new URL(`/event/agents/${id}/${slug}`, baseUrl).toString(),
    });
  }

  return cards;
}

function extractEventDatesFromPage(html: string): {
  startDate?: string;
  endDate?: string;
} {
  const match = html.match(
    /<div class="ge-text-light event-desc-item-label">\s*Dates\s*<\/div>\s*<div class="event-desc-item-value">\s*([\s\S]*?)<\/div>/i,
  );

  return parseEventDateRange(match?.[1]);
}

function extractMapBlocks(html: string): string[] {
  return html
    .split('<div class="pr-matrix-map">')
    .slice(1)
    .map(section => `<div class="pr-matrix-map">${section}`);
}

function extractTableRows(html: string): Array<{ classes: string; content: string }> {
  const rows: Array<{ classes: string; content: string }> = [];
  const expression = /<tr class="([^"]*pr-matrix-row[^"]*)">([\s\S]*?)<\/tr>/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(html))) {
    rows.push({
      classes: match[1],
      content: match[2],
    });
  }

  return rows;
}

function extractMapKey(mapBlockHtml: string): string | undefined {
  const match = mapBlockHtml.match(/<th[^>]*><span class="map-pseudo-icon">[^<]*<\/span>\s*([^<]+)<\/th>/i);
  if (!match) {
    return undefined;
  }

  return MAP_KEY_BY_ALIAS.get(normalizeLookup(match[1]));
}

function extractHeaderAgentKeys(mapBlockHtml: string): string[] {
  const headerSection = mapBlockHtml.split('<tr class="pr-matrix-row"')[0] ?? mapBlockHtml;
  const agentKeys: string[] = [];
  const expression = /<img [^>]*title="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(headerSection))) {
    const agentKey = AGENT_KEY_BY_ALIAS.get(normalizeLookup(match[1]));
    agentKeys.push(agentKey ?? `unknown:${normalizeLookup(match[1])}`);
  }

  return agentKeys;
}

function extractCellClasses(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td(?:\s+class="([^"]*)")?[^>]*>/g)]
    .map(match => match[1] ?? '');
}

function extractTeamName(rowHtml: string): string | undefined {
  const match = rowHtml.match(/<span class="text-of"[^>]*>([\s\S]*?)<\/span>/i);
  return match ? normalizeWhitespace(match[1]) : undefined;
}

function extractParentGroupId(rowHtml: string): string | undefined {
  const match = rowHtml.match(/data-vs-id="([^"]+)"/i);
  return match?.[1];
}

function extractDropdownGroupId(classes: string): string | undefined {
  return classes
    .split(/\s+/)
    .find(className => className !== 'pr-matrix-row' && className !== 'mod-dropdown');
}

function extractMatchPath(rowHtml: string): string | undefined {
  const match = rowHtml.match(/<a href="([^"]+)"/i);
  return match?.[1];
}

function extractRowResult(rowHtml: string): boolean | undefined {
  const match = rowHtml.match(/<td class="([^"]+)">/i);
  if (!match) {
    return undefined;
  }

  if (match[1].includes('mod-win')) {
    return true;
  }

  if (match[1].includes('mod-loss')) {
    return false;
  }

  return undefined;
}

function extractPickedAgents(
  rowHtml: string,
  headerAgentKeys: string[],
  pickedClassName: string,
): string[] {
  const dataCellClasses = extractCellClasses(rowHtml).slice(2);

  return headerAgentKeys
    .filter((agentKey, index) =>
      dataCellClasses[index]?.includes(pickedClassName)
      && !agentKey.startsWith('unknown:'),
    )
    .filter((agentKey, index, agentKeys) => agentKeys.indexOf(agentKey) === index);
}

function isWithinWindow(
  event: ValorantSourceEvent,
  nowTime: number,
  cutoffTime: number,
): boolean {
  const eventEndTime = event.endDate ? Date.parse(event.endDate) : undefined;
  const eventStartTime = event.startDate ? Date.parse(event.startDate) : undefined;
  if (eventStartTime !== undefined && !Number.isNaN(eventStartTime) && eventStartTime > nowTime) {
    return false;
  }

  const comparisonTime = eventEndTime ?? eventStartTime;

  if (comparisonTime === undefined || Number.isNaN(comparisonTime)) {
    return event.status !== 'completed';
  }

  return comparisonTime >= cutoffTime;
}

class VlrHttpClient {
  private readonly http: AxiosInstance;
  private nextRequestAt = 0;

  constructor(private readonly options: VlrProviderOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'gpu-search/0.1',
      },
    });
  }

  private async waitForRateWindow(): Promise<void> {
    const waitMs = this.nextRequestAt - Date.now();
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  async fetchHtml(pathOrUrl: string): Promise<string> {
    await this.waitForRateWindow();

    try {
      const response = await this.http.get<string>(pathOrUrl, {
        responseType: 'text',
      });
      return response.data;
    } finally {
      this.nextRequestAt = Date.now() + this.options.minRequestIntervalMs;
    }
  }
}

export class VlrValorantCompositionProvider implements ValorantCompositionDataProvider {
  readonly name = 'vlr' as const;
  private readonly client: VlrHttpClient;

  constructor(private readonly options: VlrProviderOptions) {
    this.client = new VlrHttpClient(options);
  }

  private async discoverEventCards(now: Date, windowDays: number): Promise<VlrEventCard[]> {
    const relevantYears = getRelevantYears(now, windowDays);
    const cardsById = new Map<string, VlrEventCard>();

    for (let page = 1; page <= this.options.maxEventPages; page += 1) {
      const path = page === 1 ? '/events' : `/events/?page=${page}`;
      const html = await this.client.fetchHtml(path);
      const cards = extractEventCards(html, this.options.baseUrl);

      for (const card of cards) {
        const scope = inferScopeFromTitle(card.title);
        const titleYear = extractYearFromTitle(card.title);
        if (!scope || (titleYear && !relevantYears.has(titleYear))) {
          continue;
        }

        cardsById.set(card.id, card);
      }
    }

    return [...cardsById.values()];
  }

  private parseEventImport(
    card: VlrEventCard,
    html: string,
    now: Date,
  ): {
    event?: ValorantSourceEvent;
    compositions: CompositionRecord[];
  } {
    const scope = inferScopeFromTitle(card.title);
    if (!scope) {
      return { compositions: [] };
    }

    const { startDate, endDate } = extractEventDatesFromPage(html);
    const event: ValorantSourceEvent = {
      id: card.id,
      slug: card.slug,
      title: card.title,
      scope,
      status: card.status,
      sourceUrl: card.sourceUrl,
      agentsUrl: card.agentsUrl,
      startDate,
      endDate,
    };
    const playedAt = resolveCompositionPlayedAt(event, now);
    const compositionsById = new Map<string, CompositionRecord>();

    for (const mapBlock of extractMapBlocks(html)) {
      const mapKey = extractMapKey(mapBlock);
      if (!mapKey) {
        continue;
      }

      const headerAgentKeys = extractHeaderAgentKeys(mapBlock);
      const teamNameByGroupId = new Map<string, string>();

      for (const row of extractTableRows(mapBlock)) {
        if (!row.classes.includes('mod-dropdown')) {
          const teamName = extractTeamName(row.content);
          const groupId = extractParentGroupId(row.content);
          if (teamName && groupId) {
            teamNameByGroupId.set(groupId, teamName);
          }
          continue;
        }

        const groupId = extractDropdownGroupId(row.classes);
        const teamName = groupId ? teamNameByGroupId.get(groupId) : undefined;
        const won = extractRowResult(row.content);
        const matchPath = extractMatchPath(row.content);
        if (!groupId || !teamName || won === undefined || !matchPath) {
          continue;
        }

        const agents = extractPickedAgents(row.content, headerAgentKeys, 'mod-picked-lite');
        if (agents.length !== 5) {
          continue;
        }

        const sourceUrl = new URL(matchPath, this.options.baseUrl).toString();
        const compositionId = [
          'vlr',
          card.id,
          mapKey,
          normalizeLookup(teamName),
          normalizeLookup(matchPath),
        ].join(':');

        compositionsById.set(compositionId, {
          id: compositionId,
          matchPageTitle: matchPath,
          mapName: mapKey,
          teamName,
          agents,
          won,
          playedAt,
          scope,
          sourceEventId: card.id,
          sourceUrl,
        });
      }
    }

    return {
      event,
      compositions: [...compositionsById.values()],
    };
  }

  async importData(options: ValorantProviderImportOptions): Promise<ValorantProviderImportResult> {
    const cutoff = new Date(options.now);
    cutoff.setUTCDate(cutoff.getUTCDate() - options.windowDays);
    const cards = await this.discoverEventCards(options.now, options.windowDays);
    const sourceEvents: ValorantSourceEvent[] = [];
    const compositions: CompositionRecord[] = [];

    for (const card of cards) {
      const html = await this.client.fetchHtml(card.agentsUrl);
      const parsed = this.parseEventImport(card, html, options.now);
      if (
        !parsed.event
        || !isWithinWindow(parsed.event, options.now.getTime(), cutoff.getTime())
        || parsed.compositions.length === 0
      ) {
        continue;
      }

      sourceEvents.push(parsed.event);
      compositions.push(...parsed.compositions);
    }

    logger.info({
      provider: this.name,
      discoveredEvents: cards.length,
      importedEvents: sourceEvents.length,
      parsedCompositions: compositions.length,
    }, 'valorant provider import completed');

    return {
      provider: this.name,
      sourceEvents,
      compositions: compositions.sort((left, right) =>
        right.playedAt.localeCompare(left.playedAt)
          || left.mapName.localeCompare(right.mapName)
          || left.id.localeCompare(right.id),
      ),
    };
  }
}
