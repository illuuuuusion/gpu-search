import fs from 'node:fs/promises';
import type { GpuProfile, MarketReference, MarketReferenceFamily, MarketReferenceVariant } from '../../domain/models.js';
import { compactComparableText } from '../../domain/listingSignals.js';
import type {
  MarketOfferFeedEntry,
  MarketOfferFeedFile,
  MarketOfferFeedOffer,
  MarketReferenceProvider,
  MarketReferenceProviderId,
} from './types.js';
import { loadMarketReferenceCache, persistMarketReferenceCache } from './cacheStore.js';
import { logger } from '../../../../app/shared/logger.js';

type ProviderSourceMode = 'disabled' | 'file' | 'http';

interface JsonFeedMarketReferenceProviderOptions {
  id: MarketReferenceProviderId;
  displayName: string;
  sourceMode: ProviderSourceMode;
  feedFilePath?: string;
  feedUrl?: string;
  authToken?: string;
  authHeaderName?: string;
  requestTimeoutMs: number;
  cachePath: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeOffer(offer: MarketOfferFeedOffer): MarketOfferFeedOffer | null {
  const title = offer.title?.replace(/\s+/g, ' ').trim();
  if (!title || typeof offer.priceEur !== 'number' || !Number.isFinite(offer.priceEur) || offer.priceEur <= 0) {
    return null;
  }

  return {
    ...offer,
    title,
    priceEur: Number(offer.priceEur.toFixed(2)),
    brand: offer.brand?.replace(/\s+/g, ' ').trim() || undefined,
    model: offer.model?.replace(/\s+/g, ' ').trim() || undefined,
    variant: offer.variant?.replace(/\s+/g, ' ').trim() || undefined,
    url: offer.url?.trim() || undefined,
  };
}

function entryKeys(entry: MarketOfferFeedEntry): string[] {
  return [entry.profileName, ...(entry.profileAliases ?? [])]
    .map(value => normalizeText(value))
    .filter(Boolean);
}

function dedupeVariants(variants: MarketReferenceVariant[]): MarketReferenceVariant[] {
  const deduped = new Map<string, MarketReferenceVariant>();

  for (const variant of variants) {
    const title = variant.title.replace(/\s+/g, ' ').trim();
    if (!title || variant.lowestPriceEur <= 0) {
      continue;
    }

    const key = compactComparableText(title);
    const previous = deduped.get(key);
    if (!previous || variant.lowestPriceEur < previous.lowestPriceEur) {
      deduped.set(key, {
        title,
        lowestPriceEur: variant.lowestPriceEur,
        offerCount: variant.offerCount,
      });
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.lowestPriceEur - right.lowestPriceEur);
}

function groupOffersIntoFamilies(
  profile: GpuProfile,
  entry: MarketOfferFeedEntry,
  offers: MarketOfferFeedOffer[],
  fallbackUrl: string,
): MarketReferenceFamily[] {
  const families = new Map<string, MarketReferenceFamily>();

  for (const offer of offers) {
    const familyTitle = [offer.brand, offer.model ?? profile.name].filter(Boolean).join(' ').trim() || profile.name;
    const familyKey = compactComparableText(familyTitle);
    const family = families.get(familyKey) ?? {
      title: familyTitle,
      url: offer.url ?? entry.url ?? fallbackUrl,
      lowestPriceEur: offer.priceEur,
      offerCount: offer.offerCount,
      variants: [],
    };

    family.lowestPriceEur = Math.min(family.lowestPriceEur, offer.priceEur);
    family.offerCount = Math.max(family.offerCount ?? 0, offer.offerCount ?? 0) || undefined;
    family.variants.push({
      title: offer.title,
      lowestPriceEur: offer.priceEur,
      offerCount: offer.offerCount,
    });
    families.set(familyKey, family);
  }

  return Array.from(families.values())
    .map(family => ({
      ...family,
      variants: dedupeVariants(family.variants),
      lowestPriceEur: family.variants.length > 0
        ? Math.min(...family.variants.map(variant => variant.lowestPriceEur))
        : family.lowestPriceEur,
    }))
    .filter(family => family.lowestPriceEur > 0)
    .sort((left, right) => left.lowestPriceEur - right.lowestPriceEur);
}

function isFeedFile(value: unknown): value is MarketOfferFeedFile {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { entries?: unknown }).entries),
  );
}

export class JsonFeedMarketReferenceProvider implements MarketReferenceProvider {
  private readonly references = new Map<string, MarketReference>();
  private cacheLoaded = false;

