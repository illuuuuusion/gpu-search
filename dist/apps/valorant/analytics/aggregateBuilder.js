const WIN_RATE_PRIOR = 0.5;
const WIN_RATE_PRIOR_GAMES = 12;
function sortAgentKeys(agentKeys) {
    return [...new Set(agentKeys)].sort((left, right) => left.localeCompare(right));
}
function buildAggregateId(mapName, agentKeys) {
    return `${mapName}:${sortAgentKeys(agentKeys).join('|')}`;
}
export function buildFullCompositionAggregates(compositions) {
    const aggregates = new Map();
    for (const composition of compositions) {
        const sortedAgents = sortAgentKeys(composition.agents);
        if (sortedAgents.length !== 5) {
            continue;
        }
        const id = buildAggregateId(composition.mapName, sortedAgents);
        const existing = aggregates.get(id);
        if (!existing) {
            aggregates.set(id, {
                id,
                mapName: composition.mapName,
                agentKeys: sortedAgents,
                games: 1,
                wins: composition.won ? 1 : 0,
                rawWinRate: composition.won ? 1 : 0,
                smoothedWinRate: 0,
                lastPlayedAt: composition.playedAt,
                scopes: [composition.scope],
                exampleTeams: [composition.teamName],
            });
            continue;
        }
        existing.games += 1;
        existing.wins += composition.won ? 1 : 0;
        if (new Date(composition.playedAt).getTime() > new Date(existing.lastPlayedAt).getTime()) {
            existing.lastPlayedAt = composition.playedAt;
        }
        if (!existing.scopes.includes(composition.scope)) {
            existing.scopes.push(composition.scope);
        }
        if (!existing.exampleTeams.includes(composition.teamName) && existing.exampleTeams.length < 3) {
            existing.exampleTeams.push(composition.teamName);
        }
    }
    return [...aggregates.values()]
        .map(aggregate => {
        const rawWinRate = aggregate.games > 0 ? aggregate.wins / aggregate.games : 0;
        const smoothedWinRate = (aggregate.wins + WIN_RATE_PRIOR * WIN_RATE_PRIOR_GAMES) / (aggregate.games + WIN_RATE_PRIOR_GAMES);
        return {
            ...aggregate,
            rawWinRate,
            smoothedWinRate,
        };
    })
        .sort((left, right) => right.smoothedWinRate - left.smoothedWinRate
        || right.games - left.games
        || left.mapName.localeCompare(right.mapName)
        || left.id.localeCompare(right.id));
}
