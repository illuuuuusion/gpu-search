import axios from 'axios';
import { env, getEbayApiBaseUrl } from '../../config/env.js';
import { searchMockBucketListingsPage } from './mock.js';
import { getEbayAccessToken } from './oauth.js';
import { extractListingIdentity } from '../../core/listingSignals.js';
function toNumber(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function toAspectValues(value) {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap(item => toAspectValues(item)).slice(0, 6);
    }
    if (value && typeof value === 'object') {
        const record = value;
        return [
            ...toAspectValues(record.value),
            ...toAspectValues(record.localizedValue),
            ...toAspectValues(record.valueName),
        ].slice(0, 6);
    }
    return [];
}
function normalizeAspectName(value) {
    return typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim()
        : '';
}
function appendAspectEntries(entries, deduped) {
    for (const aspect of entries) {
        const name = normalizeAspectName(aspect.name ?? aspect.localizedName ?? aspect.label ?? aspect.localizedLabel ?? aspect.descriptorName);
        if (!name)
            continue;
        const values = [
            ...toAspectValues(aspect.value),
            ...toAspectValues(aspect.localizedValue),
            ...toAspectValues(aspect.localizedValues),
            ...toAspectValues(aspect.values),
            ...toAspectValues(aspect.valueName),
            ...toAspectValues(aspect.displayValue),
            ...toAspectValues(aspect.displayValues),
        ];
        for (const value of values) {
            const trimmedValue = value.replace(/\s+/g, ' ').trim();
            if (!trimmedValue)
                continue;
            const key = `${name.toLowerCase()}::${trimmedValue.toLowerCase()}`;
            if (!deduped.has(key)) {
                deduped.set(key, { name, value: trimmedValue });
            }
        }
    }
}
function mapListingAspects(item) {
    const deduped = new Map();
    if (Array.isArray(item.localizedAspects)) {
        appendAspectEntries(item.localizedAspects, deduped);
    }
    for (const [key, value] of Object.entries(item)) {
        if (key === 'localizedAspects' || !/(?:aspect|descriptor|property|specification|specific)/i.test(key) || !Array.isArray(value)) {
            continue;
        }
        const entries = value.filter((entry) => Boolean(entry) && typeof entry === 'object');
        if (entries.length > 0) {
            appendAspectEntries(entries, deduped);
        }
    }
    return Array.from(deduped.values());
}
const IDENTITY_HINT_KEY_PATTERN = /(?:brand|marke|manufacturer|hersteller|board|partner|gpu|chipset|graphics|graphic|model|modell|product|series|edition|version|mpn|herstellernummer|part|artikelnummer|description|beschreibung)/i;
function collectIdentityHintTexts(value, keyPath = '', depth = 0, values = []) {
    if (depth > 5 || values.length >= 48 || value == null) {
        return values;
    }
    if (typeof value === 'string') {
        if (IDENTITY_HINT_KEY_PATTERN.test(keyPath)) {
            const cleaned = value.replace(/\s+/g, ' ').trim();
            if (cleaned) {
                values.push(cleaned);
            }
        }
        return values;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectIdentityHintTexts(entry, keyPath, depth + 1, values);
            if (values.length >= 48)
                break;
        }
        return values;
    }
    if (typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            const nextKeyPath = keyPath ? `${keyPath}.${key}` : key;
            collectIdentityHintTexts(nested, nextKeyPath, depth + 1, values);
            if (values.length >= 48)
                break;
        }
    }
    return values;
}
function mapListing(item) {
    const shippingOptions = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
    const firstShipping = shippingOptions[0] ?? {};
    const priceValue = toNumber(item.price?.value);
    const shippingValue = toNumber(firstShipping.shippingCost?.value);
    const buyingOptions = (Array.isArray(item.buyingOptions) ? item.buyingOptions : []);
    const seller = item.seller ?? {};
    const feedback = seller.feedbackPercentage ?? undefined;
    const title = String(item.title ?? '');
    const subtitle = typeof item.subtitle === 'string' ? item.subtitle : undefined;
    const shortDescription = typeof item.shortDescription === 'string' ? item.shortDescription : undefined;
    const description = typeof item.description === 'string' ? item.description : undefined;
    const aspects = mapListingAspects(item);
    const identity = extractListingIdentity({
        title,
        subtitle,
        shortDescription,
        description,
        aspects,
        extraTexts: collectIdentityHintTexts(item),
    });
    return {
        id: String(item.itemId ?? crypto.randomUUID()),
        title,
        subtitle,
        shortDescription,
        description,
        itemWebUrl: String(item.itemWebUrl ?? ''),
        itemOriginDate: typeof item.itemOriginDate === 'string' ? item.itemOriginDate : undefined,
        priceEur: priceValue,
        shippingEur: shippingValue,
        totalEur: priceValue + shippingValue,
        currency: String(item.price?.currency ?? 'EUR'),
        country: typeof item.itemLocationCountry === 'string' ? item.itemLocationCountry : undefined,
        buyingOptions,
        condition: typeof item.condition === 'string' ? item.condition : undefined,
        sellerFeedbackPercent: typeof feedback === 'number' ? feedback : undefined,
        sellerFeedbackScore: typeof seller.feedbackScore === 'number' ? seller.feedbackScore : undefined,
        bidCount: typeof item.bidCount === 'number' ? item.bidCount : undefined,
        itemEndDate: typeof item.itemEndDate === 'string' ? item.itemEndDate : undefined,
        imageUrl: typeof item.image?.imageUrl === 'string'
            ? String(item.image.imageUrl)
            : undefined,
        aspects,
        ...identity,
        raw: item,
    };
}
function buildFilter() {
    return 'buyingOptions:{FIXED_PRICE|AUCTION}';
}
export async function searchBucketListingsPage(bucket, profiles, offset = 0) {
    if (env.EBAY_PROVIDER === 'mock') {
        return searchMockBucketListingsPage(bucket, profiles, offset, env.EBAY_SEARCH_PAGE_SIZE);
    }
    const token = await getEbayAccessToken();
    const response = await axios.get(`${getEbayApiBaseUrl()}/buy/browse/v1/item_summary/search`, {
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