  constructor(private readonly options: JsonFeedMarketReferenceProviderOptions) {}

  get id(): MarketReferenceProviderId {
    return this.options.id;
  }

  getReferences(): ReadonlyMap<string, MarketReference> {
    return this.references;
  }

  async refreshAll(profiles: GpuProfile[]): Promise<ReadonlyMap<string, MarketReference>> {
    await this.ensureCacheLoaded();

    if (this.options.sourceMode === 'disabled') {
      logger.info({ provider: this.options.id }, 'Market reference provider is disabled');
      return this.references;
    }

    try {
      const feed = await this.loadFeed();
      const nextReferences = this.buildReferences(feed, profiles);
      if (nextReferences.size === 0) {
        logger.warn({ provider: this.options.id }, 'Market reference feed did not produce any usable references');
        return this.references;
      }

      this.references.clear();
      for (const [profileName, reference] of nextReferences.entries()) {
        this.references.set(profileName, reference);
      }

      await persistMarketReferenceCache(this.options.cachePath, this.references);
    } catch (error) {
      logger.warn({
        error,
        provider: this.options.id,
      }, 'Failed to refresh market reference provider; keeping cached data');
    }

    return this.references;
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) {
      return;
    }

    const cachedReferences = await loadMarketReferenceCache(this.options.cachePath);
    this.references.clear();
    for (const [profileName, reference] of cachedReferences.entries()) {
      this.references.set(profileName, reference);
    }
    this.cacheLoaded = true;
  }

  private async loadFeed(): Promise<MarketOfferFeedFile> {
    if (this.options.sourceMode === 'file') {
      const filePath = this.options.feedFilePath;
      if (!filePath) {
        throw new Error(`${this.options.id}_feed_file_path_missing`);
      }

      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isFeedFile(parsed)) {
        throw new Error(`${this.options.id}_invalid_feed_file`);
      }
      return parsed;
    }

    const url = this.options.feedUrl;
    if (!url) {
      throw new Error(`${this.options.id}_feed_url_missing`);
    }

    const headers = new Headers({ accept: 'application/json' });
    if (this.options.authToken) {
      const headerName = this.options.authHeaderName?.trim() || 'Authorization';
      const value = headerName.toLowerCase() === 'authorization' && !this.options.authToken.startsWith('Bearer ')
        ? `Bearer ${this.options.authToken}`
        : this.options.authToken;
      headers.set(headerName, value);
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`${this.options.id}_feed_http_${response.status}`);
    }

    const parsed = JSON.parse(await response.text()) as unknown;
    if (!isFeedFile(parsed)) {
      throw new Error(`${this.options.id}_invalid_feed_payload`);
    }

    return parsed;
  }

  private buildReferences(feed: MarketOfferFeedFile, profiles: GpuProfile[]): Map<string, MarketReference> {
    const entriesByKey = new Map<string, MarketOfferFeedEntry>();
    for (const entry of feed.entries) {
      if (!entry?.profileName || !Array.isArray(entry.offers)) {
        continue;
      }

      for (const key of entryKeys(entry)) {
        if (!entriesByKey.has(key)) {
          entriesByKey.set(key, entry);
        }
      }
    }

    const references = new Map<string, MarketReference>();
    const fetchedAt = feed.generatedAt ?? new Date().toISOString();
    const fallbackUrl = this.options.feedUrl ?? `https://${this.options.id}.de`;

    for (const profile of profiles) {
      const profileKeys = [profile.name, ...profile.aliases]
        .map(value => normalizeText(value))
        .filter(Boolean);
      const entry = profileKeys
        .map(key => entriesByKey.get(key))
        .find((candidate): candidate is MarketOfferFeedEntry => Boolean(candidate));
      if (!entry) {
        continue;
      }

      const offers = entry.offers
        .map(normalizeOffer)
        .filter((offer): offer is MarketOfferFeedOffer => Boolean(offer));
      if (offers.length === 0) {
        continue;
      }

      const families = groupOffersIntoFamilies(profile, entry, offers, fallbackUrl);
      if (families.length === 0) {
        continue;
      }

      references.set(profile.name, {
        source: this.options.id,
        query: entry.query?.trim() || profile.name,
        url: entry.url?.trim() || families[0]?.url || fallbackUrl,
        lowestPriceEur: Math.min(...families.map(family => family.lowestPriceEur)),
        fetchedAt,
        families,
        note: entry.note,
      });
    }

    return references;
  }
}
