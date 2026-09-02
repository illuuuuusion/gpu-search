import type { MessageReaction } from 'discord.js';
import type { ReactionRoute } from '../../../app/shared/botBindings.js';

export interface ReactionEvent {
  emoji: string;
  userId: string;
  messageId: string;
  channelId: string;
  route: ReactionRoute;
  reaction: MessageReaction;
}

export type ReactionHandler = (event: ReactionEvent) => Promise<void>;

// ponytail: dummer Dispatcher. Kennt keine Feature-Details — Fachlogik lebt in den
// Handlern, die die Feature-Module (B5, spaeter C1/C2/D) selbst registrieren.
export class ReactionRouter {
  private readonly handlers = new Map<string, ReactionHandler>();

  register(type: string, handler: ReactionHandler): void {
    this.handlers.set(type, handler);
  }

  async handle(event: ReactionEvent): Promise<void> {
    const handler = this.handlers.get(event.route.type);
    if (handler) {
      await handler(event);
    }
  }
}
