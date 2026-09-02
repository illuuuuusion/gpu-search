import type { AiAgentConfig } from '../../../app/env/index.js';
import { logger } from '../../../app/shared/logger.js';
import { AiMessageRouter } from '../routing/aiMessageRouter.js';
import type { DiscordRuntime } from '../runtime/discordRuntime.js';
import { AdminToolExecutor } from './adminToolExecutor.js';
import { AgentSocketServer } from './agentSocketServer.js';
import { ApprovalService } from './approvalService.js';
import { AuditLog } from './auditLog.js';
import { registerReadTools } from './readTools.js';
import { RequestContextStore, type RequestContext } from './requestContextStore.js';

const UNAVAILABLE_NOTICE = 'KI-Funktion derzeit nicht verfügbar.';

// Kompositionswurzel der KI-Anbindung. Haelt Policy, Freigaben, Audit und den
// lokalen Socket zusammen; der Discord-Client kommt ausschliesslich per DI.
export class AiAgentModule {
  readonly contexts: RequestContextStore;
  readonly approvals: ApprovalService;
  readonly audit: AuditLog;
  readonly executor: AdminToolExecutor;
  readonly messageRouter: AiMessageRouter;
  readonly socketServer: AgentSocketServer;

  constructor(
    private readonly runtime: DiscordRuntime,
    private readonly config: AiAgentConfig,
  ) {
    this.contexts = new RequestContextStore(config.requestContextTtlSeconds);
    this.approvals = new ApprovalService({
      ttlSeconds: config.approvalTtlSeconds,
      ownerUserIds: config.ownerUserIds,
    });
    this.audit = new AuditLog(config.auditLogPath);
    this.executor = new AdminToolExecutor({
      runtime,
      contexts: this.contexts,
      approvals: this.approvals,
      audit: this.audit,
      guildId: config.guildId,
      destructiveToolsEnabled: config.destructiveToolsEnabled,
    });
    // Phase 2: ausschliesslich lesende Werkzeuge. Writes folgen in Phase 3.
    registerReadTools(this.executor);

    this.socketServer = new AgentSocketServer({
      socketPath: config.socketPath,
      secret: config.socketSecret,
      handlers: {
        reply: input => this.reply(input),
        react: input => this.react(input),
        editMessage: input => this.editMessage(input),
        adminTool: input => this.executor.execute(input),
        listTools: async () => this.executor.toolCatalog,
        health: async () => ({
          discordReady: this.runtime.client.isReady(),
          sidecarConnected: this.socketServer.connected,
          registeredTools: this.executor.registeredTools,
          openContexts: this.contexts.size,
        }),
      },
    });

    this.messageRouter = new AiMessageRouter(
      {
        enabled: true,
        guildId: config.guildId,
        allowedUserIds: config.allowedUserIds,
        allowedChannelIds: config.allowedChannelIds,
        requireMention: config.requireMention,
        botUserId: () => this.runtime.botUserId,
        forward: (context, text) => this.forward(context, text),
      },
      this.contexts,
    );
  }

  async start(): Promise<void> {
    await this.socketServer.start();
    // Nach dem Notifier registriert -> bestehende Commands und Prefix-Dialoge
    // gehen dem KI-Router immer vor.
    this.runtime.router.registerMessageHandler('ai', message => this.messageRouter.handle(message));
    logger.info({ guildId: this.config.guildId }, 'ai agent module started');
  }

  async stop(): Promise<void> {
    await this.socketServer.stop();
  }

  private async forward(context: RequestContext, text: string): Promise<void> {
    await this.audit.record({
      event: 'inbound_message',
      requestId: context.requestId,
      actorUserId: context.userId,
      guildId: context.guildId,
    });

    if (!this.socketServer.connected) {
      // Kein unbegrenztes Puffern: der Nutzer bekommt eine klare Absage.
      await this.sendToChannel(context.channelId, UNAVAILABLE_NOTICE);
      return;
    }

    this.socketServer.sendInboundMessage(context, text);
  }

  private async reply(input: { requestId: string; content: string }): Promise<{ messageId: string }> {
    const context = this.requireContext(input.requestId);
    const message = await this.sendToChannel(context.channelId, input.content, context.messageId);
    this.messageRouter.markAgentMessage(message.id);
    return { messageId: message.id };
  }

  private async react(input: { requestId: string; emoji: string; messageId?: string }): Promise<void> {
    const context = this.requireContext(input.requestId);
    const channel = await this.fetchChannel(context.channelId);
    const message = await channel.messages.fetch(input.messageId ?? context.messageId);
    await message.react(input.emoji);
  }

  private async editMessage(input: { requestId: string; messageId: string; content: string }): Promise<void> {
    const context = this.requireContext(input.requestId);
    const channel = await this.fetchChannel(context.channelId);
    const message = await channel.messages.fetch(input.messageId);
    if (message.author.id !== this.runtime.botUserId) {
      throw new Error('can only edit messages authored by this bot');
    }
    await message.edit(input.content);
  }

  // Identitaet kommt immer aus dem Store, nie aus dem Toolargument.
  private requireContext(requestId: string): RequestContext {
    const context = this.contexts.get(requestId);
    if (!context) {
      throw new Error('unknown or expired request context');
    }
    return context;
  }

  private async fetchChannel(channelId: string) {
    if (!this.config.allowedChannelIds.has(channelId)) {
      throw new Error('channel is not in the AI allowlist');
    }
    const channel = await this.runtime.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable() || !('messages' in channel)) {
      throw new Error('AI channel is not a sendable text channel');
    }
    return channel;
  }

  private async sendToChannel(channelId: string, content: string, replyToMessageId?: string) {
    const channel = await this.fetchChannel(channelId);
    return channel.send({
      content,
      allowedMentions: { parse: [] }, // keine @everyone/@here-Eskalation ueber Modelltext
      ...(replyToMessageId ? { reply: { messageReference: replyToMessageId, failIfNotExists: false } } : {}),
    });
  }
}
