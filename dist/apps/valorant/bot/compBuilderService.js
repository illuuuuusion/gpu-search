import { randomUUID } from 'node:crypto';
import { VALORANT_AGENTS } from '../config/agents.js';
import { VALORANT_MAPS } from '../config/maps.js';
import { buildFilteredAggregates, getConfidenceLabel, getEventNamesFromIds, getRoleForAgent } from '../query/insightsService.js';
const ROLE_ORDER = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
const MIN_RECOMMENDED_SAMPLE_GAMES = 3;
const AGENT_BY_KEY = new Map(VALORANT_AGENTS.map(agent => [agent.key, agent]));
const MAP_BY_KEY = new Map(VALORANT_MAPS.map(map => [map.key, map]));
function sortAgentKeysForDisplay(agentKeys) {
    return [...agentKeys].sort((left, right) => {
        const leftAgent = AGENT_BY_KEY.get(left);
        const rightAgent = AGENT_BY_KEY.get(right);
        const leftRoleIndex = leftAgent ? ROLE_ORDER.indexOf(leftAgent.role) : ROLE_ORDER.length;
        const rightRoleIndex = rightAgent ? ROLE_ORDER.indexOf(rightAgent.role) : ROLE_ORDER.length;
        return leftRoleIndex - rightRoleIndex
            || (leftAgent?.displayName ?? left).localeCompare(rightAgent?.displayName ?? right);
    });
}
function createRecommendedComposition(aggregate, state) {
    const orderedAgentKeys = sortAgentKeysForDisplay(aggregate.agentKeys);
    return {
        id: aggregate.id,
        agentKeys: orderedAgentKeys,
        agentDisplayNames: orderedAgentKeys.map(agentKey => AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey),
        games: aggregate.games,
        wins: aggregate.wins,
        rawWinRate: aggregate.rawWinRate,
        smoothedWinRate: aggregate.smoothedWinRate,
        confidenceLabel: getConfidenceLabel(aggregate.games),
        lastPlayedAt: aggregate.lastPlayedAt,
        exampleTeams: aggregate.exampleTeams,
        eventIds: aggregate.sourceEventIds,
        eventNames: getEventNamesFromIds(state.sourceEvents, aggregate.sourceEventIds).slice(0, 3),
        latestSourceUrl: aggregate.latestSourceUrl,
    };
}
function applySessionFilters(aggregates, session) {
    return aggregates.filter(aggregate => session.excludedAgentKeys.every(agentKey => !aggregate.agentKeys.includes(agentKey))
        && (session.selectedMapKey ? aggregate.mapName === session.selectedMapKey : true)
        && session.selectedAgentKeys.every(agentKey => aggregate.agentKeys.includes(agentKey)));
}
function buildPresetSummary(state, userId) {
    return state.builderPresets
        .filter(preset => preset.userId === userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 10)
        .map(preset => ({
        id: preset.id,
        name: preset.name,
        updatedAt: preset.updatedAt,
    }));
}
function buildDefaultSession(userId, sessionTtlMinutes, options) {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setUTCMinutes(expiresAt.getUTCMinutes() + sessionTtlMinutes);
    return {
        id: randomUUID(),
        userId,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        filters: options.filters,
        selectedAgentKeys: [],
        excludedAgentKeys: [],
    };
}
export class CompBuilderService {
    repository;
    insights;
    sessionTtlMinutes;
    sessions = new Map();
    constructor(repository, insights, sessionTtlMinutes) {
        this.repository = repository;
        this.insights = insights;
        this.sessionTtlMinutes = sessionTtlMinutes;
    }
    purgeExpiredSessions(now = Date.now()) {
        for (const [sessionId, session] of this.sessions) {
            if (new Date(session.expiresAt).getTime() <= now) {
                this.sessions.delete(sessionId);
            }
        }
    }
    touchSession(session) {
        const updatedAt = new Date();
        const expiresAt = new Date(updatedAt);
        expiresAt.setUTCMinutes(expiresAt.getUTCMinutes() + this.sessionTtlMinutes);
        session.updatedAt = updatedAt.toISOString();
        session.expiresAt = expiresAt.toISOString();
    }
    hydrateSessionFromPreset(session, preset) {
        if (!preset) {
            return;
        }
        session.filters = preset.filters;
        session.selectedMapKey = preset.selectedMapKey;
        session.selectedAgentKeys = [...preset.selectedAgentKeys];
        session.excludedAgentKeys = [...preset.excludedAgentKeys];
        session.selectedRole = undefined;
        session.replacementAgentKey = undefined;
    }
    getFilteredAggregates(state, session) {
        return buildFilteredAggregates(state, session.filters, new Date());
    }
    buildSnapshotFromSession(session, state) {
        const filteredAggregates = this.getFilteredAggregates(state, session);
        const availableMaps = [...new Map(filteredAggregates.map(aggregate => [
                aggregate.mapName,
                {
                    key: aggregate.mapName,
                    displayName: MAP_BY_KEY.get(aggregate.mapName)?.displayName ?? aggregate.mapName,
                    aggregateCount: filteredAggregates.filter(candidate => candidate.mapName === aggregate.mapName).length,
                },
            ])).values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
        const candidateAggregates = applySessionFilters(filteredAggregates, session);
        const rankingAggregates = candidateAggregates.some(aggregate => aggregate.games >= MIN_RECOMMENDED_SAMPLE_GAMES)
            ? candidateAggregates.filter(aggregate => aggregate.games >= MIN_RECOMMENDED_SAMPLE_GAMES)
            : candidateAggregates;
        const availableRoles = [];
        const candidateAgents = [];
        if (session.selectedMapKey) {
            const roleCounts = new Map();
            for (const aggregate of rankingAggregates) {
                for (const agentKey of aggregate.agentKeys) {
                    if (session.selectedAgentKeys.includes(agentKey)
                        || session.excludedAgentKeys.includes(agentKey)
                        || agentKey === session.replacementAgentKey) {
                        continue;
                    }
                    const agent = AGENT_BY_KEY.get(agentKey);
                    if (!agent) {
                        continue;
                    }
                    const roleAgents = roleCounts.get(agent.role) ?? new Set();
                    roleAgents.add(agentKey);
                    roleCounts.set(agent.role, roleAgents);
                }
            }
            for (const role of ROLE_ORDER) {
                const agents = roleCounts.get(role);
                if (!agents || agents.size === 0) {
                    continue;
                }
                availableRoles.push({
                    role,
                    agentCount: agents.size,
                });
            }
            if (session.selectedRole) {
                const statsByAgent = new Map();
                for (const aggregate of rankingAggregates) {
                    for (const agentKey of aggregate.agentKeys) {
                        if (session.selectedAgentKeys.includes(agentKey)
                            || session.excludedAgentKeys.includes(agentKey)
                            || agentKey === session.replacementAgentKey) {
                            continue;
                        }
                        const agent = AGENT_BY_KEY.get(agentKey);
                        if (!agent || agent.role !== session.selectedRole) {
                            continue;
                        }
                        const existing = statsByAgent.get(agentKey);
                        if (!existing) {
                            statsByAgent.set(agentKey, {
                                key: agentKey,
                                displayName: agent.displayName,
                                role: agent.role,
                                bestSmoothedWinRate: aggregate.smoothedWinRate,
                                supportingGames: aggregate.games,
                                supportingCompCount: 1,
                            });
                            continue;
                        }
                        existing.bestSmoothedWinRate = Math.max(existing.bestSmoothedWinRate, aggregate.smoothedWinRate);
                        existing.supportingGames += aggregate.games;
                        existing.supportingCompCount += 1;
                    }
                }
                candidateAgents.push(...[...statsByAgent.values()].sort((left, right) => right.bestSmoothedWinRate - left.bestSmoothedWinRate
                    || right.supportingGames - left.supportingGames
                    || left.displayName.localeCompare(right.displayName)));
            }
        }
        const topCompositions = rankingAggregates
            .slice()
            .sort((left, right) => right.smoothedWinRate - left.smoothedWinRate
            || right.games - left.games
            || right.lastPlayedAt.localeCompare(left.lastPlayedAt))
            .slice(0, 5)
            .map(aggregate => createRecommendedComposition(aggregate, state));
        const completed = session.selectedAgentKeys.length === 5;
        const exactAggregate = completed
            ? candidateAggregates.find(aggregate => aggregate.agentKeys.length === 5
                && aggregate.agentKeys.every(agentKey => session.selectedAgentKeys.includes(agentKey)))
            : undefined;
        return {
            sessionId: session.id,
            expiresAt: session.expiresAt,
            provider: state.metadata.provider,
            importedEvents: state.sourceEvents.length,
            lastSuccessfulSyncAt: state.metadata.lastSuccessfulSyncAt,
            healthState: state.metadata.healthState ?? 'healthy',
            selectedMapKey: session.selectedMapKey,
            selectedRole: session.selectedRole,
            selectedAgentKeys: session.selectedAgentKeys,
            selectedAgentDisplayNames: session.selectedAgentKeys.map(agentKey => AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey),
            excludedAgentKeys: session.excludedAgentKeys,
            excludedAgentDisplayNames: session.excludedAgentKeys.map(agentKey => AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey),
            filters: session.filters,
            availableMaps,
            availableRoles,
            candidateAgents: candidateAgents.slice(0, 25),
            topCompositions,
            exactComposition: exactAggregate ? createRecommendedComposition(exactAggregate, state) : undefined,
            savedPresets: buildPresetSummary(state, session.userId),
            replacementAgentKey: session.replacementAgentKey,
            completed,
        };
    }
    async persistPreset(session, name) {
        const presetName = name.trim();
        if (!presetName) {
            return;
        }
        const state = await this.repository.load();
        const existingPreset = state.builderPresets.find(preset => preset.userId === session.userId
            && preset.name.toLowerCase() === presetName.toLowerCase());
        const now = new Date().toISOString();
        const nextPreset = {
            id: existingPreset?.id ?? randomUUID(),
            userId: session.userId,
            name: presetName,
            createdAt: existingPreset?.createdAt ?? now,
            updatedAt: now,
            filters: session.filters,
            selectedMapKey: session.selectedMapKey,
            selectedAgentKeys: [...session.selectedAgentKeys],
            excludedAgentKeys: [...session.excludedAgentKeys],
        };
        const nextState = {
            ...state,
            builderPresets: [
                nextPreset,
                ...state.builderPresets.filter(preset => preset.id !== nextPreset.id),
            ].slice(0, 50),
        };
        await this.repository.save(nextState);
        this.insights.primeState(nextState);
    }
    async startSession(userId, options) {
        this.purgeExpiredSessions();
        const state = await this.insights.getState();
        const session = buildDefaultSession(userId, this.sessionTtlMinutes, options);
        if (options.presetId) {
            this.hydrateSessionFromPreset(session, state.builderPresets.find(preset => preset.id === options.presetId && preset.userId === userId));
        }
        this.sessions.set(session.id, session);
        return this.buildSnapshotFromSession(session, state);
    }
    async applyAction(userId, sessionId, action) {
        this.purgeExpiredSessions();
        const session = this.sessions.get(sessionId);
        if (!session || session.userId !== userId) {
            return null;
        }
        switch (action.type) {
            case 'save_preset':
                await this.persistPreset(session, action.name);
                break;
            case 'load_preset': {
                const state = await this.insights.getState();
                this.hydrateSessionFromPreset(session, state.builderPresets.find(preset => preset.id === action.presetId && preset.userId === userId));
                break;
            }
            case 'set_map':
                session.selectedMapKey = action.mapKey;
                session.selectedRole = undefined;
                session.selectedAgentKeys = [];
                session.excludedAgentKeys = [];
                session.replacementAgentKey = undefined;
                break;
            case 'set_role':
                session.selectedRole = action.role;
                break;
            case 'pick_agent':
                if (!session.selectedAgentKeys.includes(action.agentKey)) {
                    session.selectedAgentKeys = [...session.selectedAgentKeys, action.agentKey];
                }
                session.selectedRole = undefined;
                session.replacementAgentKey = undefined;
                break;
            case 'exclude_agent':
                if (!session.selectedAgentKeys.includes(action.agentKey)
                    && !session.excludedAgentKeys.includes(action.agentKey)) {
                    session.excludedAgentKeys = [...session.excludedAgentKeys, action.agentKey];
                }
                session.selectedRole = undefined;
                break;
            case 'include_agent':
                session.excludedAgentKeys = session.excludedAgentKeys.filter(agentKey => agentKey !== action.agentKey);
                break;
            case 'replace_agent':
                if (session.selectedAgentKeys.includes(action.agentKey)) {
                    session.selectedAgentKeys = session.selectedAgentKeys.filter(agentKey => agentKey !== action.agentKey);
                    session.replacementAgentKey = action.agentKey;
                    session.selectedRole = getRoleForAgent(action.agentKey);
                }
                break;
            case 'back':
                if (session.selectedRole) {
                    session.selectedRole = undefined;
                }
                else if (session.replacementAgentKey) {
                    session.selectedAgentKeys = [...session.selectedAgentKeys, session.replacementAgentKey];
                    session.replacementAgentKey = undefined;
                }
                else if (session.selectedAgentKeys.length > 0) {
                    session.selectedAgentKeys = session.selectedAgentKeys.slice(0, -1);
                }
                else if (session.excludedAgentKeys.length > 0) {
                    session.excludedAgentKeys = session.excludedAgentKeys.slice(0, -1);
                }
                else if (session.selectedMapKey) {
                    session.selectedMapKey = undefined;
                }
                break;
            case 'reset':
                session.selectedMapKey = undefined;
                session.selectedRole = undefined;
                session.selectedAgentKeys = [];
                session.excludedAgentKeys = [];
                session.replacementAgentKey = undefined;
                break;
            default:
                break;
        }
        this.touchSession(session);
        const state = await this.insights.getState();
        return this.buildSnapshotFromSession(session, state);
    }
}
