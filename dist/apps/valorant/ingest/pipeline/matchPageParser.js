import { VALORANT_AGENTS } from '../../config/agents.js';
import { VALORANT_MAPS } from '../../config/maps.js';
const MAX_MAPS_PER_MATCH = 5;
const TEAM_SLOTS = [1, 2];
const AGENT_SLOTS = [1, 2, 3, 4, 5];
const AGENT_ALIAS_INDEX = new Map();
for (const agent of VALORANT_AGENTS) {
    AGENT_ALIAS_INDEX.set(normalizeLookupKey(agent.displayName), agent.key);
    for (const alias of agent.aliases) {
        AGENT_ALIAS_INDEX.set(normalizeLookupKey(alias), agent.key);
    }
}
const MAP_ALIAS_INDEX = new Map();
for (const map of VALORANT_MAPS) {
    MAP_ALIAS_INDEX.set(normalizeLookupKey(map.displayName), map.key);
    for (const alias of map.aliases) {
        MAP_ALIAS_INDEX.set(normalizeLookupKey(alias), map.key);
    }
}
function normalizeLookupKey(value) {
    return value
        .toLowerCase()
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{!}}/g, '|')
        .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}
function stripWikiMarkup(value) {
    return value
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\{\{!}}/g, '|')
        .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
        .replace(/\{\{[^{}]*\|([^{}|]+)\}\}/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeAgentKey(rawValue) {
    if (!rawValue) {
        return undefined;
    }
    return AGENT_ALIAS_INDEX.get(normalizeLookupKey(rawValue));
}
function normalizeMapKey(rawValue) {
    if (!rawValue) {
        return undefined;
    }
    return MAP_ALIAS_INDEX.get(normalizeLookupKey(rawValue));
}
function isUnplayedMapValue(rawValue) {
    if (!rawValue) {
        return true;
    }
    const value = stripWikiMarkup(rawValue).toLowerCase();
    return value === '' || value === 'tbd' || value === '-' || value === 'default';
}
function parseTemplateParameters(wikitext) {
    const parameters = new Map();
    for (const line of wikitext.split('\n')) {
        if (!line.trimStart().startsWith('|')) {
            continue;
        }
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }
        const rawKey = line.slice(1, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        if (!rawKey) {
            continue;
        }
        parameters.set(rawKey.toLowerCase(), rawValue);
    }
    return parameters;
}
function parseWinner(rawValue, teamSlot, scoreValue) {
    const winnerValue = stripWikiMarkup(rawValue ?? '').toLowerCase();
    if (winnerValue === String(teamSlot)) {
        return true;
    }
    if (winnerValue === String(teamSlot === 1 ? 2 : 1)) {
        return false;
    }
    const scoreMatch = /^(\d+)\s*[-:]\s*(\d+)$/.exec(stripWikiMarkup(scoreValue ?? ''));
    if (!scoreMatch) {
        return false;
    }
    const leftScore = Number(scoreMatch[1]);
    const rightScore = Number(scoreMatch[2]);
    return teamSlot === 1 ? leftScore > rightScore : rightScore > leftScore;
}
function parseTeamAgents(parameters, mapIndex, teamSlot) {
    const agents = AGENT_SLOTS
        .map(agentSlot => normalizeAgentKey(parameters.get(`map${mapIndex}t${teamSlot}a${agentSlot}`)))
        .filter((agent) => Boolean(agent));
    return [...new Set(agents)];
}
function readTeamName(parameters, cachedMatchPage, teamSlot) {
    const directValue = stripWikiMarkup(parameters.get(teamSlot === 1 ? 'team1' : 'team2')
        ?? parameters.get(teamSlot === 1 ? 'opponent1' : 'opponent2')
        ?? '');
    if (directValue) {
        return directValue;
    }
    return stripWikiMarkup(teamSlot === 1 ? cachedMatchPage.teamOneName ?? '' : cachedMatchPage.teamTwoName ?? '') || undefined;
}
export function parseCompositionsFromMatchPage(cachedMatchPage, rawArtifact) {
    const parameters = parseTemplateParameters(rawArtifact.content);
    const playedAt = cachedMatchPage.playedAt ?? rawArtifact.capturedAt;
    const compositions = [];
    for (let mapIndex = 1; mapIndex <= MAX_MAPS_PER_MATCH; mapIndex += 1) {
        const rawMapValue = parameters.get(`map${mapIndex}`);
        if (isUnplayedMapValue(rawMapValue)) {
            continue;
        }
        const mapKey = normalizeMapKey(rawMapValue);
        if (!mapKey) {
            continue;
        }
        const scoreValue = parameters.get(`map${mapIndex}score`);
        const teamOneName = readTeamName(parameters, cachedMatchPage, 1);
        const teamTwoName = readTeamName(parameters, cachedMatchPage, 2);
        for (const teamSlot of TEAM_SLOTS) {
            const agents = parseTeamAgents(parameters, mapIndex, teamSlot);
            const teamName = teamSlot === 1 ? teamOneName : teamTwoName;
            if (!teamName || agents.length !== 5) {
                continue;
            }
            compositions.push({
                id: `${cachedMatchPage.title}#map${mapIndex}#team${teamSlot}`,
                matchPageTitle: cachedMatchPage.title,
                mapName: mapKey,
                teamName,
                agents,
                won: parseWinner(parameters.get(`map${mapIndex}win`), teamSlot, scoreValue),
                playedAt,
                scope: cachedMatchPage.scope,
            });
        }
    }
    return compositions;
}
