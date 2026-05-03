import type { EbayListing, GpuProfile, MarketReference, MarketReferenceMatch } from '../../domain/models.js';

export type MarketReferenceProviderId = 'billiger' | 'guenstiger';
export type MarketReferenceRuntimeProvider = MarketReferenceProviderId | 'composite';

export interface MarketReferenceReader {
  matchReference(profile: GpuProfile, listing: EbayListing): MarketReferenceMatch | undefined;
}

export interface MarketReferenceService extends MarketReferenceReader {
  start(profiles: GpuProfile[]): Promise<void>;
  refreshAll(profiles: GpuProfile[]): Promise<void>;
  stop(): void;
}

export interface MarketReferenceProvider {
  readonly id: MarketReferenceProviderId;
  refreshAll(profiles: GpuProfile[]): Promise<ReadonlyMap<string, MarketReference>>;
  getReferences(): ReadonlyMap<string, MarketReference>;
  stop?(): void;
}

export interface MarketReferenceCacheFile {
  version: 1;
  updatedAt: string;
  entries: Array<MarketReference & { profileName: string }>;
}

export interface MarketOfferFeedOffer {
  title: string;
  priceEur: number;
  url?: string;
  brand?: string;
  model?: string;
  variant?: string;
  offerCount?: number;
  shopName?: string;
  availability?: string;
}

export interface MarketOfferFeedEntry {
  profileName: string;
  profileAliases?: string[];
  query?: string;
  url?: string;
  note?: string;
  offers: MarketOfferFeedOffer[];
}

export interface MarketOfferFeedFile {
  version: 1;
  provider?: string;
  generatedAt?: string;
  entries: MarketOfferFeedEntry[];
}
