import { randomUUID } from 'node:crypto';
import { VALORANT_AGENTS } from '../config/agents.js';
import { VALORANT_MAPS } from '../config/maps.js';
import type {
  CompBuilderAction,
  CompBuilderAgentOption,
  CompBuilderRecommendedComposition,
  CompBuilderRoleOption,
  CompBuilderSnapshot,
  FullCompositionAggregate,
  ValorantAgentRole,
} from '../domain/models.js';
import { FileValorantRepository } from '../storage/fileRepository.js';

const ROLE_ORDER: ValorantAgentRole[] = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
const MIN_RECOMMENDED_SAMPLE_GAMES = 3;

interface CompBuilderSession {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  selectedMapKey?: string;
  selectedRole?: ValorantAgentRole;
  selectedAgentKeys: string[];
}

const AGENT_BY_KEY = new Map(VALORANT_AGENTS.map(agent => [agent.key, agent]));
const MAP_BY_KEY = new Map(VALORANT_MAPS.map(map => [map.key, map]));

function sortAgentKeysForDisplay(agentKeys: string[]): string[] {
  return [...agentKeys].sort((left, right) => {
    const leftAgent = AGENT_BY_KEY.get(left);
    const rightAgent = AGENT_BY_KEY.get(right);
    const leftRoleIndex = leftAgent ? ROLE_ORDER.indexOf(leftAgent.role) : ROLE_ORDER.length;
    const rightRoleIndex = rightAgent ? ROLE_ORDER.indexOf(rightAgent.role) : ROLE_ORDER.length;

    return leftRoleIndex - rightRoleIndex
      || (leftAgent?.displayName ?? left).localeCompare(rightAgent?.displayName ?? right);
  });
}

function createRecommendedComposition(aggregate: FullCompositionAggregate): CompBuilderRecommendedComposition {
  const orderedAgentKeys = sortAgentKeysForDisplay(aggregate.agentKeys);
  return {
    id: aggregate.id,
    agentKeys: orderedAgentKeys,
    agentDisplayNames: orderedAgentKeys.map(agentKey => AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey),
    games: aggregate.games,
    wins: aggregate.wins,
    rawWinRate: aggregate.rawWinRate,
    smoothedWinRate: aggregate.smoothedWinRate,
  };
}

export class CompBuilderService {
  private readonly sessions = new Map<string, CompBuilderSession>();

  constructor(
    private readonly repository: FileValorantRepository,
    private readonly sessionTtlMinutes: number,
  ) {}

