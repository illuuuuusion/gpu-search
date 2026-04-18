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
  prices: PriceLimits;
}

export interface EbayListing {
  id: string;
  title: string;
  itemWebUrl: string;
  itemOriginDate?: string;
  priceEur: number;
  shippingEur: number;
  totalEur: number;
  currency: string;
  country?: string;
  buyingOptions: OfferType[];
  condition?: string;
  sellerUsername?: string;
  sellerFeedbackPercent?: number;
  sellerFeedbackScore?: number;
  bidCount?: number;
  itemEndDate?: string;
  imageUrl?: string;
  raw: unknown;
}

export interface EvaluatedListing {
  profile: GpuProfile;
  listing: EbayListing;
  health: ListingHealth;
  accepted: boolean;
  reasons: string[];
  score: number;
}

export interface EbaySearchPage {
  listings: EbayListing[];
  hasNext: boolean;
  limit: number;
  offset: number;
}
