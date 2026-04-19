import axios from 'axios';
import { env, getEbayApiBaseUrl } from '../../config/env.js';
import type { EbayListing, EbaySearchPage, GpuProfile } from '../../types/domain.js';
import type { SearchBucket } from '../../config/searchBuckets.js';
import { searchMockBucketListingsPage } from './mock.js';
import { getEbayAccessToken } from './oauth.js';
import { extractListingIdentity } from '../../core/listingSignals.js';

interface EbaySearchResponse {
  itemSummaries?: Array<Record<string, unknown>>;
  limit?: number;
  next?: string;
  offset?: number;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAspectValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => toAspectValues(item)).slice(0, 6);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      ...toAspectValues(record.value),
      ...toAspectValues(record.localizedValue),
      ...toAspectValues(record.valueName),
    ].slice(0, 6);
  }

  return [];
}

function mapLocalizedAspects(item: Record<string, unknown>): EbayListing['aspects'] {
  const localizedAspects = Array.isArray(item.localizedAspects)
    ? item.localizedAspects as Array<Record<string, unknown>>
    : [];
  const deduped = new Map<string, EbayListing['aspects'][number]>();

  for (const aspect of localizedAspects) {
    const name = typeof aspect.name === 'string'
      ? aspect.name.replace(/\s+/g, ' ').trim()
      : '';
    if (!name) continue;

    const values = [
      ...toAspectValues(aspect.value),
      ...toAspectValues(aspect.localizedValues),
      ...toAspectValues(aspect.values),
    ];

    for (const value of values) {
      const trimmedValue = value.replace(/\s+/g, ' ').trim();
      if (!trimmedValue) continue;

      const key = `${name.toLowerCase()}::${trimmedValue.toLowerCase()}`;
      if (!deduped.has(key)) {
        deduped.set(key, { name, value: trimmedValue });
      }
    }
  }

  return Array.from(deduped.values());
}

function mapListing(item: Record<string, unknown>): EbayListing {
  const shippingOptions = Array.isArray(item.shippingOptions) ? item.shippingOptions as Array<Record<string, unknown>> : [];
  const firstShipping = shippingOptions[0] ?? {};
  const priceValue = toNumber((item.price as Record<string, unknown> | undefined)?.value);
  const shippingValue = toNumber((firstShipping.shippingCost as Record<string, unknown> | undefined)?.value);
  const buyingOptions = (Array.isArray(item.buyingOptions) ? item.buyingOptions : []) as Array<'FIXED_PRICE' | 'AUCTION'>;
  const seller = (item.seller as Record<string, unknown> | undefined) ?? {};
  const feedback = (seller.feedbackPercentage as number | undefined) ?? undefined;
  const title = String(item.title ?? '');
  const subtitle = typeof item.subtitle === 'string' ? item.subtitle : undefined;
  const shortDescription = typeof item.shortDescription === 'string' ? item.shortDescription : undefined;
  const aspects = mapLocalizedAspects(item);
  const identity = extractListingIdentity({ title, subtitle, shortDescription, aspects });

  return {
    id: String(item.itemId ?? crypto.randomUUID()),
    title,
    subtitle,
    shortDescription,
    itemWebUrl: String(item.itemWebUrl ?? ''),
    itemOriginDate: typeof item.itemOriginDate === 'string' ? item.itemOriginDate : undefined,
    priceEur: priceValue,
    shippingEur: shippingValue,
    totalEur: priceValue + shippingValue,
    currency: String((item.price as Record<string, unknown> | undefined)?.currency ?? 'EUR'),
    country: typeof item.itemLocationCountry === 'string' ? item.itemLocationCountry : undefined,
    buyingOptions,
    condition: typeof item.condition === 'string' ? item.condition : undefined,
    sellerFeedbackPercent: typeof feedback === 'number' ? feedback : undefined,
    sellerFeedbackScore: typeof seller.feedbackScore === 'number' ? seller.feedbackScore : undefined,
    bidCount: typeof item.bidCount === 'number' ? item.bidCount : undefined,
    itemEndDate: typeof item.itemEndDate === 'string' ? item.itemEndDate : undefined,
    imageUrl: typeof (item.image as Record<string, unknown> | undefined)?.imageUrl === 'string'
      ? String((item.image as Record<string, unknown>).imageUrl)
      : undefined,
    aspects,
    ...identity,
    raw: item,
  };
}

function buildFilter(): string {
  return 'buyingOptions:{FIXED_PRICE|AUCTION}';
}

export async function searchBucketListingsPage(
  bucket: SearchBucket,
  profiles: GpuProfile[],
  offset = 0,
): Promise<EbaySearchPage> {
  if (env.EBAY_PROVIDER === 'mock') {
    return searchMockBucketListingsPage(bucket, profiles, offset, env.EBAY_SEARCH_PAGE_SIZE);
  }

  const token = await getEbayAccessToken();

  const response = await axios.get<EbaySearchResponse>(`${getEbayApiBaseUrl()}/buy/browse/v1/item_summary/search`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': env.EBAY_MARKETPLACE_ID,
    },
    params: {
      q: bucket.query,
      limit: env.EBAY_SEARCH_PAGE_SIZE,
      offset,
      filter: buildFilter(),
      sort: 'newlyListed',
    },
  });

  return {
    listings: (response.data.itemSummaries ?? []).map(mapListing),
    hasNext: Boolean(response.data.next),
    limit: response.data.limit ?? env.EBAY_SEARCH_PAGE_SIZE,
    offset: response.data.offset ?? offset,
  };
}
