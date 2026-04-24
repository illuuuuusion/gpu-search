import { defectTerms, exclusionTerms } from '../config/exclusionTerms.js';
import { env } from '../config/env.js';
import type { EbayListing, EvaluatedListing, GpuProfile, ListingHealth, MarketReferenceMatch, OfferType } from '../types/domain.js';
import { buildListingSearchText, getListingTextSources } from './listingSignals.js';

const allowedCountries = new Set(env.ALLOW_COUNTRIES.split(',').map(v => v.trim().toUpperCase()));
const accessoryPatterns: Array<{ reason: string; regex: RegExp }> = [
  { reason: 'accessory_fan', regex: /\b(?:vga|gpu|graphics(?:\s+card)?|grafikkarte)\s+fan\b/i },
  { reason: 'accessory_fan', regex: /\b(?:cooling|replacement)\s+fan\b/i },
  { reason: 'accessory_fan', regex: /\b(?:kühlventilator(?:en)?|ventilator(?:en)?|lüfter)\b/i },
  { reason: 'accessory_cooling', regex: /\b(?:radiator|heatsink|kühlung)\b/i },
  { reason: 'accessory_waterblock', regex: /\b(?:water\s?block|wasserblock|wasserkühler|gpu\s+block|ekwb|alphacool|barrow|bykski)\b/i },
  { reason: 'accessory_power', regex: /\b(?:netzteil|ladegerät|ladekabel|power\s+supply|power\s+cable|stromkabel)\b/i },
  { reason: 'accessory_cable', regex: /\b(?:12vhpwr|16pin|8pin|pcie|pci-e|riser(?:-kabel|\s+cable)?|extension\s+cable|verlängerungskabel|splitter|converter|connector|oculink|dock)\b/i },
  { reason: 'accessory_packaging', regex: /\b(?:leerkarton|empty\s+box|box\s+only|ovp\s+only|nur\s+ovp|nur\s+verpackung|verpackung\s+ohne\s+inhalt)\b/i },
  { reason: 'accessory_av', regex: /\b(?:hdmi|displayport|dp\s*2\.1|usb-c|usb c)\s*(?:kabel|cable|adapter|switch|splitter|hub)\b/i },
  { reason: 'accessory_misc', regex: /\b(?:storage\s+bag|bag|steam\s+code|code\s+steam|laptop)\b/i },
  { reason: 'accessory_part_number', regex: /\b(?:t\d{6,}|pla\d{5,}|pld\d{5,}|ga\d{5,}|cf\d{4,})\w*\b/i },
];
const systemPatterns: Array<{ reason: string; regex: RegExp }> = [
  { reason: 'system_desktop', regex: /\b(?:gaming|office|desktop|tower|mini)\s*pc\b/i },
  { reason: 'system_desktop', regex: /\b(?:komplett(?:system|rechner)?|fertig\s*pc|pc\s*system|desktop\s*computer|gaming\s*computer)\b/i },
  { reason: 'system_laptop', regex: /\b(?:laptop|notebook|ultrabook)\b/i },
  { reason: 'system_workstation', regex: /\b(?:dell\s+precision|precision\s+\d{4}|thinkstation|z\d{3,}\s+workstation|cad\s+workstation)\b/i },
  { reason: 'system_barebone', regex: /\b(?:intel\s+nuc|nuc\s+\d|barebone)\b/i },
  { reason: 'system_component', regex: /\b(?:mainboard|motherboard|logic\s+board)\b/i },
  { reason: 'system_builder', regex: /\b(?:mifcom|dubaro|megaport|agando|memory:?pc)\b/i },
];
const systemCpuPatterns = [
  /\b(?:i[3579]-\d{4,5}[a-z]{0,2}|i[3579]\s+\d{4,5}[a-z]{0,2}|ryzen\s+[3579]\s+\d{3,4}[a-z]{0,2}|xeon(?:\s+\w+)?|threadripper)\b/i,
];
const systemBundlePatterns = [
  /\b(?:16|32|64|128)\s*gb\s*ram\b/i,
  /\b(?:ram|ddr4|ddr5|ssd|nvme|hdd|windows\s+1[01]|win\s+1[01])\b/i,
];
const DEBUG_PRICE_LIMIT_MULTIPLIER = 10;

function includesAny(haystack: string, needles: string[]): string[] {
  const normalized = haystack.toLowerCase();
  return needles.filter(term => normalized.includes(term.toLowerCase()));
}

