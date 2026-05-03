import fs from 'node:fs/promises';
import path from 'node:path';
import type { EbayListing, GpuProfile } from '../../../domain/models.js';
import { selectProfileForListing } from '../../../domain/profileMatcher.js';
import type { MarketOfferFeedEntry, MarketOfferFeedFile, MarketOfferFeedOffer } from '../types.js';
import { logger } from '../../../../../app/shared/logger.js';

type RawFeedFormat = 'json' | 'jsonl' | 'csv' | 'xml';
type RawFeedSource = 'disabled' | 'file' | 'http';

interface RawFeedImporterOptions {
  provider: 'billiger' | 'guenstiger';
  source: RawFeedSource;
  format: RawFeedFormat;
  inputPath?: string;
  inputUrl?: string;
  authToken?: string;
  authHeader?: string;
  username?: string;
  password?: string;
  requestTimeoutMs: number;
  outputPath: string;
}

type FlatRecord = Record<string, string>;

const TITLE_KEYS = ['title', 'name', 'product_title', 'product_name', 'bezeichnung', 'artikelname', 'offer_title'];
const BRAND_KEYS = ['brand', 'manufacturer', 'hersteller', 'vendor', 'marke'];
const MODEL_KEYS = ['model', 'modell', 'series', 'produktlinie', 'product_model', 'gpu_model'];
const VARIANT_KEYS = ['variant', 'edition', 'version', 'board_model', 'modellbezeichnung', 'subtitle'];
const PRICE_KEYS = ['price', 'preis', 'price_eur', 'priceeur', 'lowprice', 'lowestprice', 'sale_price', 'amount'];
const URL_KEYS = ['url', 'link', 'deeplink', 'offer_url', 'product_url', 'shop_url'];
const OFFER_COUNT_KEYS = ['offercount', 'offer_count', 'offers', 'anzahl_angebote'];
const SHOP_KEYS = ['shop', 'merchant', 'shop_name', 'merchant_name', 'haendler', 'seller'];
const AVAILABILITY_KEYS = ['availability', 'status', 'lieferbarkeit', 'stock_status', 'availability_status'];

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeText(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function firstValue(record: FlatRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    const direct = record[normalized];
    if (direct) {
      return direct;
    }
  }

  return undefined;
}

function parsePrice(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function flattenJson(value: unknown, prefix = '', output: FlatRecord = {}): FlatRecord {
  if (value == null) {
    return output;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output[normalizeKey(prefix)] = String(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenJson(item, prefix ? `${prefix}_${index}` : String(index), output);
    });
    return output;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flattenJson(nested, prefix ? `${prefix}_${key}` : key, output);
    }
  }

  return output;
}

function parseCsv(raw: string): FlatRecord[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === ',' || char === ';' || char === '\t')) {
      row.push(current);
      current = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows.filter(candidate => candidate.some(cell => cell.trim().length > 0));
  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map(cell => normalizeKey(cell));
  return dataRows.map(dataRow => {
    const record: FlatRecord = {};
    headers.forEach((header, index) => {
      record[header] = dataRow[index]?.trim() ?? '';
    });
    return record;
  });
}

function parseJsonPayload(raw: string): FlatRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed && !Array.isArray(parsed)
      ? [
          ...(Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : []),
          ...(Array.isArray((parsed as { offers?: unknown }).offers) ? (parsed as { offers: unknown[] }).offers : []),
          ...(Array.isArray((parsed as { products?: unknown }).products) ? (parsed as { products: unknown[] }).products : []),
          ...(Array.isArray((parsed as { data?: unknown }).data) ? (parsed as { data: unknown[] }).data : []),
        ]
      : [];

  return records.map(record => flattenJson(record));
}

function parseJsonl(raw: string): FlatRecord[] {
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => flattenJson(JSON.parse(line) as unknown));
}

function parseXml(raw: string): FlatRecord[] {
  const itemTags = ['item', 'offer', 'product', 'entry', 'row'];
  const matches: FlatRecord[] = [];

  for (const tag of itemTags) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const match of raw.matchAll(pattern)) {
      const block = match[1] ?? '';
      const record: FlatRecord = {};
      for (const tagMatch of block.matchAll(/<([a-zA-Z0-9:_-]+)[^>]*>([\s\S]*?)<\/\1>/g)) {
        const key = normalizeKey(tagMatch[1] ?? '');
        const value = tagMatch[2]
          ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, '\'')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        if (key && value) {
          record[key] = value;
        }
      }
      if (Object.keys(record).length > 0) {
        matches.push(record);
      }
    }

    if (matches.length > 0) {
      break;
    }
  }

  return matches;
}

