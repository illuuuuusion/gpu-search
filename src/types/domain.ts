export type OfferType = 'FIXED_PRICE' | 'AUCTION';
export type ListingHealth = 'WORKING' | 'DEFECT' | 'EXCLUDED' | 'UNKNOWN';

export interface PriceLimits {
  buyNowWorking: number;
  buyNowDefect: number;
  auctionWorking: number;
  auctionDefect: number;
}

export interface GpuProfile {
  name: string;
  aliases: string[];
  negativeAliases: string[];
  vramGb: number;
  category: string;
  vramVariants: boolean;
  excludeNew: boolean;
  onlyGermany: boolean;
  minimumRetailDiscountPercent?: number;
  prices: PriceLimits;
}

export interface MarketReferenceVariant {
  title: string;
  lowestPriceEur: number;
  offerCount?: number;
}

export interface MarketReferenceFamily {
  title: string;
  url: string;
  lowestPriceEur: number;
  offerCount?: number;
  variants: MarketReferenceVariant[];
}

export interface MarketReference {
  source: 'geizhals' | 'override';
  query: string;
  url: string;
  lowestPriceEur: number;
  fetchedAt: string;
  families: MarketReferenceFamily[];
  note?: string;
}

export interface MarketReferenceMatch {
  reference: MarketReference;
  family: MarketReferenceFamily;
  variant?: MarketReferenceVariant;
  priceEur: number;
  strategy: 'title_variant' | 'price_proximity' | 'family_lowest';
  similarityScore: number;
  matchedTitle: string;
  url: string;
}

export interface EbayListingAspect {
  name: string;
  value: string;
}

export interface ProfileMarketStats {
  profileName: string;
  windowDays: number;
  acceptedCount: number;
  averageScore: number;
  workingCount: number;
  averageWorkingPriceEur?: number;
  defectCount: number;
  averageDefectPriceEur?: number;
  lastObservedAt?: string;
}

export interface EbayListing {
  id: string;
  title: string;
  subtitle?: string;
  shortDescription?: string;
  description?: string;
  itemWebUrl: string;
  itemOriginDate?: string;
  priceEur: number;
  shippingEur: number;
  totalEur: number;
  currency: string;
  country?: string;
  buyingOptions: OfferType[];
  condition?: string;
  sellerFeedbackPercent?: number;
  sellerFeedbackScore?: number;
  bidCount?: number;
  itemEndDate?: string;
  imageUrl?: string;
  aspects: EbayListingAspect[];
  boardBrand?: string;
  boardModel?: string;
  gpuModel?: string;
  raw: unknown;
}

export interface EvaluatedListing {
  profile: GpuProfile;
  listing: EbayListing;
  health: ListingHealth;
  accepted: boolean;
  reasons: string[];
  score: number;
  baseLimitEur: number;
  effectiveLimitEur: number;
  limitHeadroomPercent: number;
  referenceMatch?: MarketReferenceMatch;
  retailDiscountPercent?: number;
  marketStats?: ProfileMarketStats;
}

export interface EbaySearchPage {
  listings: EbayListing[];
  hasNext: boolean;
  limit: number;
  offset: number;
}
