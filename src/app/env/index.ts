import 'dotenv/config';
import { z } from 'zod';

const optionalString = z.preprocess(
  value => typeof value === 'string' ? value.trim() || undefined : value,
  z.string().optional(),
);

const booleanFromString = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return value;

    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return value;
  },
  z.boolean(),
);

const envSchema = z.object({
  EBAY_PROVIDER: z.enum(['live', 'sandbox', 'mock']).default('live'),
  EBAY_APP_ID: optionalString,
  EBAY_CLIENT_SECRET: optionalString,
  EBAY_MARKETPLACE_ID: z.string().default('EBAY_DE'),
  EBAY_SEARCH_PAGE_SIZE: z.coerce.number().default(200),
  EBAY_MAX_PAGES_PER_BUCKET: z.coerce.number().default(3),
  NOTIFIER_PROVIDER: z.enum(['console', 'discord']).default('console'),
  DISCORD_BOT_TOKEN: optionalString,
  DISCORD_CHANNEL_ID: optionalString,
  DISCORD_ADMIN_STATE_PATH: optionalString,
  DISCORD_SEND_DELAY_MS: z.coerce.number().default(750),
  DISCORD_RATE_LIMIT_BUFFER_MS: z.coerce.number().default(250),
  DISCORD_MAX_SEND_RETRIES: z.coerce.number().default(5),
  SCANNER_STATE_PATH: optionalString,
  MARKET_SUMMARY_PATH: optionalString,
  SCANNER_AVAILABILITY_REFRESH_ENABLED: booleanFromString.default(true),
  SCANNER_AVAILABILITY_RECHECK_MINUTES: z.coerce.number().default(12),
  SCANNER_AVAILABILITY_UNAVAILABLE_ACTION: z.enum(['delete', 'mark_expired']).default('delete'),
  SCANNER_SEEN_RETENTION_DAYS: z.coerce.number().default(30),
  SCANNER_STATS_WINDOW_DAYS: z.coerce.number().default(90),
  SCANNER_AVAILABILITY_RECHECK_HOURS: z.coerce.number().default(6),
  SCANNER_AVAILABILITY_CHECK_BATCH_SIZE: z.coerce.number().default(25),
  POLL_INTERVAL_SECONDS: z.coerce.number().default(720),
  ALLOW_COUNTRIES: z.string().default('DE,AT,CH,FR,BE,NL,LU,DK,PL,CZ'),
  MIN_SELLER_FEEDBACK_PERCENT: z.coerce.number().default(90),
  MAX_SHIPPING_HARD_CAP_EUR: z.coerce.number().default(25),
  VALORANT_ENABLED: booleanFromString.default(false),
  VALORANT_PROVIDER: z.enum(['vlr', 'grid']).default('vlr'),
  VALORANT_STORAGE_PATH: z.string().default('data/valorant-compositions.json'),
  VALORANT_WINDOW_DAYS: z.coerce.number().default(90),
  VALORANT_INGEST_HOUR_UTC: z.coerce.number().min(0).max(23).default(1),
  VALORANT_RAW_RETENTION_DAYS: z.coerce.number().default(7),
  VALORANT_BUILDER_SESSION_TTL_MINUTES: z.coerce.number().default(30),
  VALORANT_VLR_BASE_URL: z.string().default('https://www.vlr.gg'),
  VALORANT_SYNC_MAX_RETRIES: z.coerce.number().min(0).max(10).default(2),
  VALORANT_SYNC_RETRY_DELAY_MS: z.coerce.number().min(250).max(60_000).default(2_500),
  VALORANT_VLR_MIN_REQUEST_INTERVAL_MS: z.coerce.number().default(1250),
  VALORANT_VLR_MAX_EVENT_PAGES: z.coerce.number().min(1).max(10).default(3),
  VALORANT_VLR_MAX_MATCH_TIMESTAMP_LOOKUPS: z.coerce.number().min(1).max(500).default(60),
  VALORANT_VLR_RECENT_MATCH_DAYS: z.coerce.number().min(1).max(180).default(45),
  VALORANT_LIQUIPEDIA_API_BASE_URL: z.string().default('https://liquipedia.net/valorant/api.php'),
  VALORANT_LIQUIPEDIA_USER_AGENT: z.string().default('gpu-search/0.1 (contact: you@example.com)'),
  VALORANT_LIQUIPEDIA_MIN_REQUEST_INTERVAL_MS: z.coerce.number().default(3500),
});

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

