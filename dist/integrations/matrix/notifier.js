import { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin } from 'matrix-bot-sdk';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function isMatrixRateLimitError(error) {
    if (!error || typeof error !== 'object')
        return false;
    const candidate = error;
    return candidate.statusCode === 429
        || candidate.errcode === 'M_LIMIT_EXCEEDED'
        || candidate.body?.errcode === 'M_LIMIT_EXCEEDED';
}
export class MatrixNotifier {
    client;
    roomId;
    nextSendAt = 0;
    constructor() {
        if (!env.MATRIX_HOMESERVER_URL || !env.MATRIX_ACCESS_TOKEN || !env.MATRIX_ROOM_ID) {
            throw new Error('Missing Matrix configuration');
        }
        const storage = new SimpleFsStorageProvider('matrix-bot.json');
        this.client = new MatrixClient(env.MATRIX_HOMESERVER_URL, env.MATRIX_ACCESS_TOKEN, storage);
        AutojoinRoomsMixin.setupOnClient(this.client);
        this.roomId = env.MATRIX_ROOM_ID;
    }
    async start() {
        await this.client.start();
    }
    async waitForSendWindow() {
        const waitMs = this.nextSendAt - Date.now();
        if (waitMs > 0) {
            await sleep(waitMs);
        }
    }
    async send(message) {
        for (let attempt = 1; attempt <= env.MATRIX_MAX_SEND_RETRIES; attempt += 1) {
            await this.waitForSendWindow();
            try {
                await this.client.sendMessage(this.roomId, {
                    msgtype: 'm.text',
                    body: message,
                });
                this.nextSendAt = Date.now() + env.MATRIX_SEND_DELAY_MS;
                return;
            }
            catch (error) {
                if (!isMatrixRateLimitError(error) || attempt === env.MATRIX_MAX_SEND_RETRIES) {
                    throw error;
                }
                const retryAfterMs = Math.max(error.retryAfterMs ?? error.body?.retry_after_ms ?? 1000, 0) + env.MATRIX_RATE_LIMIT_BUFFER_MS;
                this.nextSendAt = Date.now() + retryAfterMs;
                logger.warn({
                    attempt,
                    retryAfterMs,
                }, 'Matrix rate limit hit, retrying send');
            }
        }
    }
}
export class ConsoleNotifier {
    async send(message) {
        console.log('\n--- ALERT ---\n' + message + '\n--------------\n');
    }
}
