import axios from 'axios';
import { VALORANT_AGENTS } from '../../config/agents.js';
import { VALORANT_MAPS } from '../../config/maps.js';
import { logger } from '../../../../utils/logger.js';
const RELEVANT_EVENT_PATTERNS = [
    { scope: 'americas', expression: /^VCT\s+\d{4}:\s+Americas(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
    { scope: 'emea', expression: /^VCT\s+\d{4}:\s+EMEA(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
    { scope: 'pacific', expression: /^VCT\s+\d{4}:\s+Pacific(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
    { scope: 'china', expression: /^VCT\s+\d{4}:\s+China(?:\s+League)?\s+(Kickoff|Stage 1|Stage 2)$/i },
    { scope: 'masters', expression: /^VALORANT\s+Masters\b/i },
    { scope: 'champions', expression: /^VALORANT\s+Champions\b/i },
];
const AGENT_KEY_BY_ALIAS = new Map(VALORANT_AGENTS.flatMap(agent => [
    [normalizeLookup(agent.key), agent.key],
    [normalizeLookup(agent.displayName), agent.key],
    ...agent.aliases.map(alias => [normalizeLookup(alias), agent.key]),
]));
const MAP_KEY_BY_ALIAS = new Map(VALORANT_MAPS.flatMap(map => [
    [normalizeLookup(map.key), map.key],
    [normalizeLookup(map.displayName), map.key],
    ...map.aliases.map(alias => [normalizeLookup(alias), map.key]),
]));
function decodeHtmlEntities(value) {
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', '\'')
        .replaceAll('&apos;', '\'')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&ndash;', '-')
        .replaceAll('&mdash;', '-');
}
function stripTags(value) {
    return value.replace(/<[^>]+>/g, ' ');
}
function normalizeWhitespace(value) {
    return decodeHtmlEntities(stripTags(value))
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeLookup(value) {
    return normalizeWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}
function inferScopeFromTitle(title) {
    return RELEVANT_EVENT_PATTERNS.find(pattern => pattern.expression.test(title))?.scope;
}
function extractYearFromTitle(title) {
    const yearMatch = title.match(/\b(20\d{2})\b/);
    return yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;
}
function getRelevantYears(now, windowDays) {
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
    return new Set([now.getUTCFullYear(), cutoff.getUTCFullYear()]);
}
function parseDateValue(rawValue) {
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
function parseUtcTimestamp(rawValue) {
    if (!rawValue) {
        return undefined;
    }
    const normalized = rawValue.includes('T')
        ? rawValue
        : `${rawValue.replace(' ', 'T')}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
function parseEventDateRange(rawValue) {
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
function resolveCompositionPlayedAt(event, now) {
    const candidateTimestamps = [event.endDate, event.startDate]
        .filter((value) => Boolean(value))
        .map(value => Date.parse(value))
        .filter(value => !Number.isNaN(value));
    if (candidateTimestamps.length === 0) {
        return now.toISOString();
    }
    return new Date(Math.min(Math.max(...candidateTimestamps), now.getTime())).toISOString();
}
export function extractVlrEventCards(html, baseUrl) {
    const cards = [];
    const expression = /<a class="wf-card mod-flex event-item" href="([^"]+)"[\s\S]*?<div class="event-item-title">\s*([\s\S]*?)\s*<\/div>[\s\S]*?<span class="event-item-desc-item-status mod-([a-z]+)">([^<]+)<\/span>/g;
    let match;
    while ((match = expression.exec(html))) {
        const href = match[1];
        const title = normalizeWhitespace(match[2]);
        const status = normalizeWhitespace(match[4]).toLowerCase();
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
export function parseVlrEventImport(card, html, now) {
    const scope = inferScopeFromTitle(card.title);
    if (!scope) {
        return { compositions: [], matchPaths: [], warnings: [] };
    }
    const { startDate, endDate } = extractEventDatesFromPage(html);
    const event = {
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
    const compositionsById = new Map();
    const matchPaths = new Set();
    const warnings = [];
    const mapBlocks = extractMapBlocks(html);
    if (mapBlocks.length === 0 && card.status !== 'upcoming') {
        warnings.push(`VLR-Agent-Matrix ohne Map-Blocks für ${card.title}`);
    }
    for (const mapBlock of mapBlocks) {
        const mapKey = extractMapKey(mapBlock);
        if (!mapKey) {
            continue;
        }
        const headerAgentKeys = extractHeaderAgentKeys(mapBlock);
        if (headerAgentKeys.length < 5) {
            warnings.push(`Unerwartet wenige Agenten-Spalten auf ${card.title}/${mapKey}`);
        }
        const teamNameByGroupId = new Map();
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
            matchPaths.add(normalizeMatchPath(matchPath));
            const sourceUrl = new URL(matchPath, card.sourceUrl).toString();
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
        matchPaths: [...matchPaths],
        warnings,
    };
}
function extractEventDatesFromPage(html) {
    const match = html.match(/<div class="ge-text-light event-desc-item-label">\s*Dates\s*<\/div>\s*<div class="event-desc-item-value">\s*([\s\S]*?)<\/div>/i);
    return parseEventDateRange(match?.[1]);
}
function extractMatchTimestampFromPage(html) {
    const match = html.match(/data-utc-ts="([^"]+)"/i);
    return parseUtcTimestamp(match?.[1]);
}
function extractMapBlocks(html) {
    return html
        .split('<div class="pr-matrix-map">')
        .slice(1)
        .map(section => `<div class="pr-matrix-map">${section}`);
}
function extractTableRows(html) {
    const rows = [];
    const expression = /<tr class="([^"]*pr-matrix-row[^"]*)">([\s\S]*?)<\/tr>/g;
    let match;
    while ((match = expression.exec(html))) {
        rows.push({
            classes: match[1],
            content: match[2],
        });
    }
    return rows;
}
function extractMapKey(mapBlockHtml) {
    const match = mapBlockHtml.match(/<th[^>]*><span class="map-pseudo-icon">[^<]*<\/span>\s*([^<]+)<\/th>/i);
    if (!match) {
        return undefined;
    }
    return MAP_KEY_BY_ALIAS.get(normalizeLookup(match[1]));
}
function extractHeaderAgentKeys(mapBlockHtml) {
    const headerSection = mapBlockHtml.split('<tr class="pr-matrix-row"')[0] ?? mapBlockHtml;
    const agentKeys = [];
    const expression = /<img [^>]*title="([^"]+)"[^>]*>/g;
    let match;
    while ((match = expression.exec(headerSection))) {
        const agentKey = AGENT_KEY_BY_ALIAS.get(normalizeLookup(match[1]));
        agentKeys.push(agentKey ?? `unknown:${normalizeLookup(match[1])}`);
    }
    return agentKeys;
}
function extractCellClasses(rowHtml) {
    return [...rowHtml.matchAll(/<td(?:\s+class="([^"]*)")?[^>]*>/g)]
        .map(match => match[1] ?? '');
}
function extractTeamName(rowHtml) {
    const match = rowHtml.match(/<span class="text-of"[^>]*>([\s\S]*?)<\/span>/i);
    return match ? normalizeWhitespace(match[1]) : undefined;
}
function extractParentGroupId(rowHtml) {
    const match = rowHtml.match(/data-vs-id="([^"]+)"/i);
    return match?.[1];
}
function extractDropdownGroupId(classes) {
    return classes
        .split(/\s+/)
        .find(className => className !== 'pr-matrix-row' && className !== 'mod-dropdown');
}
function extractMatchPath(rowHtml) {
    const match = rowHtml.match(/<a href="([^"]+)"/i);
    return match?.[1];
}
function normalizeMatchPath(pathOrUrl) {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        return new URL(pathOrUrl).pathname + new URL(pathOrUrl).search;
    }
    return pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
}
function extractRowResult(rowHtml) {
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
function extractPickedAgents(rowHtml, headerAgentKeys, pickedClassName) {
    const dataCellClasses = extractCellClasses(rowHtml).slice(2);
    return headerAgentKeys
        .filter((agentKey, index) => dataCellClasses[index]?.includes(pickedClassName)
        && !agentKey.startsWith('unknown:'))
        .filter((agentKey, index, agentKeys) => agentKeys.indexOf(agentKey) === index);
}
function isWithinWindow(event, nowTime, cutoffTime) {
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
function getPrioritizedUnresolvedPaths(unresolvedPaths, compositions, now, recentDays, maxLookups) {
    const approximatePlayedAtByPath = new Map();
    const recentCutoff = new Date(now);
    recentCutoff.setUTCDate(recentCutoff.getUTCDate() - recentDays);
    const recentCutoffIso = recentCutoff.toISOString();
    for (const composition of compositions) {
        const normalizedPath = normalizeMatchPath(composition.matchPageTitle);
        const currentValue = approximatePlayedAtByPath.get(normalizedPath);
        if (!currentValue || composition.playedAt > currentValue) {
            approximatePlayedAtByPath.set(normalizedPath, composition.playedAt);
        }
    }
    const sortedPaths = unresolvedPaths
        .slice()
        .sort((left, right) => (approximatePlayedAtByPath.get(right) ?? '').localeCompare(approximatePlayedAtByPath.get(left) ?? '')
        || left.localeCompare(right));
    const recentPaths = sortedPaths.filter(path => (approximatePlayedAtByPath.get(path) ?? '') >= recentCutoffIso);
    const olderPaths = sortedPaths.filter(path => (approximatePlayedAtByPath.get(path) ?? '') < recentCutoffIso);
    return [...recentPaths, ...olderPaths].slice(0, maxLookups);
}
class VlrHttpClient {
    options;
    http;
    nextRequestAt = 0;
    constructor(options) {
        this.options = options;
        this.http = axios.create({
            baseURL: options.baseUrl,
            timeout: 30000,
            headers: {
                'User-Agent': 'gpu-search/0.1',
            },
        });
    }
    async waitForRateWindow() {
        const waitMs = this.nextRequestAt - Date.now();
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
    async fetchHtml(pathOrUrl) {
        await this.waitForRateWindow();
        try {
            const response = await this.http.get(pathOrUrl, {
                responseType: 'text',
            });
            return response.data;
        }
        finally {
            this.nextRequestAt = Date.now() + this.options.minRequestIntervalMs;
        }
    }
}
export class VlrValorantCompositionProvider {
    options;
    name = 'vlr';
    client;
    constructor(options) {
        this.options = options;
        this.client = new VlrHttpClient(options);
    }
    async discoverEventCards(now, windowDays) {
        const relevantYears = getRelevantYears(now, windowDays);
        const cardsById = new Map();
        for (let page = 1; page <= this.options.maxEventPages; page += 1) {
            const path = page === 1 ? '/events' : `/events/?page=${page}`;
            const html = await this.client.fetchHtml(path);
            const cards = extractVlrEventCards(html, this.options.baseUrl);
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
    async resolveMissingMatchReferences(cachedMatchReferenceByPath, unresolvedPaths, warnings) {
        const resolvedMatchReferenceByPath = new Map(cachedMatchReferenceByPath);
        for (const path of unresolvedPaths) {
            try {
                const html = await this.client.fetchHtml(path);
                const playedAt = extractMatchTimestampFromPage(html);
                if (!playedAt) {
                    warnings.push(`Kein exakter Match-Zeitstempel gefunden für ${path}`);
                    continue;
                }
                resolvedMatchReferenceByPath.set(path, {
                    path,
                    playedAt,
                    fetchedAt: new Date().toISOString(),
                });
            }
            catch (error) {
                warnings.push(`Match-Zeit für ${path} konnte nicht geladen werden`);
                logger.warn({ error, path }, 'valorant match timestamp lookup failed');
            }
        }
        return resolvedMatchReferenceByPath;
    }
    async importData(options) {
        const cutoff = new Date(options.now);
        cutoff.setUTCDate(cutoff.getUTCDate() - options.windowDays);
        const cards = await this.discoverEventCards(options.now, options.windowDays);
        const cachedMatchReferenceByPath = new Map(options.existingMatchReferences.map(matchReference => [normalizeMatchPath(matchReference.path), matchReference]));
        const sourceEvents = [];
        const compositions = [];
        const warnings = [];
        const usedMatchPaths = new Set();
        for (const card of cards) {
            const html = await this.client.fetchHtml(card.agentsUrl);
            const parsed = parseVlrEventImport(card, html, options.now);
            warnings.push(...parsed.warnings);
            if (!parsed.event
                || !isWithinWindow(parsed.event, options.now.getTime(), cutoff.getTime())
                || parsed.compositions.length === 0) {
                continue;
            }
            sourceEvents.push(parsed.event);
            compositions.push(...parsed.compositions);
            for (const matchPath of parsed.matchPaths) {
                usedMatchPaths.add(matchPath);
            }
        }
        const unresolvedPaths = [...usedMatchPaths].filter(path => !cachedMatchReferenceByPath.has(path));
        const selectedUnresolvedPaths = getPrioritizedUnresolvedPaths(unresolvedPaths, compositions, options.now, this.options.recentMatchDays, this.options.maxMatchTimestampLookups);
        if (selectedUnresolvedPaths.length < unresolvedPaths.length) {
            warnings.push(`Exakte Match-Zeiten werden schrittweise nachgeladen (${selectedUnresolvedPaths.length}/${unresolvedPaths.length} in diesem Sync)`);
        }
        const resolvedMatchReferenceByPath = await this.resolveMissingMatchReferences(cachedMatchReferenceByPath, selectedUnresolvedPaths, warnings);
        const matchReferences = [...usedMatchPaths]
            .map(path => resolvedMatchReferenceByPath.get(path))
            .filter((matchReference) => Boolean(matchReference))
            .sort((left, right) => right.playedAt.localeCompare(left.playedAt)
            || left.path.localeCompare(right.path));
        const playableStatusByEventId = new Map(sourceEvents.map(event => [event.id, event.status]));
        for (const composition of compositions) {
            const matchReference = resolvedMatchReferenceByPath.get(normalizeMatchPath(composition.matchPageTitle));
            if (matchReference) {
                composition.playedAt = matchReference.playedAt;
            }
            composition.eventStatus = composition.sourceEventId
                ? playableStatusByEventId.get(composition.sourceEventId)
                : composition.eventStatus;
        }
        logger.info({
            provider: this.name,
            discoveredEvents: cards.length,
            importedEvents: sourceEvents.length,
            parsedCompositions: compositions.length,
            warnings: warnings.length,
        }, 'valorant provider import completed');
        return {
            provider: this.name,
            sourceEvents,
            matchReferences,
            compositions: compositions.sort((left, right) => right.playedAt.localeCompare(left.playedAt)
                || left.mapName.localeCompare(right.mapName)
                || left.id.localeCompare(right.id)),
            warnings: [...new Set(warnings)].slice(0, 25),
        };
    }
}