interface AppEnv {
  EBAY_PROVIDER: 'live' | 'sandbox' | 'mock';
  EBAY_APP_ID: string;
  EBAY_CLIENT_SECRET: string;
  EBAY_MARKETPLACE_ID: string;
  EBAY_SEARCH_PAGE_SIZE: number;
  EBAY_MAX_PAGES_PER_BUCKET: number;
  NOTIFIER_PROVIDER: 'console' | 'discord';
  DISCORD_BOT_TOKEN: string;
  DISCORD_CHANNEL_ID: string;
  DISCORD_ADMIN_STATE_PATH?: string;
  DISCORD_SEND_DELAY_MS: number;
  DISCORD_RATE_LIMIT_BUFFER_MS: number;
  DISCORD_MAX_SEND_RETRIES: number;
  SCANNER_STATE_PATH?: string;
  MARKET_SUMMARY_PATH?: string;
  SCANNER_AVAILABILITY_REFRESH_ENABLED: boolean;
  SCANNER_AVAILABILITY_RECHECK_MINUTES: number;
  SCANNER_AVAILABILITY_UNAVAILABLE_ACTION: 'delete' | 'mark_expired';
  SCANNER_SEEN_RETENTION_DAYS: number;
  SCANNER_STATS_WINDOW_DAYS: number;
  SCANNER_AVAILABILITY_RECHECK_HOURS: number;
  SCANNER_AVAILABILITY_CHECK_BATCH_SIZE: number;
  POLL_INTERVAL_SECONDS: number;
  ALLOW_COUNTRIES: string;
  MIN_SELLER_FEEDBACK_PERCENT: number;
  MAX_SHIPPING_HARD_CAP_EUR: number;
  VALORANT_ENABLED: boolean;
  VALORANT_PROVIDER: 'vlr' | 'grid';
  VALORANT_STORAGE_PATH: string;
  VALORANT_WINDOW_DAYS: number;
  VALORANT_INGEST_HOUR_UTC: number;
  VALORANT_RAW_RETENTION_DAYS: number;
  VALORANT_BUILDER_SESSION_TTL_MINUTES: number;
  VALORANT_VLR_BASE_URL: string;
  VALORANT_SYNC_MAX_RETRIES: number;
  VALORANT_SYNC_RETRY_DELAY_MS: number;
  VALORANT_VLR_MIN_REQUEST_INTERVAL_MS: number;
  VALORANT_VLR_MAX_EVENT_PAGES: number;
  VALORANT_VLR_MAX_MATCH_TIMESTAMP_LOOKUPS: number;
  VALORANT_VLR_RECENT_MATCH_DAYS: number;
  VALORANT_LIQUIPEDIA_API_BASE_URL: string;
  VALORANT_LIQUIPEDIA_USER_AGENT: string;
  VALORANT_LIQUIPEDIA_MIN_REQUEST_INTERVAL_MS: number;
}

const parsed = envSchema.parse(process.env);
const requiresEbayCredentials = parsed.EBAY_PROVIDER !== 'mock';

export const env: AppEnv = {
  ...parsed,
  EBAY_APP_ID: requiresEbayCredentials
    ? requireValue(parsed.EBAY_APP_ID, 'EBAY_APP_ID')
    : parsed.EBAY_APP_ID ?? '',
  EBAY_CLIENT_SECRET: requiresEbayCredentials
    ? requireValue(parsed.EBAY_CLIENT_SECRET, 'EBAY_CLIENT_SECRET')
    : parsed.EBAY_CLIENT_SECRET ?? '',
  DISCORD_BOT_TOKEN: parsed.NOTIFIER_PROVIDER === 'discord'
    ? requireValue(parsed.DISCORD_BOT_TOKEN, 'DISCORD_BOT_TOKEN')
    : parsed.DISCORD_BOT_TOKEN ?? '',
  DISCORD_CHANNEL_ID: parsed.NOTIFIER_PROVIDER === 'discord'
    ? requireValue(parsed.DISCORD_CHANNEL_ID, 'DISCORD_CHANNEL_ID')
    : parsed.DISCORD_CHANNEL_ID ?? '',
};

export function getEbayApiBaseUrl(): string {
  return env.EBAY_PROVIDER === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';
}
