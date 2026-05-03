import { env } from '../../../../app/env/index.js';
import { logger } from '../../../../app/shared/logger.js';
import { compactComparableText } from '../../domain/listingSignals.js';
import type { GpuProfile, MarketReference, MarketReferenceFamily } from '../../domain/models.js';
import { matchMarketReference } from './matcher.js';
import type { MarketReferenceProvider, MarketReferenceService } from './types.js';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeFamilies(families: MarketReferenceFamily[]): MarketReferenceFamily[] {
  const deduped = new Map<string, MarketReferenceFamily>();

  for (const family of families) {
    const key = `${compactComparableText(family.title)}::${family.url}`;
    const previous = deduped.get(key);
    if (!previous || family.lowestPriceEur < previous.lowestPriceEur) {
      deduped.set(key, family);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.lowestPriceEur - right.lowestPriceEur);
}

function mergeReferences(profileName: string, references: MarketReference[]): MarketReference {
  if (references.length === 1) {
    return references[0] as MarketReference;
  }

  const families = dedupeFamilies(references.flatMap(reference => reference.families));
  const fetchedAt = references
    .map(reference => reference.fetchedAt)
    .sort()
    .at(-1) ?? new Date().toISOString();

  return {
    source: 'composite',
    query: uniqueStrings(references.map(reference => reference.query)).join(' | ') || profileName,
    url: references[0]?.url ?? 'https://example.invalid/reference',
    lowestPriceEur: Math.min(...references.map(reference => reference.lowestPriceEur)),
    fetchedAt,
    families,
    note: `Merged providers: ${uniqueStrings(references.map(reference => reference.source)).join(', ')}`,
  };
}

export class CompositeMarketReferenceService implements MarketReferenceService {
  private readonly references = new Map<string, MarketReference>();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly providers: MarketReferenceProvider[]) {}

  async start(profiles: GpuProfile[]): Promise<void> {
    await this.refreshAll(profiles);
    this.scheduleNextRefresh(profiles);
  }

  async refreshAll(profiles: GpuProfile[]): Promise<void> {
    for (const provider of this.providers) {
      try {
        await provider.refreshAll(profiles);
      } catch (error) {
        logger.warn({ error, provider: provider.id }, 'Market reference provider refresh failed');
      }
    }

    this.references.clear();
    for (const profile of profiles) {
      const providerReferences = this.providers
        .map(provider => provider.getReferences().get(profile.name))
        .filter((reference): reference is MarketReference => Boolean(reference));
      if (providerReferences.length === 0) {
        continue;
      }

      this.references.set(profile.name, mergeReferences(profile.name, providerReferences));
    }
  }

  matchReference(profile: GpuProfile, listing: import('../../domain/models.js').EbayListing) {
    const reference = this.references.get(profile.name);
    if (!reference) {
      return undefined;
    }

    return matchMarketReference(profile, listing, reference);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    for (const provider of this.providers) {
      provider.stop?.();
    }
  }

  private scheduleNextRefresh(profiles: GpuProfile[]): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const nextRun = new Date();
    nextRun.setHours(env.MARKET_REFERENCE_REFRESH_HOUR, 0, 0, 0);
    if (nextRun.getTime() <= Date.now()) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    this.refreshTimer = setTimeout(() => {
      void this.refreshAll(profiles)
        .catch(error => {
          logger.warn({ error }, 'scheduled market reference refresh failed');
        })
        .finally(() => this.scheduleNextRefresh(profiles));
    }, nextRun.getTime() - Date.now());
  }
}
