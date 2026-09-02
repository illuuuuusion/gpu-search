import type { z } from 'zod';
import type { DiscordRuntime } from '../runtime/discordRuntime.js';
import type { AuditLog } from './auditLog.js';
import type { ApprovalService } from './approvalService.js';
import type { RequestContext, RequestContextStore } from './requestContextStore.js';
import { classifyTool, evaluateTool, type RiskClass } from './toolPolicy.js';

export interface ToolCatalogEntry {
  name: string;
  risk: RiskClass;
  requiresApproval: boolean;
  args: string[];
}

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
  | { status: 'error'; message: string }
  | { status: 'approval_required'; approvalId: string; risk: RiskClass };

// Argument-Schema eines Tools. Es ist Teil der Policy, nicht des Handlers:
// Limits und Pflichtfelder werden geprueft, bevor Discord ueberhaupt gefragt wird.
export type ToolSchema = z.ZodType<Record<string, unknown>>;

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

// Argumente, mit denen sich das Modell als jemand anderes ausgeben wuerde. Der
// Auftraggeber kommt immer aus dem RequestContext, nie aus den Argumenten.
const RESERVED_ARG_KEYS = new Set(['actor', 'actorUserId', 'requestId', 'approvalId', 'guild_id', 'guildId']);
// Guild-Argumente sind kein Versehen, sondern ein Ausbruchsversuch -> harte Ablehnung.
const GUILD_ARG_KEYS = ['guild_id', 'guildId'] as const;

export class AdminToolExecutor {
  private readonly handlers = new Map<string, { handler: ToolHandler; schema?: ToolSchema }>();

  constructor(private readonly options: AdminToolExecutorOptions) {}

  // Registrierung ist die Sichtbarkeitsgrenze: was hier nicht steht, existiert
  // fuer Claude nicht. Destruktive Tools bleiben ohne Feature-Flag aussen vor.
  register(toolName: string, handler: ToolHandler, schema?: ToolSchema): void {
    const risk = classifyTool(toolName);
    if (!risk) {
      throw new Error(`cannot register unclassified tool: ${toolName}`);
    }
    if (risk === 'destructive' && !this.options.destructiveToolsEnabled) {
      throw new Error(`destructive tool requires AI_DESTRUCTIVE_TOOLS_ENABLED: ${toolName}`);
    }
    this.handlers.set(toolName, { handler, schema });
  }

  get registeredTools(): string[] {
    return [...this.handlers.keys()];
  }

  // Was der Sidecar Claude anbieten darf. Einzige Quelle der Wahrheit ist die
  // Registrierung hier -- der Sidecar fuehrt keine eigene Liste.
  get toolCatalog(): ToolCatalogEntry[] {
    return [...this.handlers.entries()].map(([name, entry]) => {
      const decision = evaluateTool(name, { destructiveToolsEnabled: this.options.destructiveToolsEnabled });
      const shape = (entry.schema as { shape?: Record<string, unknown> } | undefined)?.shape;
      return {
        name,
        risk: classifyTool(name) as RiskClass,
        requiresApproval: decision.allow ? decision.requiresApproval : true,
        args: shape ? Object.keys(shape) : [],
      };
    });
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

    const foreignGuild = GUILD_ARG_KEYS.find(
      key => request.args?.[key] !== undefined && request.args[key] !== this.options.guildId,
    );
    if (foreignGuild) {
      return this.deny(toolName, `guild id is fixed by configuration: ${foreignGuild}`, { requestId, context });
    }

    const decision = evaluateTool(toolName, { destructiveToolsEnabled: this.options.destructiveToolsEnabled });
    if (!decision.allow) {
      return this.deny(toolName, decision.reason, { requestId, context });
    }

    const entry = this.handlers.get(toolName);
    if (!entry) {
      return this.deny(toolName, `tool is not registered: ${toolName}`, { requestId, context });
    }

    // Limits und Pflichtfelder gelten vor der Freigabe: eine Owner-Freigabe soll
    // nie fuer Argumente eingeholt werden, die ohnehin unzulaessig sind.
    const parsed = entry.schema ? entry.schema.safeParse(args) : { success: true as const, data: args };
    if (!parsed.success) {
      const reason = parsed.error.issues
        .map(issue => `${issue.path.join('.') || 'args'}: ${issue.message}`)
        .join('; ');
      return this.deny(toolName, `invalid arguments -- ${reason}`, { requestId, context });
    }
    const validatedArgs = parsed.data;

    if (decision.requiresApproval) {
      if (!approvalId) {
        const approval = this.options.approvals.request({ toolName, args: validatedArgs, context });
        await this.options.audit.record({
          event: 'tool_approval_requested',
          requestId,
          actorUserId: context.userId,
          guildId: this.options.guildId,
          toolName,
          approvalId: approval.approvalId,
          args: validatedArgs,
        });
        await this.options.requestApproval?.({ approvalId: approval.approvalId, toolName, args: validatedArgs, context });
        return { status: 'approval_required', approvalId: approval.approvalId, risk: decision.risk };
      }

      const consumed = this.options.approvals.consume(approvalId, toolName, validatedArgs);
      if (!consumed.ok) {
        return this.deny(toolName, consumed.reason, { requestId, context, approvalId });
      }
    }

    // Guild kommt immer aus der Konfiguration, nie aus den Toolargumenten.
    let result: unknown;
    try {
      result = await entry.handler({
        args: validatedArgs,
        context,
        guildId: this.options.guildId,
        runtime: this.options.runtime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.audit.record({
        event: 'tool_failed',
        requestId,
        actorUserId: context.userId,
        guildId: this.options.guildId,
        toolName,
        reason: message,
        approvalId,
        args: validatedArgs,
      });
      return { status: 'error', message };
    }

    await this.options.audit.record({
      event: 'tool_executed',
      requestId,
      actorUserId: context.userId,
      guildId: this.options.guildId,
      toolName,
      decision: decision.risk,
      approvalId,
      args: validatedArgs,
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
