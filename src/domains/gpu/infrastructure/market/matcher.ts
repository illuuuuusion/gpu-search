import { env } from '../../../../app/env/index.js';
import { buildListingReferenceText } from '../../domain/listingSignals.js';
import type {
  EbayListing,
  GpuProfile,
  MarketReference,
  MarketReferenceFamily,
  MarketReferenceMatch,
  MarketReferenceVariant,
} from '../../domain/models.js';

const GENERIC_MATCH_TOKENS = new Set([
  'graphics',
  'graphic',
  'card',
  'grafikkarte',
  'geforce',
  'radeon',
  'nvidia',
  'amd',
  'intel',
  'gb',
  'gddr5',
  'gddr6',
  'gddr6x',
  'gddr7',
  'hdmi',
  'dp',
  'displayport',
  'pcie',
  'pci',
  'retail',
  'aktiv',
  'neu',
  'used',
  'gebraucht',
  'desktop',
  'edition',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenizeMatchText(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .filter(token => token.length > 1 && !GENERIC_MATCH_TOKENS.has(token));
}

function scoreTitleSimilarity(listing: EbayListing, left: string, right: string): number {
  const leftTokens = tokenizeMatchText(left);
  const rightTokens = tokenizeMatchText(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter(token => rightSet.has(token));
  const union = new Set([...leftSet, ...rightSet]);

  let score = intersection.length / Math.max(union.size, 1);
  if (intersection.length > 0 && leftTokens[0] === rightTokens[0]) {
    score += 0.15;
  }

  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) {
    score += 0.15;
  }

  const boardBrand = listing.boardBrand ? normalizeText(listing.boardBrand) : undefined;
  if (boardBrand && rightNormalized.includes(boardBrand)) {
    score += 0.2;
  }

  const boardModel = listing.boardModel ? normalizeText(listing.boardModel) : undefined;
  if (boardModel && rightNormalized.includes(boardModel)) {
    score += 0.1;
  }

  return Number(score.toFixed(4));
}

function absolutePercentDistance(referencePrice: number, candidatePrice: number): number {
  if (referencePrice <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs((referencePrice - candidatePrice) / referencePrice);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(2));
  }

  return Number((sorted[middle] ?? 0).toFixed(2));
}

function familyMedianPrice(family: MarketReferenceFamily): number {
  return median(variantsForFamily(family).map(variant => variant.lowestPriceEur));
}

function marketMedianPrice(reference: MarketReference): number {
  return median(reference.families.flatMap(family => variantsForFamily(family).map(variant => variant.lowestPriceEur)));
}

function brandMatchedPrice(
  reference: MarketReference,
  boardBrand: string | undefined,
): number | undefined {
  if (!boardBrand) {
    return undefined;
  }

  const normalizedBrand = normalizeText(boardBrand);
  const brandFamilies = reference.families.filter(family =>
    normalizeText(family.title).includes(normalizedBrand) ||
    family.variants.some(variant => normalizeText(variant.title).includes(normalizedBrand)));
  if (brandFamilies.length === 0) {
    return undefined;
  }

  return median(brandFamilies.flatMap(family => variantsForFamily(family).map(variant => variant.lowestPriceEur)));
}

export function isReferenceFresh(reference: MarketReference): boolean {
  const ageMs = Date.now() - new Date(reference.fetchedAt).getTime();
  return ageMs <= env.MARKET_REFERENCE_CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;
}

function variantsForFamily(family: MarketReferenceFamily): MarketReferenceVariant[] {
  return family.variants.length > 0
    ? family.variants
    : [{ title: family.title, lowestPriceEur: family.lowestPriceEur, offerCount: family.offerCount }];
}

export function matchMarketReference(
  profile: GpuProfile,
  listing: EbayListing,
  reference: MarketReference,
): MarketReferenceMatch | undefined {
  if (!isReferenceFresh(reference) || reference.families.length === 0) {
    return undefined;
  }

  const listingReferenceText = buildListingReferenceText(listing);
  let bestTitleMatch:
    | {
        family: MarketReferenceFamily;
        variant: MarketReferenceVariant;
        similarityScore: number;
      }
    | undefined;

  for (const family of reference.families) {
    for (const variant of variantsForFamily(family)) {
      const similarityScore = scoreTitleSimilarity(listing, listingReferenceText, variant.title);
      if (!bestTitleMatch || similarityScore > bestTitleMatch.similarityScore) {
        bestTitleMatch = { family, variant, similarityScore };
      }
    }
  }

  const marketLowestPriceEur = reference.lowestPriceEur;
  const marketMedianPriceEur = marketMedianPrice(reference);
  const matchedFamily = bestTitleMatch?.family ?? reference.families[0];
  const familyLowestPriceEur = matchedFamily?.lowestPriceEur ?? marketLowestPriceEur;
  const familyMedianPriceEur = matchedFamily ? familyMedianPrice(matchedFamily) : marketMedianPriceEur;
  const brandMatchedPriceEur = brandMatchedPrice(reference, listing.boardBrand);

  const buildMatch = (
    family: MarketReferenceFamily,
    variant: MarketReferenceVariant | undefined,
    strategy: 'title_variant' | 'price_proximity' | 'family_lowest',
    similarityScore: number,
    matchedTitle: string,
    url: string,
  ): MarketReferenceMatch => {
    const pricingAnchor = brandMatchedPriceEur
      ? 'brand_family_median'
      : familyMedianPriceEur > 0
        ? 'family_median'
        : familyLowestPriceEur > 0
          ? 'family_lowest'
          : marketMedianPriceEur > 0
            ? 'market_median'
            : 'market_lowest';
    const priceEur = pricingAnchor === 'brand_family_median'
      ? (brandMatchedPriceEur ?? familyMedianPriceEur)
      : pricingAnchor === 'family_median'
        ? familyMedianPriceEur
        : pricingAnchor === 'family_lowest'
          ? familyLowestPriceEur
          : pricingAnchor === 'market_median'
            ? marketMedianPriceEur
            : marketLowestPriceEur;

    return {
      reference,
      family,
      variant,
      priceEur,
      marketLowestPriceEur,
      marketMedianPriceEur,
      familyLowestPriceEur,
      familyMedianPriceEur,
      brandMatchedPriceEur,
      pricingAnchor,
      strategy,
      similarityScore,
      matchedTitle,
      url,
    };
  };

  if (bestTitleMatch && bestTitleMatch.similarityScore >= env.MARKET_REFERENCE_VARIANT_MATCH_THRESHOLD) {
    return buildMatch(
      bestTitleMatch.family,
      bestTitleMatch.variant,
      'title_variant',
      bestTitleMatch.similarityScore,
      bestTitleMatch.variant.title,
      bestTitleMatch.family.url,
    );
  }

  const priceNearest = reference.families
    .flatMap(family => variantsForFamily(family).map(variant => ({ family, variant })))
    .sort((left, right) =>
      absolutePercentDistance(left.variant.lowestPriceEur, listing.totalEur) -
      absolutePercentDistance(right.variant.lowestPriceEur, listing.totalEur))[0];

  if (priceNearest) {
    return buildMatch(
      priceNearest.family,
      priceNearest.variant,
      'price_proximity',
      bestTitleMatch?.similarityScore ?? 0,
      priceNearest.variant.title,
      priceNearest.family.url,
    );
  }

  const cheapestFamily = reference.families.reduce((best, family) =>
    family.lowestPriceEur < best.lowestPriceEur ? family : best);

  return buildMatch(
    cheapestFamily,
    undefined,
    'family_lowest',
    bestTitleMatch?.similarityScore ?? 0,
    cheapestFamily.title,
    cheapestFamily.url,
  );
}
