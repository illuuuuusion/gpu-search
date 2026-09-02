import type { Interaction, Message } from 'discord.js';
import { logger } from '../../../app/shared/logger.js';

// `true` = Nachricht konsumiert, nachfolgende Handler werden uebersprungen.
export type MessageHandler = (message: Message) => Promise<boolean>;
export type InteractionHandler = (interaction: Interaction) => Promise<void>;

// ponytail: dummer Fan-out in Registrierungsreihenfolge, kein Middleware-Framework.
// Reihenfolge ist die Kollisionsregel: der Notifier (Commands, !remind, C2-Dialoge)
// registriert vor dem KI-Router und darf jede Nachricht vorher beanspruchen.
export class CommandRouter {
  private readonly messageHandlers: { name: string; handler: MessageHandler }[] = [];
  private readonly interactionHandlers: { name: string; handler: InteractionHandler }[] = [];

  registerMessageHandler(name: string, handler: MessageHandler): void {
    this.messageHandlers.push({ name, handler });
  }

  registerInteractionHandler(name: string, handler: InteractionHandler): void {
    this.interactionHandlers.push({ name, handler });
  }

  async dispatchMessage(message: Message): Promise<string | null> {
    for (const { name, handler } of this.messageHandlers) {
      try {
        if (await handler(message)) {
          return name;
        }
      } catch (error) {
        // Fehlerisolation: ein defekter Handler darf die anderen nicht blockieren.
        logger.error({ error, handler: name, messageId: message.id }, 'discord message handler failed');
      }
    }

    return null;
  }

  async dispatchInteraction(interaction: Interaction): Promise<void> {
    for (const { name, handler } of this.interactionHandlers) {
      try {
        await handler(interaction);
      } catch (error) {
        logger.error({ error, handler: name, interactionId: interaction.id }, 'discord interaction handler failed');
      }
    }
  }
}
