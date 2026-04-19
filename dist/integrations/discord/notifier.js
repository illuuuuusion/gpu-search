import { once } from 'node:events';
import { ActivityType, Client, EmbedBuilder, Events, GatewayIntentBits, } from 'discord.js';
import { env } from '../../config/env.js';
const DISCORD_ACTIVITY_NAME = 'eBay GPU-Deals';
function toDiscordColor(color) {
    return color === 'danger' ? 0xED4245 : 0x57F287;
}
export class DiscordNotifier {
    client = new Client({
        intents: [GatewayIntentBits.Guilds],
        presence: {
            activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
            status: 'online',
        },
    });
    nextSendAt = 0;
    readyPromise = null;
    constructor() {
        if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) {
            throw new Error('Missing Discord configuration');
        }
    }
    async start() {
        if (this.client.isReady()) {
            return;
        }
        if (!this.readyPromise) {
            this.readyPromise = (async () => {
                const ready = once(this.client, Events.ClientReady);
                await this.client.login(env.DISCORD_BOT_TOKEN);
                if (!this.client.isReady()) {
                    await ready;
                }
                this.client.user?.setPresence({
                    activities: [{ name: DISCORD_ACTIVITY_NAME, type: ActivityType.Watching }],
                    status: 'online',
                });
            })();
        }
        await this.readyPromise;
    }
    async waitForSendWindow() {
        const waitMs = this.nextSendAt - Date.now();
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
    async send(message) {
        await this.start();
        await this.waitForSendWindow();
        const channel = await this.client.channels.fetch(env.DISCORD_CHANNEL_ID);
        if (!channel?.isSendable()) {
            throw new Error('Configured Discord channel is not sendable');
        }
        const embed = new EmbedBuilder()
            .setColor(toDiscordColor(message.color))
            .setTitle(message.title)
            .setURL(message.url)
            .setDescription(message.description)
            .addFields(message.fields)
            .setFooter({ text: 'GPU-Search' });
        if (message.imageUrl) {
            embed.setImage(message.imageUrl);
        }
        await channel.send({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
        this.nextSendAt = Date.now() + env.DISCORD_SEND_DELAY_MS;
    }
}
