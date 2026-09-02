import type { DiscordRuntime } from '../runtime/discordRuntime.js';
import type { AuditLog } from './auditLog.js';
import type { ApprovalService } from './approvalService.js';
import type { RequestContext, RequestContextStore } from './requestContextStore.js';
import { classifyTool, evaluateTool, type RiskClass } from './toolPolicy.js';

export interface ToolHandlerInput {
  args: Record<string, unknown>;
  context: RequestContext;
  guildId: string;
  runtime: DiscordRuntime;
}

export type ToolHandler = (input: ToolHandlerInput) => Promise<unknown>;

export type ToolExecutionResult =
  | { status: 'ok'; result: unknown }
  | { status: 'denied'; reason: string }
  | { status: 'approval_required'; approvalId: string; risk: RiskClass };

export interface AdminToolExecutorOptions {
  runtime: DiscordRuntime;
  contexts: RequestContextStore;
  approvals: ApprovalService;
  audit: AuditLog;
  guildId: string;
  destructiveToolsEnabled: boolean;
  // Freigabe-Vorschau an einen Owner zustellen (Phase 3: DM mit Buttons).
  requestApproval?: (input: {
    approvalId: string;
    toolName: string;
    args: Record<string, unknown>;
    context: RequestContext;
  }) => Promise<void>;
}

// Argumente, die die serverseitige Identitaet ueberschreiben wuerden. Sie werden
// verworfen, nicht abgelehnt -- das Modell soll sie schlicht nicht setzen koennen.
const RESERVED_ARG_KEYS = new Set(['guild_id', 'guildId', 'actor', 'actorUserId', 'userId', 'requestId', 'approvalId']);

export class AdminToolExecutor {
  private readonly handlers = new Map<string, ToolHandler>();

  constructor(private readonly options: AdminToolExecutorOptions) {}

  // Registrierung ist die Sichtbarkeitsgrenze: was hier nicht steht, existiert
  // fuer Claude nicht. Destruktive Tools bleiben ohne Feature-Flag aussen vor.
  register(toolName: string, handler: ToolHandler): void {
    const risk = classifyTool(toolName);
    if (!risk) {
      throw new Error(`cannot register unclassified tool: ${toolName}`);
    }
    if (risk === 'destructive' && !this.options.destructiveToolsEnabled) {
      throw new Error(`destructive tool requires AI_DESTRUCTIVE_TOOLS_ENABLED: ${toolName}`);
    }
    this.handlers.set(toolName, handler);
  }

  get registeredTools(): string[] {
    return [...this.handlers.keys()];
  }

  async execute(request: {
    toolName: string;
    args?: Record<string, unknown>;
    requestId: string;
    approvalId?: string;
  }): Promise<ToolExecutionResult> {
    const { toolName, requestId, approvalId } = request;
    const args = this.sanitizeArgs(request.args);

    const context = this.options.contexts.get(requestId);
    if (!context) {
      return this.deny(toolName, 'unknown or expired request context', { requestId });
    }

    const decision = evaluateTool(toolName, { destructiveToolsEnabled: this.options.destructiveToolsEnabled });
    if (!decision.allow) {
      return this.deny(toolName, decision.reason, { requestId, context });
    }

    const handler = this.handlers.get(toolName);
    if (!handler) {
      return this.deny(toolName, `tool is not registered: ${toolName}`, { requestId, context });
    }

    if (decision.requiresApproval) {
      if (!approvalId) {
        const approval = this.options.approvals.request({ toolName, args, context });
        await this.options.audit.record({
          event: 'tool_approval_requested',
          requestId,
          actorUserId: context.userId,
          guildId: this.options.guildId,
          toolName,
          approvalId: approval.approvalId,
          args,
        });
        await this.options.requestApproval?.({ approvalId: approval.approvalId, toolName, args, context });
        return { status: 'approval_required', approvalId: approval.approvalId, risk: decision.risk };
      }

      const consumed = this.options.approvals.consume(approvalId, toolName, args);
      if (!consumed.ok) {
        return this.deny(toolName, consumed.reason, { requestId, context, approvalId });
      }
    }

    // Guild kommt immer aus der Konfiguration, nie aus den Toolargumenten.
    const result = await handler({ args, context, guildId: this.options.guildId, runtime: this.options.runtime });
    await this.options.audit.record({
      event: 'tool_executed',
      requestId,
      actorUserId: context.userId,
      guildId: this.options.guildId,
      toolName,
      decision: decision.risk,
      approvalId,
      args,
    });
    return { status: 'ok', result };
  }

  private sanitizeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(args ?? {}).filter(([key]) => !RESERVED_ARG_KEYS.has(key)),
    );
  }

  private async deny(
    toolName: string,
    reason: string,
    meta: { requestId: string; context?: RequestContext; approvalId?: string },
  ): Promise<ToolExecutionResult> {
    await this.options.audit.record({
      event: 'tool_denied',
      requestId: meta.requestId,
      actorUserId: meta.context?.userId,
      guildId: this.options.guildId,
      toolName,
      reason,
      approvalId: meta.approvalId,
    });
    return { status: 'denied', reason };
  }
}