  private purgeExpiredSessions(now = Date.now()): void {
    for (const [sessionId, session] of this.sessions) {
      if (new Date(session.expiresAt).getTime() <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private createSession(userId: string): CompBuilderSession {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setUTCMinutes(expiresAt.getUTCMinutes() + this.sessionTtlMinutes);

    const session: CompBuilderSession = {
      id: randomUUID(),
      userId,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      selectedAgentKeys: [],
    };

    this.sessions.set(session.id, session);
    return session;
  }

  private touchSession(session: CompBuilderSession): void {
    const updatedAt = new Date();
    const expiresAt = new Date(updatedAt);
    expiresAt.setUTCMinutes(expiresAt.getUTCMinutes() + this.sessionTtlMinutes);
    session.updatedAt = updatedAt.toISOString();
    session.expiresAt = expiresAt.toISOString();
  }

  private getCandidateAggregates(aggregates: FullCompositionAggregate[], session: CompBuilderSession): FullCompositionAggregate[] {
    if (!session.selectedMapKey) {
      return [];
    }

    return aggregates.filter(aggregate =>
      aggregate.mapName === session.selectedMapKey
      && session.selectedAgentKeys.every(agentKey => aggregate.agentKeys.includes(agentKey)),
    );
  }

  private buildSnapshotFromSession(
    session: CompBuilderSession,
    aggregates: FullCompositionAggregate[],
  ): CompBuilderSnapshot {
    const availableMaps = [...new Map(
      aggregates.map(aggregate => [
        aggregate.mapName,
        {
          key: aggregate.mapName,
          displayName: MAP_BY_KEY.get(aggregate.mapName)?.displayName ?? aggregate.mapName,
          aggregateCount: aggregates.filter(candidate => candidate.mapName === aggregate.mapName).length,
        },
      ]),
    ).values()].sort((left, right) => left.displayName.localeCompare(right.displayName));

    const candidateAggregates = this.getCandidateAggregates(aggregates, session);
    const rankingAggregates = candidateAggregates.some(aggregate => aggregate.games >= MIN_RECOMMENDED_SAMPLE_GAMES)
      ? candidateAggregates.filter(aggregate => aggregate.games >= MIN_RECOMMENDED_SAMPLE_GAMES)
      : candidateAggregates;
    const availableRoles: CompBuilderRoleOption[] = [];
    const candidateAgents: CompBuilderAgentOption[] = [];

    if (session.selectedMapKey) {
      const roleCounts = new Map<ValorantAgentRole, Set<string>>();

      for (const aggregate of rankingAggregates) {
        for (const agentKey of aggregate.agentKeys) {
          if (session.selectedAgentKeys.includes(agentKey)) {
            continue;
          }

          const agent = AGENT_BY_KEY.get(agentKey);
          if (!agent) {
            continue;
          }

          const roleAgents = roleCounts.get(agent.role) ?? new Set<string>();
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
        const statsByAgent = new Map<string, CompBuilderAgentOption>();

        for (const aggregate of rankingAggregates) {
          for (const agentKey of aggregate.agentKeys) {
            if (session.selectedAgentKeys.includes(agentKey)) {
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

        candidateAgents.push(...[...statsByAgent.values()].sort((left, right) =>
          right.bestSmoothedWinRate - left.bestSmoothedWinRate
            || right.supportingGames - left.supportingGames
            || left.displayName.localeCompare(right.displayName),
        ));
      }
    }

    const topCompositions = rankingAggregates
      .slice()
      .sort((left, right) =>
        right.smoothedWinRate - left.smoothedWinRate
          || right.games - left.games
          || right.lastPlayedAt.localeCompare(left.lastPlayedAt),
      )
      .slice(0, 5)
      .map(createRecommendedComposition);

    const completed = session.selectedAgentKeys.length === 5;
    const exactAggregate = completed
      ? candidateAggregates.find(aggregate =>
          aggregate.agentKeys.length === 5
          && aggregate.agentKeys.every(agentKey => session.selectedAgentKeys.includes(agentKey)),
        )
      : undefined;

    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      selectedMapKey: session.selectedMapKey,
      selectedRole: session.selectedRole,
      selectedAgentKeys: session.selectedAgentKeys,
      selectedAgentDisplayNames: session.selectedAgentKeys.map(agentKey => AGENT_BY_KEY.get(agentKey)?.displayName ?? agentKey),
      availableMaps,
      availableRoles,
      candidateAgents: candidateAgents.slice(0, 25),
      topCompositions,
      exactComposition: exactAggregate ? createRecommendedComposition(exactAggregate) : undefined,
      completed,
    };
  }

  async startSession(userId: string): Promise<CompBuilderSnapshot> {
    this.purgeExpiredSessions();
    const session = this.createSession(userId);
    const state = await this.repository.load();
    return this.buildSnapshotFromSession(session, state.fullCompositionAggregates);
  }

  async applyAction(userId: string, sessionId: string, action: CompBuilderAction): Promise<CompBuilderSnapshot | null> {
    this.purgeExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }

    const state = await this.repository.load();
    const aggregates = state.fullCompositionAggregates;
    const currentSnapshot = this.buildSnapshotFromSession(session, aggregates);

    switch (action.type) {
      case 'set_map': {
        if (!currentSnapshot.availableMaps.some(map => map.key === action.mapKey)) {
          return currentSnapshot;
        }

        session.selectedMapKey = action.mapKey;
        session.selectedRole = undefined;
        session.selectedAgentKeys = [];
        break;
      }
      case 'set_role': {
        if (!currentSnapshot.availableRoles.some(role => role.role === action.role)) {
          return currentSnapshot;
        }

        session.selectedRole = action.role;
        break;
      }
      case 'pick_agent': {
        if (!currentSnapshot.candidateAgents.some(agent => agent.key === action.agentKey)) {
          return currentSnapshot;
        }

        if (!session.selectedAgentKeys.includes(action.agentKey)) {
          session.selectedAgentKeys = [...session.selectedAgentKeys, action.agentKey];
        }
        session.selectedRole = undefined;
        break;
      }
      case 'back': {
        if (session.selectedRole) {
          session.selectedRole = undefined;
        } else if (session.selectedAgentKeys.length > 0) {
          session.selectedAgentKeys = session.selectedAgentKeys.slice(0, -1);
        } else if (session.selectedMapKey) {
          session.selectedMapKey = undefined;
        }
        break;
      }
      case 'reset': {
        session.selectedMapKey = undefined;
        session.selectedRole = undefined;
        session.selectedAgentKeys = [];
        break;
      }
      default:
        break;
    }

    this.touchSession(session);
    return this.buildSnapshotFromSession(session, aggregates);
  }
}