async function loadRawFeed(options: RawFeedImporterOptions): Promise<string> {
  if (options.source === 'file') {
    if (!options.inputPath) {
      throw new Error(`${options.provider}_import_input_path_missing`);
    }

    return fs.readFile(options.inputPath, 'utf8');
  }

  if (options.source === 'http') {
    if (!options.inputUrl) {
      throw new Error(`${options.provider}_import_url_missing`);
    }

    const headers = new Headers();
    if (options.authToken) {
      headers.set(options.authHeader?.trim() || 'Authorization', options.authToken);
    }
    if (options.username && options.password) {
      headers.set('Authorization', `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`);
    }

    const response = await fetch(options.inputUrl, {
      headers,
      signal: AbortSignal.timeout(options.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`${options.provider}_import_http_${response.status}`);
    }

    return response.text();
  }

  throw new Error(`${options.provider}_import_disabled`);
}

function parseRecords(raw: string, format: RawFeedFormat): FlatRecord[] {
  if (format === 'json') {
    return parseJsonPayload(raw);
  }

  if (format === 'jsonl') {
    return parseJsonl(raw);
  }

  if (format === 'csv') {
    return parseCsv(raw);
  }

  return parseXml(raw);
}

function buildPseudoListing(record: FlatRecord): EbayListing | null {
  const title = normalizeText(firstValue(record, TITLE_KEYS));
  const brand = normalizeText(firstValue(record, BRAND_KEYS));
  const model = normalizeText(firstValue(record, MODEL_KEYS));
  const variant = normalizeText(firstValue(record, VARIANT_KEYS));
  const priceEur = parsePrice(firstValue(record, PRICE_KEYS));
  const url = normalizeText(firstValue(record, URL_KEYS)) ?? 'https://example.invalid/market-feed';

  const combinedTitle = [brand, title, model, variant]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!combinedTitle || !priceEur) {
    return null;
  }

  return {
    id: combinedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: combinedTitle,
    subtitle: variant,
    shortDescription: [brand, model].filter(Boolean).join(' ').trim() || undefined,
    itemWebUrl: url,
    priceEur,
    shippingEur: 0,
    totalEur: priceEur,
    currency: 'EUR',
    buyingOptions: ['FIXED_PRICE'],
    aspects: [
      ...(brand ? [{ name: 'brand', value: brand }] : []),
      ...(model ? [{ name: 'model', value: model }] : []),
    ],
    boardBrand: brand,
    boardModel: variant,
    gpuModel: model,
    raw: record,
  };
}

function convertRecordToOffer(record: FlatRecord, listing: EbayListing): MarketOfferFeedOffer {
  return {
    title: listing.title,
    brand: listing.boardBrand,
    model: listing.gpuModel,
    variant: listing.boardModel,
    priceEur: listing.totalEur,
    url: listing.itemWebUrl,
    offerCount: parseInteger(firstValue(record, OFFER_COUNT_KEYS)),
    shopName: normalizeText(firstValue(record, SHOP_KEYS)),
    availability: normalizeText(firstValue(record, AVAILABILITY_KEYS)),
  };
}

function buildFeedFile(
  provider: 'billiger' | 'guenstiger',
  profiles: GpuProfile[],
  records: FlatRecord[],
): MarketOfferFeedFile {
  const entries = new Map<string, MarketOfferFeedEntry>();

  for (const record of records) {
    const listing = buildPseudoListing(record);
    if (!listing) {
      continue;
    }

    const match = selectProfileForListing(profiles, listing);
    if (!match) {
      continue;
    }

    const offer = convertRecordToOffer(record, listing);
    const existing = entries.get(match.profile.name) ?? {
      profileName: match.profile.name,
      profileAliases: match.profile.aliases,
      query: match.alias,
      offers: [],
    };
    existing.offers.push(offer);
    entries.set(match.profile.name, existing);
  }

  for (const entry of entries.values()) {
    entry.offers.sort((left, right) => left.priceEur - right.priceEur);
  }

  return {
    version: 1,
    provider,
    generatedAt: new Date().toISOString(),
    entries: Array.from(entries.values()).filter(entry => entry.offers.length > 0),
  };
}

export async function runRawFeedImport(
  profiles: GpuProfile[],
  options: RawFeedImporterOptions,
): Promise<boolean> {
  if (options.source === 'disabled') {
    return false;
  }

  try {
    const raw = await loadRawFeed(options);
    const records = parseRecords(raw, options.format);
    const feed = buildFeedFile(options.provider, profiles, records);
    if (feed.entries.length === 0) {
      logger.warn({ provider: options.provider }, 'Raw feed importer found no matching GPU offers');
      return false;
    }

    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.writeFile(options.outputPath, JSON.stringify(feed, null, 2));
    logger.info({
      provider: options.provider,
      entries: feed.entries.length,
      outputPath: options.outputPath,
    }, 'Raw market feed imported successfully');
    return true;
  } catch (error) {
    logger.warn({ error, provider: options.provider }, 'Raw market feed import failed');
    return false;
  }
}