function extractStringValues(value: unknown, depth = 0, values: string[] = []): string[] {
  if (depth > 3 || values.length >= 24 || value == null) {
    return values;
  }

  if (typeof value === 'string') {
    values.push(value);
    return values;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractStringValues(item, depth + 1, values);
      if (values.length >= 24) break;
    }
    return values;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      extractStringValues(nested, depth + 1, values);
      if (values.length >= 24) break;
    }
  }

  return values;
}

function accessoryReason(text: string): string | null {
  for (const pattern of accessoryPatterns) {
    if (pattern.regex.test(text)) {
      return pattern.reason;
    }
  }

  return null;
}

function systemReason(text: string): string | null {
  for (const pattern of systemPatterns) {
    if (pattern.regex.test(text)) {
      return pattern.reason;
    }
  }

  const looksLikeSystemBundle = systemCpuPatterns.some(pattern => pattern.test(text))
    && systemBundlePatterns.some(pattern => pattern.test(text));

  if (looksLikeSystemBundle) {
    return 'system_bundle';
  }

  return null;
}

function resolveHealth(listing: EbayListing): { health: ListingHealth; reasons: string[] } {
  const exclusionHits = includesAny(listing.title, exclusionTerms);
  if (exclusionHits.length > 0) {
    return { health: 'EXCLUDED', reasons: [`exclusion_terms=${exclusionHits.join(', ')}`] };
  }

  const seenTexts = new Set(getListingTextSources(listing).map(source => source.text));
  const healthSources: Array<{ label: string; text: string | undefined }> = [
    ...getListingTextSources(listing),
    ...extractStringValues(listing.raw)
      .filter(text => !seenTexts.has(text))
      .map(text => ({ label: 'raw', text })),
  ];

  for (const source of healthSources) {
    if (!source.text) continue;

    const defectHits = includesAny(source.text, defectTerms);
    if (defectHits.length > 0) {
      return { health: 'DEFECT', reasons: [`${source.label}_defect_terms=${defectHits.join(', ')}`] };
    }
  }

  return { health: 'WORKING', reasons: [] };
}

function shippingAccepted(price: number, shipping: number): boolean {
  const dynamicLimit = Math.min(env.MAX_SHIPPING_HARD_CAP_EUR, price * 0.2);
  return shipping <= dynamicLimit;
}

function isAuctionEndingSoon(itemEndDate?: string): boolean {
  if (!itemEndDate) return false;
  const diffMs = new Date(itemEndDate).getTime() - Date.now();
  return diffMs > 0 && diffMs <= 5 * 60 * 60 * 1000;
}

function baseLimitForOfferType(offerType: OfferType, profile: GpuProfile, health: ListingHealth): number {
  return offerType === 'FIXED_PRICE'
    ? (health === 'DEFECT' ? profile.prices.buyNowDefect : profile.prices.buyNowWorking)
    : (health === 'DEFECT' ? profile.prices.auctionDefect : profile.prices.auctionWorking);
}

function acceptedForOfferType(offerType: OfferType, listing: EbayListing, limit: number): boolean {
  if (offerType === 'AUCTION' && !isAuctionEndingSoon(listing.itemEndDate)) {
    return false;
  }

  return listing.totalEur <= limit;
}

function calculatePercentDelta(referencePrice: number, actualPrice: number): number {
  if (referencePrice <= 0) return 0;
  return Number((((referencePrice - actualPrice) / referencePrice) * 100).toFixed(2));
}

function effectiveLimitForListing(
  listing: EbayListing,
  profile: GpuProfile,
  health: ListingHealth,
  offerType: OfferType,
  referenceMatch?: MarketReferenceMatch,
  evaluationMode: 'normal' | 'debug' = 'normal',
): {
  baseLimitEur: number;
  effectiveLimitEur: number;
  retailDiscountPercent?: number;
  limitHeadroomPercent: number;
} {
  const baseLimitEur = Number((
    baseLimitForOfferType(offerType, profile, health) *
    (evaluationMode === 'debug' ? DEBUG_PRICE_LIMIT_MULTIPLIER : 1)
  ).toFixed(2));
  const minimumRetailDiscountPercent = evaluationMode === 'debug'
    ? 0
    : (profile.minimumRetailDiscountPercent ?? 0);

  let effectiveLimitEur = baseLimitEur;
  let retailDiscountPercent: number | undefined;

  if (health === 'WORKING' && minimumRetailDiscountPercent > 0 && referenceMatch?.priceEur) {
    retailDiscountPercent = calculatePercentDelta(referenceMatch.priceEur, listing.totalEur);
    const retailGateLimit = Number((referenceMatch.priceEur * (1 - minimumRetailDiscountPercent / 100)).toFixed(2));
    effectiveLimitEur = Math.min(baseLimitEur, retailGateLimit);
  }

  return {
    baseLimitEur,
    effectiveLimitEur,
    retailDiscountPercent,
    limitHeadroomPercent: calculatePercentDelta(effectiveLimitEur, listing.totalEur),
  };
}

