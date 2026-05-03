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
  targetHealth?: 'ANY' | 'WORKING' | 'DEFECT';
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
  source: 'geizhals' | 'billiger' | 'guenstiger' | 'composite' | 'override';
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
  marketLowestPriceEur: number;
  marketMedianPriceEur: number;
  familyLowestPriceEur: number;
  familyMedianPriceEur: number;
  brandMatchedPriceEur?: number;
  pricingAnchor: 'brand_family_median' | 'family_median' | 'family_lowest' | 'market_median' | 'market_lowest';
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

export interface MarketChartPoint {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  acceptedCount: number;
  workingCount: number;
  defectCount: number;
  averageTotalPriceEur?: number;
  averageWorkingPriceEur?: number;
  averageDefectPriceEur?: number;
  averageScore: number;
  minTotalPriceEur?: number;
  maxTotalPriceEur?: number;
}

export interface MarketBarDatum {
  key: string;
  label: string;
  value: number;
}

export interface ProfileMarketSnapshot extends ProfileMarketStats {
  category: string;
  targetHealth?: 'ANY' | 'WORKING' | 'DEFECT';
  charts: {
    daily: MarketChartPoint[];
    weekly: MarketChartPoint[];
  };
}

export interface MarketDashboardSnapshot {
  generatedAt: string;
  windowDays: number;
  snapshotPath: string;
  profiles: ProfileMarketSnapshot[];
  activeListings: Array<{
    listingId: string;
    profileName: string;
    sentAt: string;
    lastAvailabilityCheckAt?: string;
    lastAvailabilityState?: 'available' | 'unavailable' | 'check_failed';
    lastAvailabilityReason?: string;
    availabilityCheckFailures?: number;
  }>;
  barCharts: {
    acceptedCountByProfile: MarketBarDatum[];
    averageWorkingPriceByProfile: MarketBarDatum[];
    averageDefectPriceByProfile: MarketBarDatum[];
    averageScoreByProfile: MarketBarDatum[];
  };
}

export interface MarketDigestTopProfile {
  profileName: string;
  category: string;
  acceptedCount: number;
  workingCount: number;
  defectCount: number;
  averageTotalPriceEur?: number;
  averageScore: number;
}

export interface MarketDigestMessage {
  cadence: 'daily' | 'weekly';
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  totalAcceptedListings: number;
  totalWorkingListings: number;
  totalDefectListings: number;
  snapshotPath: string;
  topProfiles: MarketDigestTopProfile[];
}

export interface RepairabilityAssessment {
  score: number;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
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
  evaluationMode?: 'normal' | 'debug';
  accepted: boolean;
  reasons: string[];
  score: number;
  baseLimitEur: number;
  effectiveLimitEur: number;
  limitHeadroomPercent: number;
  referenceMatch?: MarketReferenceMatch;
  retailDiscountPercent?: number;
  retailAnchorPriceEur?: number;
  repairability?: RepairabilityAssessment;
  marketStats?: ProfileMarketStats;
}

export interface EbaySearchPage {
  listings: EbayListing[];
  hasNext: boolean;
  limit: number;
  offset: number;
}
