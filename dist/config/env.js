import 'dotenv/config';
import { z } from 'zod';
const optionalString = z.preprocess(value => typeof value === 'string' ? value.trim() || undefined : value, z.string().optional());
const optionalUrl = z.preprocess(value => typeof value === 'string' ? value.trim() || undefined : value, z.string().url().optional());
const envSchema = z.object({
    EBAY_PROVIDER: z.enum(['live', 'mock']).default('live'),
    EBAY_APP_ID: optionalString,
    EBAY_CLIENT_SECRET: optionalString,
    EBAY_MARKETPLACE_ID: z.string().default('EBAY_DE'),
    EBAY_SEARCH_PAGE_SIZE: z.coerce.number().default(200),
    EBAY_MAX_PAGES_PER_BUCKET: z.coerce.number().default(3),
    NOTIFIER_PROVIDER: z.enum(['console', 'matrix']).default('console'),
    MATRIX_HOMESERVER_URL: optionalUrl,
    MATRIX_ACCESS_TOKEN: optionalString,
    MATRIX_ROOM_ID: optionalString,
    MATRIX_SEND_DELAY_MS: z.coerce.number().default(750),
    MATRIX_RATE_LIMIT_BUFFER_MS: z.coerce.number().default(250),
    MATRIX_MAX_SEND_RETRIES: z.coerce.number().default(5),
    POLL_INTERVAL_SECONDS: z.coerce.number().default(300),
    ALLOW_COUNTRIES: z.string().default('DE,AT,CH,FR,BE,NL,LU,DK,PL,CZ'),
    MIN_SELLER_FEEDBACK_PERCENT: z.coerce.number().default(90),
    MAX_SHIPPING_HARD_CAP_EUR: z.coerce.number().default(25),
});
function requireValue(value, name) {
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
const parsed = envSchema.parse(process.env);
export const env = {
    ...parsed,
    EBAY_APP_ID: parsed.EBAY_PROVIDER === 'live'
        ? requireValue(parsed.EBAY_APP_ID, 'EBAY_APP_ID')
        : parsed.EBAY_APP_ID ?? '',
    EBAY_CLIENT_SECRET: parsed.EBAY_PROVIDER === 'live'
        ? requireValue(parsed.EBAY_CLIENT_SECRET, 'EBAY_CLIENT_SECRET')
        : parsed.EBAY_CLIENT_SECRET ?? '',
    MATRIX_HOMESERVER_URL: parsed.NOTIFIER_PROVIDER === 'matrix'
        ? requireValue(parsed.MATRIX_HOMESERVER_URL, 'MATRIX_HOMESERVER_URL')
        : parsed.MATRIX_HOMESERVER_URL ?? '',
    MATRIX_ACCESS_TOKEN: parsed.NOTIFIER_PROVIDER === 'matrix'
        ? requireValue(parsed.MATRIX_ACCESS_TOKEN, 'MATRIX_ACCESS_TOKEN')
        : parsed.MATRIX_ACCESS_TOKEN ?? '',
    MATRIX_ROOM_ID: parsed.NOTIFIER_PROVIDER === 'matrix'
        ? requireValue(parsed.MATRIX_ROOM_ID, 'MATRIX_ROOM_ID')
        : parsed.MATRIX_ROOM_ID ?? '',
};
