import { once } from 'node:events';
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { logger } from '../../../app/shared/logger.js';
import { CommandRouter } from '../routing/commandRouter.js';

const DISCORD_ACTIVITY_NAME = 'eBay GPU-Deals';

// Einziger Discord-Gateway-Client des gesamten Prozessverbunds. Scanner,
// Commands, Reactions und (spaeter) Admin-Tools bekommen ihn per DI; niemand
// sonst darf `new Client()` oder `client.login()` aufrufen.
export class DiscordRuntime {
  readonly client: Client;
  readonly router = new CommandRouter();

  private loginPromise: Promise<void> | null = null;

  constructor(client?: Client) {
    this.client = client ?? new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      // Reactions auf Nachrichten vor dem letzten Neustart kommen als "partial".
      partials: [Partials.Message, Partials.Reaction],
      presence: {
        activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
        status: 'online',
      },
    });

    this.client.on(Events.MessageCreate, message => {
      void this.router.dispatchMessage(message);
    });
    this.client.on(Events.InteractionCreate, interaction => {
      void this.router.dispatchInteraction(interaction);
    });
  }

  // Genau ein `client.login()` pro Prozess -- mehrfache Aufrufe teilen sich das
  // gleiche Promise, damit kein zweiter Gateway-Client entsteht.
  async login(token: string): Promise<void> {
    if (this.client.isReady()) {
      return;
    }

    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const ready = once(this.client, Events.ClientReady);
        await this.client.login(token);
        if (!this.client.isReady()) {
          await ready;
        }
        this.client.user?.setPresence({
          activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
          status: 'online',
        });
        logger.info({ userId: this.client.user?.id }, 'discord runtime ready');
      })();
    }

    await this.loginPromise;
  }

  get botUserId(): string | undefined {
    return this.client.user?.id;
  }
}
