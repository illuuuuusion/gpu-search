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
  MARKET_REFERENCE_PROVIDER: z.enum(['none', 'geizhals']).default('geizhals'),
  MARKET_REFERENCE_CACHE_PATH: optionalString,
  MARKET_REFERENCE_REFRESH_HOUR: z.coerce.number().min(0).max(23).default(1),
  MARKET_REFERENCE_CACHE_MAX_AGE_HOURS: z.coerce.number().default(30),
  GEIZHALS_REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),
  GEIZHALS_MAX_FAMILY_LINKS_PER_PROFILE: z.coerce.number().default(12),
  GEIZHALS_VARIANT_MATCH_THRESHOLD: z.coerce.number().default(0.42),
  GEIZHALS_PROFILE_DELAY_MS: z.coerce.number().default(750),
  GEIZHALS_BROWSER_HEADLESS: booleanFromString.default(true),
  GEIZHALS_BROWSER_ENGINE: z.enum(['auto', 'chromium', 'firefox', 'webkit']).default('auto'),
  NOTIFIER_PROVIDER: z.enum(['console', 'discord']).default('console'),
  DISCORD_BOT_TOKEN: optionalString,
  DISCORD_CHANNEL_ID: optionalString,
  DISCORD_SEND_DELAY_MS: z.coerce.number().default(750),
  DISCORD_RATE_LIMIT_BUFFER_MS: z.coerce.number().default(250),
  DISCORD_MAX_SEND_RETRIES: z.coerce.number().default(5),
  SCANNER_STATE_PATH: optionalString,
  SCANNER_SEEN_RETENTION_DAYS: z.coerce.number().default(30),
  SCANNER_STATS_WINDOW_DAYS: z.coerce.number().default(90),
  SCANNER_AVAILABILITY_RECHECK_HOURS: z.coerce.number().default(6),
  SCANNER_AVAILABILITY_CHECK_BATCH_SIZE: z.coerce.number().default(25),
  POLL_INTERVAL_SECONDS: z.coerce.number().default(300),
  ALLOW_COUNTRIES: z.string().default('DE,AT,CH,FR,BE,NL,LU,DK,PL,CZ'),
  MIN_SELLER_FEEDBACK_PERCENT: z.coerce.number().default(90),
  MAX_SHIPPING_HARD_CAP_EUR: z.coerce.number().default(25),
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
  MARKET_REFERENCE_PROVIDER: 'none' | 'geizhals';
  MARKET_REFERENCE_CACHE_PATH?: string;
  MARKET_REFERENCE_REFRESH_HOUR: number;
  MARKET_REFERENCE_CACHE_MAX_AGE_HOURS: number;
  GEIZHALS_REQUEST_TIMEOUT_MS: number;
  GEIZHALS_MAX_FAMILY_LINKS_PER_PROFILE: number;
  GEIZHALS_VARIANT_MATCH_THRESHOLD: number;
  GEIZHALS_PROFILE_DELAY_MS: number;
  GEIZHALS_BROWSER_HEADLESS: boolean;
  GEIZHALS_BROWSER_ENGINE: 'auto' | 'chromium' | 'firefox' | 'webkit';
  NOTIFIER_PROVIDER: 'console' | 'discord';
  DISCORD_BOT_TOKEN: string;
  DISCORD_CHANNEL_ID: string;
  DISCORD_SEND_DELAY_MS: number;
  DISCORD_RATE_LIMIT_BUFFER_MS: number;
  DISCORD_MAX_SEND_RETRIES: number;
  SCANNER_STATE_PATH?: string;
  SCANNER_SEEN_RETENTION_DAYS: number;
  SCANNER_STATS_WINDOW_DAYS: number;
  SCANNER_AVAILABILITY_RECHECK_HOURS: number;
  SCANNER_AVAILABILITY_CHECK_BATCH_SIZE: number;
  POLL_INTERVAL_SECONDS: number;
  ALLOW_COUNTRIES: string;
  MIN_SELLER_FEEDBACK_PERCENT: number;
  MAX_SHIPPING_HARD_CAP_EUR: number;
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
