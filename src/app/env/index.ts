import 'dotenv/config';
import fs from 'node:fs';
import { z } from 'zod';

// Docker-Secrets-Support: fuer sensible Werte darf statt des Klartext-Env-Vars
// ein `${NAME}_FILE` gesetzt sein, das auf eine Datei zeigt (z. B. /run/secrets/x).
// Fehler beim Lesen werden bewusst nicht abgefangen -> Fail-Fast vor jedem Login.
const SECRET_FILE_VARS = ['DISCORD_BOT_TOKEN', 'EBAY_CLIENT_SECRET', 'AI_SOCKET_SECRET'] as const;

export function resolveSecretFileOverrides(): void {
  for (const name of SECRET_FILE_VARS) {
    const filePath = process.env[`${name}_FILE`];
    if (filePath) {
      process.env[name] = fs.readFileSync(filePath, 'utf8').trim();
    }
  }
}

resolveSecretFileOverrides();

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

const milliseconds = z.coerce.number().int().min(0);
const positiveInteger = z.coerce.number().int().min(1);

const envSchema = z.object({
  EBAY_PROVIDER: z.enum(['live', 'sandbox', 'mock']).default('live'),
  EBAY_APP_ID: optionalString,
  EBAY_CLIENT_SECRET: optionalString,
  EBAY_MARKETPLACE_ID: z.string().default('EBAY_DE'),
  EBAY_SEARCH_PAGE_SIZE: positiveInteger.max(200).default(200),
  EBAY_MAX_PAGES_PER_BUCKET: positiveInteger.default(3),
  EBAY_HTTP_TIMEOUT_MS: milliseconds.default(30_000),
  EBAY_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  EBAY_HTTP_RETRY_DELAY_MS: milliseconds.min(0).max(60_000).default(1_000),
  SCANNER_BUCKET_WATERMARK_OVERLAP_MINUTES: positiveInteger.default(10),
  NOTIFIER_PROVIDER: z.enum(['console', 'discord']).default('console'),
  DISCORD_BOT_TOKEN: optionalString,
  DISCORD_CHANNEL_ID: optionalString,
  // Komma-separierte User-ID-Listen (Pattern wie ALLOW_COUNTRIES).
  ALLOWED_ADMIN_IDS: z.string().default('504707482547912714,689513442867937321'),
  // Leer -> faellt in der Notifier-Schicht auf ALLOWED_ADMIN_IDS zurueck.
  ALLOWED_REACTOR_IDS: z.string().default(''),
  REACTIONS_ENABLED: booleanFromString.default(false),
  ADAPTIVE_THRESHOLD_ENABLED: booleanFromString.default(true),
  // C1: Dream-Deal-Score. Startschwelle 15 (= Deal-Score/Headroom in Prozent).
  DREAM_DEAL_ENABLED: booleanFromString.default(true),
  DREAM_DEAL_MIN_SCORE: z.coerce.number().default(15),
  // C2: Laufzeit-Ausschlussbegriffe (pro Profil), permissive Levenshtein-Kalibrierung.
  RUNTIME_EXCLUSIONS_ENABLED: booleanFromString.default(true),
  EXCLUSION_SIMILARITY_MAX_DISTANCE: z.coerce.number().int().min(0).default(2),
  EXCLUSIONS_STATE_PATH: optionalString,
  // D: Auktions-Sniper-Reminder (gemeinsam pro Listing, fester Lead von 20 Min).
  AUCTION_REMINDER_ENABLED: booleanFromString.default(true),
  AUCTION_REMINDER_LEAD_MINUTES: positiveInteger.default(20),
  AUCTION_REMINDER_CHECK_INTERVAL_SECONDS: positiveInteger.default(60),
  // B2: Kauf-jetzt-oder-warten aus eigener Beobachtungs-Historie.
  DEAL_TIMING_ENABLED: booleanFromString.default(true),
  DEAL_TIMING_MIN_SAMPLES: positiveInteger.default(4),
  // B6: regelbasiertes Alias-Fallback (nur Logging, kein Live-Alarm).
  ALIAS_FALLBACK_ENABLED: booleanFromString.default(true),
  ALIAS_FALLBACK_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.72),
  ALIAS_FALLBACK_LOG_PATH: optionalString,
  // B4: Cross-Marketplace-Arbitrage (Kleinanzeigen). Standardmaessig aus,
  // bis die Scraping-Selektoren gegen die Live-Seite verifiziert sind.
  KLEINANZEIGEN_ENABLED: booleanFromString.default(false),
  KLEINANZEIGEN_BASE_URL: z.string().default('https://www.kleinanzeigen.de'),
  ARBITRAGE_MIN_MARGIN_EUR: z.coerce.number().default(40),
  ARBITRAGE_RESELL_FEE_PERCENT: z.coerce.number().min(0).max(100).default(12),
  ARBITRAGE_RESELL_SHIPPING_EUR: z.coerce.number().min(0).default(8),
  DISCORD_ADMIN_STATE_PATH: optionalString,
  DISCORD_SEND_DELAY_MS: milliseconds.default(750),
  DISCORD_RATE_LIMIT_BUFFER_MS: milliseconds.default(250),
  DISCORD_MAX_SEND_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
  SCANNER_STATE_PATH: optionalString,
  MARKET_SUMMARY_PATH: optionalString,
  SCANNER_STATE_BACKUP_COUNT: z.coerce.number().int().min(0).default(3),
  SCANNER_AVAILABILITY_REFRESH_ENABLED: booleanFromString.default(true),
  SCANNER_AVAILABILITY_RECHECK_MINUTES: positiveInteger.default(12),
  SCANNER_AVAILABILITY_UNAVAILABLE_ACTION: z.enum(['delete', 'mark_expired']).default('delete'),
  SCANNER_SEEN_RETENTION_DAYS: positiveInteger.default(30),
  SCANNER_STATS_WINDOW_DAYS: positiveInteger.default(90),
  SCANNER_AVAILABILITY_RECHECK_HOURS: positiveInteger.default(6),
  SCANNER_AVAILABILITY_CHECK_BATCH_SIZE: positiveInteger.default(25),
  POLL_INTERVAL_SECONDS: positiveInteger.min(30).default(720),
  OTEL_ENABLED: booleanFromString.default(false),
  OTEL_PROMETHEUS_PORT: positiveInteger.max(65535).default(9464),
  ALLOW_COUNTRIES: z.string().default('DE,AT,CH,FR,BE,NL,LU,DK,PL,CZ'),
  MIN_SELLER_FEEDBACK_PERCENT: z.coerce.number().min(0).max(100).default(90),
  MAX_SHIPPING_HARD_CAP_EUR: z.coerce.number().min(0).default(25),
  VALORANT_ENABLED: booleanFromString.default(false),
  VALORANT_PROVIDER: z.enum(['vlr', 'grid']).default('vlr'),
  VALORANT_STORAGE_PATH: z.string().default('data/valorant-compositions.json'),
  VALORANT_WINDOW_DAYS: positiveInteger.default(90),
  VALORANT_INGEST_HOUR_UTC: z.coerce.number().min(0).max(23).default(1),
  VALORANT_RAW_RETENTION_DAYS: positiveInteger.default(7),
  VALORANT_BUILDER_SESSION_TTL_MINUTES: positiveInteger.default(30),
  VALORANT_VLR_BASE_URL: z.string().default('https://www.vlr.gg'),
  VALORANT_SYNC_MAX_RETRIES: z.coerce.number().min(0).max(10).default(2),
  VALORANT_SYNC_RETRY_DELAY_MS: milliseconds.min(250).max(60_000).default(2_500),
  VALORANT_VLR_MIN_REQUEST_INTERVAL_MS: milliseconds.default(1250),
  VALORANT_VLR_MAX_EVENT_PAGES: z.coerce.number().min(1).max(10).default(3),
  VALORANT_VLR_MAX_MATCH_TIMESTAMP_LOOKUPS: z.coerce.number().min(1).max(500).default(60),
  VALORANT_VLR_RECENT_MATCH_DAYS: z.coerce.number().min(1).max(180).default(45),
  // KI-Agent (Claude-Channel-Sidecar). Standardmaessig aus; bei `true` erzwingt
  // validateAiAgentConfig() unten Guild, Allowlists und Socket-Secret.
  AI_AGENT_ENABLED: booleanFromString.default(false),
  AI_GUILD_ID: optionalString,
  AI_SOCKET_PATH: z.string().default('data/runtime/claude-channel.sock'),
  // Wert kommt ueber AI_SOCKET_SECRET_FILE aus einer Datei (siehe SECRET_FILE_VARS).
  AI_SOCKET_SECRET: optionalString,
  AI_ALLOWED_USER_IDS: z.string().default(''),
  AI_OWNER_USER_IDS: z.string().default(''),
  AI_ALLOWED_CHANNEL_IDS: z.string().default(''),
  AI_PROTECTED_CHANNEL_IDS: z.string().default(''),
  AI_PROTECTED_ROLE_IDS: z.string().default(''),
  AI_REQUIRE_MENTION: booleanFromString.default(true),
  AI_APPROVAL_TTL_SECONDS: positiveInteger.default(300),
  AI_REQUEST_CONTEXT_TTL_SECONDS: positiveInteger.default(900),
  AI_AUDIT_LOG_PATH: z.string().default('data/runtime/ai-audit.log'),
  // Phase 4: destruktive Tools werden ohne dieses Flag gar nicht erst registriert.
  AI_DESTRUCTIVE_TOOLS_ENABLED: booleanFromString.default(false),
});

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export interface AppEnv {
  EBAY_PROVIDER: 'live' | 'sandbox' | 'mock';
  EBAY_APP_ID: string;
  EBAY_CLIENT_SECRET: string;
  EBAY_MARKETPLACE_ID: string;
  EBAY_SEARCH_PAGE_SIZE: number;
  EBAY_MAX_PAGES_PER_BUCKET: number;
  EBAY_HTTP_TIMEOUT_MS: number;
  EBAY_HTTP_MAX_RETRIES: number;
  EBAY_HTTP_RETRY_DELAY_MS: number;
  SCANNER_BUCKET_WATERMARK_OVERLAP_MINUTES: number;
  NOTIFIER_PROVIDER: 'console' | 'discord';
  DISCORD_BOT_TOKEN: string;
  DISCORD_CHANNEL_ID: string;
  ALLOWED_ADMIN_IDS: string;
  ALLOWED_REACTOR_IDS: string;
  REACTIONS_ENABLED: boolean;
  ADAPTIVE_THRESHOLD_ENABLED: boolean;
  DREAM_DEAL_ENABLED: boolean;
  DREAM_DEAL_MIN_SCORE: number;
  RUNTIME_EXCLUSIONS_ENABLED: boolean;
  EXCLUSION_SIMILARITY_MAX_DISTANCE: number;
  EXCLUSIONS_STATE_PATH?: string;
  AUCTION_REMINDER_ENABLED: boolean;
  AUCTION_REMINDER_LEAD_MINUTES: number;
  AUCTION_REMINDER_CHECK_INTERVAL_SECONDS: number;
  DEAL_TIMING_ENABLED: boolean;
  DEAL_TIMING_MIN_SAMPLES: number;
  ALIAS_FALLBACK_ENABLED: boolean;
  ALIAS_FALLBACK_MIN_SIMILARITY: number;
  ALIAS_FALLBACK_LOG_PATH?: string;
  KLEINANZEIGEN_ENABLED: boolean;
  KLEINANZEIGEN_BASE_URL: string;
  ARBITRAGE_MIN_MARGIN_EUR: number;
  ARBITRAGE_RESELL_FEE_PERCENT: number;
  ARBITRAGE_RESELL_SHIPPING_EUR: number;
  DISCORD_ADMIN_STATE_PATH?: string;
  DISCORD_SEND_DELAY_MS: number;
  DISCORD_RATE_LIMIT_BUFFER_MS: number;
  DISCORD_MAX_SEND_RETRIES: number;
  SCANNER_STATE_PATH?: string;
  MARKET_SUMMARY_PATH?: string;
  SCANNER_STATE_BACKUP_COUNT: number;
  SCANNER_AVAILABILITY_REFRESH_ENABLED: boolean;
  SCANNER_AVAILABILITY_RECHECK_MINUTES: number;
  SCANNER_AVAILABILITY_UNAVAILABLE_ACTION: 'delete' | 'mark_expired';
  SCANNER_SEEN_RETENTION_DAYS: number;
  SCANNER_STATS_WINDOW_DAYS: number;
  SCANNER_AVAILABILITY_RECHECK_HOURS: number;
  SCANNER_AVAILABILITY_CHECK_BATCH_SIZE: number;
  POLL_INTERVAL_SECONDS: number;
  OTEL_ENABLED: boolean;
  OTEL_PROMETHEUS_PORT: number;
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
  AI_AGENT_ENABLED: boolean;
  AI_GUILD_ID?: string;
  AI_SOCKET_PATH: string;
  AI_SOCKET_SECRET?: string;
  AI_ALLOWED_USER_IDS: string;
  AI_OWNER_USER_IDS: string;
  AI_ALLOWED_CHANNEL_IDS: string;
  AI_PROTECTED_CHANNEL_IDS: string;
  AI_PROTECTED_ROLE_IDS: string;
  AI_REQUIRE_MENTION: boolean;
  AI_APPROVAL_TTL_SECONDS: number;
  AI_REQUEST_CONTEXT_TTL_SECONDS: number;
  AI_AUDIT_LOG_PATH: string;
  AI_DESTRUCTIVE_TOOLS_ENABLED: boolean;
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

function parseIdList(value: string): Set<string> {
  return new Set(value.split(',').map(id => id.trim()).filter(Boolean));
}

export const allowedAdminIds = parseIdList(env.ALLOWED_ADMIN_IDS);
// Reactor-Allowlist faellt auf die Admin-IDs zurueck, wenn nicht separat gesetzt.
export const allowedReactorIds = env.ALLOWED_REACTOR_IDS.trim()
  ? parseIdList(env.ALLOWED_REACTOR_IDS)
  : allowedAdminIds;

export function getEbayApiBaseUrl(): string {
  return env.EBAY_PROVIDER === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';
}

export interface AiAgentConfig {
  guildId: string;
  socketPath: string;
  socketSecret: string;
  allowedUserIds: Set<string>;
  ownerUserIds: Set<string>;
  allowedChannelIds: Set<string>;
  protectedChannelIds: Set<string>;
  protectedRoleIds: Set<string>;
  requireMention: boolean;
  approvalTtlSeconds: number;
  requestContextTtlSeconds: number;
  auditLogPath: string;
  destructiveToolsEnabled: boolean;
}

// Fail-Fast: mit aktivierter KI-Funktion darf der Prozess ohne Guild, ohne
// Owner-/User-/Channel-Allowlist oder ohne Socket-Secret nicht starten.
export function validateAiAgentConfig(source: AppEnv = env): AiAgentConfig {
  const missing: string[] = [];
  const requireId = (value: string | undefined, name: string): string => {
    if (!value) {
      missing.push(name);
    }
    return value ?? '';
  };
  const requireIds = (value: string, name: string): Set<string> => {
    const ids = parseIdList(value);
    if (ids.size === 0) {
      missing.push(name);
    }
    return ids;
  };

  const config: AiAgentConfig = {
    guildId: requireId(source.AI_GUILD_ID, 'AI_GUILD_ID'),
    socketPath: source.AI_SOCKET_PATH,
    socketSecret: requireId(source.AI_SOCKET_SECRET, 'AI_SOCKET_SECRET_FILE'),
    allowedUserIds: requireIds(source.AI_ALLOWED_USER_IDS, 'AI_ALLOWED_USER_IDS'),
    ownerUserIds: requireIds(source.AI_OWNER_USER_IDS, 'AI_OWNER_USER_IDS'),
    allowedChannelIds: requireIds(source.AI_ALLOWED_CHANNEL_IDS, 'AI_ALLOWED_CHANNEL_IDS'),
    protectedChannelIds: parseIdList(source.AI_PROTECTED_CHANNEL_IDS),
    protectedRoleIds: parseIdList(source.AI_PROTECTED_ROLE_IDS),
    requireMention: source.AI_REQUIRE_MENTION,
    approvalTtlSeconds: source.AI_APPROVAL_TTL_SECONDS,
    requestContextTtlSeconds: source.AI_REQUEST_CONTEXT_TTL_SECONDS,
    auditLogPath: source.AI_AUDIT_LOG_PATH,
    destructiveToolsEnabled: source.AI_DESTRUCTIVE_TOOLS_ENABLED,
  };

  if (missing.length > 0) {
    throw new Error(`AI_AGENT_ENABLED=true requires: ${missing.join(', ')}`);
  }

  return config;
}

export const aiAgentConfig: AiAgentConfig | undefined = env.AI_AGENT_ENABLED
  ? validateAiAgentConfig()
  : undefined;
