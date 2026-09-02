import crypto from 'node:crypto';
import type { RequestContext } from './requestContextStore.js';

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';

export interface ApprovalRecord {
  readonly approvalId: string;
  readonly argumentHash: string;
  readonly toolName: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly guildId: string;
  readonly expiresAt: number;
  state: ApprovalState;
  approvedBy?: string;
}

export type ApprovalResult = { ok: true; approval: ApprovalRecord } | { ok: false; reason: string };

// Kanonisches JSON: Schluessel sortiert, damit derselbe Aufruf immer denselben
// Hash ergibt und eine Freigabe nicht fuer geaenderte Argumente gilt.
export function normalizeArguments(args: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return value;
  };

  return JSON.stringify(normalize(args ?? {}));
}

export function hashToolCall(toolName: string, args: unknown): string {
  return crypto.createHash('sha256').update(`${toolName}\n${normalizeArguments(args)}`).digest('hex');
}

// ponytail: rein im Speicher. Das ist die gewuenschte Semantik -- ein Neustart
// verwirft offene Freigaben (Plan Phase 5.3), statt sie wiederzubeleben.
export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();

  constructor(
    private readonly options: { ttlSeconds: number; ownerUserIds: Set<string> },
    private readonly now: () => number = Date.now,
  ) {}

  request(input: { toolName: string; args: unknown; context: RequestContext }): ApprovalRecord {
    const approval: ApprovalRecord = {
      approvalId: crypto.randomUUID(),
      argumentHash: hashToolCall(input.toolName, input.args),
      toolName: input.toolName,
      requestId: input.context.requestId,
      actorUserId: input.context.userId,
      guildId: input.context.guildId,
      expiresAt: this.now() + this.options.ttlSeconds * 1000,
      state: 'pending',
    };
    this.approvals.set(approval.approvalId, approval);
    return approval;
  }

  approve(approvalId: string, approverUserId: string): ApprovalResult {
    const approval = this.load(approvalId);
    if (!approval.ok) {
      return approval;
    }

    // Wer die Aktion angestossen hat, darf sie nicht selbst freigeben -- ausser
    // der Account steht ohnehin in AI_OWNER_USER_IDS.
    if (!this.options.ownerUserIds.has(approverUserId)) {
      return { ok: false, reason: 'approver is not an owner' };
    }

    approval.approval.state = 'approved';
    approval.approval.approvedBy = approverUserId;
    return approval;
  }

  deny(approvalId: string, approverUserId: string): ApprovalResult {
    const approval = this.load(approvalId);
    if (!approval.ok) {
      return approval;
    }

    if (!this.options.ownerUserIds.has(approverUserId)) {
      return { ok: false, reason: 'approver is not an owner' };
    }

    approval.approval.state = 'denied';
    return approval;
  }

  // Einmalig: nach `consume` ist die Freigabe verbraucht und kann nicht erneut
  // fuer denselben oder einen abgewandelten Aufruf verwendet werden.
  consume(approvalId: string, toolName: string, args: unknown): ApprovalResult {
    const loaded = this.load(approvalId);
    if (!loaded.ok) {
      return loaded;
    }

    const approval = loaded.approval;
    if (approval.state !== 'approved') {
      return { ok: false, reason: `approval is ${approval.state}` };
    }

    if (approval.argumentHash !== hashToolCall(toolName, args)) {
      return { ok: false, reason: 'approval does not match tool arguments' };
    }

    approval.state = 'consumed';
    return { ok: true, approval };
  }

  get(approvalId: string): ApprovalRecord | undefined {
    return this.approvals.get(approvalId);
  }

  private load(approvalId: string): ApprovalResult {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      return { ok: false, reason: 'unknown approval' };
    }

    if (approval.expiresAt <= this.now() && approval.state !== 'consumed') {
      approval.state = 'expired';
    }

    if (approval.state === 'expired') {
      return { ok: false, reason: 'approval expired' };
    }

    if (approval.state === 'consumed') {
      return { ok: false, reason: 'approval already used' };
    }

    if (approval.state === 'denied') {
      return { ok: false, reason: 'approval denied' };
    }

    return { ok: true, approval };
  }
}
