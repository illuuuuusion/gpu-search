import { VALORANT_AGENTS } from '../config/agents.js';
import { VALORANT_MAPS } from '../config/maps.js';
const AGENT_BY_KEY = new Map(VALORANT_AGENTS.map(agent => [agent.key, agent]));
const MAP_BY_KEY = new Map(VALORANT_MAPS.map(map => [map.key, map]));
function buildMapAgentRates(state) {
    const rates = new Map();
    for (const composition of state.compositions) {
        const entry = rates.get(composition.mapName) ?? {
            total: 0,
            countByAgent: new Map(),
        };
        entry.total += 1;
        for (const agentKey of composition.agents) {
            entry.countByAgent.set(agentKey, (entry.countByAgent.get(agentKey) ?? 0) + 1);
        }
        rates.set(composition.mapName, entry);
    }
    return rates;
}
export function summarizeMetaChanges(previousState, nextState) {
    const previousRates = buildMapAgentRates(previousState);
    const nextRates = buildMapAgentRates(nextState);
    const changes = [];
    for (const [mapKey, nextMapRate] of nextRates) {
        if (nextMapRate.total < 8) {
            continue;
        }
        const previousMapRate = previousRates.get(mapKey);
        if (!previousMapRate || previousMapRate.total < 8) {
            continue;
        }
        for (const [agentKey, nextCount] of nextMapRate.countByAgent) {
            const previousCount = previousMapRate.countByAgent.get(agentKey) ?? 0;
            const nextRate = nextCount / nextMapRate.total;
            const previousRate = previousCount / previousMapRate.total;
            const delta = nextRate - previousRate;
            if (Math.abs(delta) < 0.04) {
                continue;
            }
            changes.push({
                label: `${MAP_BY_KEY.get(mapKey)?.displayName ?? mapKey}: ${AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey} ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`,
                delta,
            });
        }
    }
    return changes
        .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
        .slice(0, 3)
        .map(change => change.label);
}
