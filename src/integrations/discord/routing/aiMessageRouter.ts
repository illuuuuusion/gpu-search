import { logger } from '../../../app/shared/logger.js';
import type { RequestContext, RequestContextStore } from '../ai/requestContextStore.js';

// Strukturelles Minimum aus discord.js -- so bleibt der Router ohne echten
// Gateway-Client testbar.
export interface AiRouterMessage {
  id: string;
  content: string;
  guildId: string | null;
  channelId: string;
  webhookId?: string | null;
  author: { id: string; bot: boolean };
  mentions: { has(userId: string): boolean };
  reference?: { messageId?: string | null } | null;
}

export interface AiMessageRouterOptions {
  enabled: boolean;
  guildId: string;
  allowedUserIds: Set<string>;
  allowedChannelIds: Set<string>;
  requireMention: boolean;
  botUserId: () => string | undefined;
  // Laufende C2-/Command-Dialoge des Notifiers beanspruchen die Nachricht zuerst.
  hasActiveDialog?: (message: AiRouterMessage) => boolean;
  forward: (context: RequestContext, text: string) => Promise<void>;
}

export class AiMessageRouter {
  private readonly agentMessageIds = new Set<string>();

  constructor(
    private readonly options: AiMessageRouterOptions,
    private readonly contexts: RequestContextStore,
  ) {}

  // Antworten des Bots im Agent-Kontext merken, damit ein Reply darauf ohne
  // erneute Mention als Folgefrage zaehlt.
  markAgentMessage(messageId: string): void {
    this.agentMessageIds.add(messageId);
    // ponytail: harte Obergrenze statt TTL-Index. Ceiling: bei vielen parallelen
    // Threads auf eine LRU/Map mit Zeitstempel wechseln.
    if (this.agentMessageIds.size > 500) {
      const oldest = this.agentMessageIds.values().next().value;
      if (oldest) {
        this.agentMessageIds.delete(oldest);
      }
    }
  }

  // `true` = Nachricht wurde an Claude weitergereicht. Alles andere wird still
  // verworfen; fremde Nutzer bekommen bewusst keine Rueckmeldung.
  async handle(message: AiRouterMessage): Promise<boolean> {
    const text = this.stripMention(message.content);
    // Reine Mention ohne Text ist keine Anfrage.
    if (!text || !this.accepts(message)) {
      return false;
    }

    const context = this.contexts.create({
      userId: message.author.id,
      guildId: this.options.guildId,
      channelId: message.channelId,
      messageId: message.id,
    });

    logger.info({ requestId: context.requestId, channelId: context.channelId }, 'ai message accepted');
    await this.options.forward(context, text);
    return true;
  }

  private accepts(message: AiRouterMessage): boolean {
    if (!this.options.enabled) return false;
    if (message.author.bot || message.webhookId) return false;
    if (message.guildId !== this.options.guildId) return false;
    if (!this.options.allowedChannelIds.has(message.channelId)) return false;
    if (!this.options.allowedUserIds.has(message.author.id)) return false;
    if (this.options.hasActiveDialog?.(message)) return false;

    const botUserId = this.options.botUserId();
    const mentioned = Boolean(botUserId) && message.mentions.has(botUserId as string);
    const repliesToAgent = Boolean(
      message.reference?.messageId && this.agentMessageIds.has(message.reference.messageId),
    );

    if (this.options.requireMention && !mentioned && !repliesToAgent) {
      return false;
    }

    return true;
  }

  private stripMention(content: string): string {
    const botUserId = this.options.botUserId();
    if (!botUserId) {
      return content.trim();
    }
    return content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim();
  }
}