function scoreListing(priceEvaluation: {
  retailDiscountPercent?: number;
  limitHeadroomPercent: number;
}): number {
  return Number((priceEvaluation.retailDiscountPercent ?? priceEvaluation.limitHeadroomPercent).toFixed(2));
}

function rejectedResult(
  profile: GpuProfile,
  listing: EbayListing,
  health: ListingHealth,
  reasons: string[],
): EvaluatedListing {
  return {
    profile,
    listing,
    health,
    accepted: false,
    reasons,
    score: 0,
    baseLimitEur: 0,
    effectiveLimitEur: 0,
    limitHeadroomPercent: 0,
  };
}

export function evaluateListing(
  profile: GpuProfile,
  listing: EbayListing,
  referenceMatch?: MarketReferenceMatch,
  options: { evaluationMode?: 'normal' | 'debug' } = {},
): EvaluatedListing {
  const evaluationMode = options.evaluationMode ?? 'normal';
  const reasons: string[] = [];
  const title = listing.title.toLowerCase();

  for (const negative of profile.negativeAliases) {
    if (title.includes(negative.toLowerCase())) {
      reasons.push(`negative_alias=${negative}`);
      return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
  }

  if (profile.onlyGermany && listing.country && listing.country.toUpperCase() !== 'DE') {
    reasons.push(`country_not_allowed=${listing.country}`);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  if (listing.country && !allowedCountries.has(listing.country.toUpperCase())) {
    reasons.push(`country_not_allowed=${listing.country}`);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  if (profile.excludeNew && /\b(?:new|neu|brandneu)\b/i.test(listing.condition ?? '')) {
    reasons.push('condition_new');
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  if ((listing.sellerFeedbackPercent ?? 100) < env.MIN_SELLER_FEEDBACK_PERCENT && (listing.sellerFeedbackScore ?? 0) >= 10) {
    reasons.push(`seller_feedback_below_threshold=${listing.sellerFeedbackPercent}`);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  if (listing.priceEur <= 0 || listing.totalEur <= 0) {
    reasons.push(`invalid_price=${listing.totalEur}`);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  const healthResult = resolveHealth(listing);
  reasons.push(...healthResult.reasons);

  if (healthResult.health === 'EXCLUDED') {
    return rejectedResult(profile, listing, healthResult.health, reasons);
  }

  const targetHealth = profile.targetHealth ?? 'ANY';
  if (targetHealth === 'DEFECT' && healthResult.health !== 'DEFECT') {
    reasons.push(`health_mismatch=${healthResult.health.toLowerCase()}`);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  if (targetHealth === 'WORKING' && healthResult.health !== 'WORKING') {
    reasons.push(`health_mismatch=${healthResult.health.toLowerCase()}`);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  const accessoryHit = accessoryReason(buildListingSearchText(listing));
  if (accessoryHit) {
    reasons.push(accessoryHit);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  const systemHit = systemReason(buildListingSearchText(listing));
  if (systemHit) {
    reasons.push(systemHit);
    return rejectedResult(profile, listing, 'EXCLUDED', reasons);
  }

  if (!shippingAccepted(listing.priceEur, listing.shippingEur)) {
    reasons.push(`shipping_too_high=${listing.shippingEur}`);
    return rejectedResult(profile, listing, healthResult.health, reasons);
  }

  const offerType = listing.buyingOptions.includes('FIXED_PRICE') ? 'FIXED_PRICE' : 'AUCTION';
  const priceEvaluation = effectiveLimitForListing(
    listing,
    profile,
    healthResult.health,
    offerType,
    referenceMatch,
    evaluationMode,
  );
  const accepted = acceptedForOfferType(offerType, listing, priceEvaluation.effectiveLimitEur);
  if (!accepted) reasons.push('price_above_limit_or_auction_not_soon');

  return {
    profile,
    listing,
    health: healthResult.health,
    evaluationMode,
    accepted,
    reasons,
    score: scoreListing(priceEvaluation),
    baseLimitEur: priceEvaluation.baseLimitEur,
    effectiveLimitEur: priceEvaluation.effectiveLimitEur,
    limitHeadroomPercent: priceEvaluation.limitHeadroomPercent,
    referenceMatch,
    retailDiscountPercent: priceEvaluation.retailDiscountPercent,
  };
}
