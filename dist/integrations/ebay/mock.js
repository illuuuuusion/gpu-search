import { profileBelongsToBucket } from '../../config/searchBuckets.js';
import { extractListingIdentity } from '../../core/listingSignals.js';
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function buildListing(profile, suffix, sequence, overrides) {
    const idBase = slugify(profile.name);
    const priceEur = overrides.priceEur ?? 0;
    const shippingEur = overrides.shippingEur ?? 0;
    const itemOriginDate = overrides.itemOriginDate ?? new Date(Date.now() - sequence * 60_000).toISOString();
    const title = overrides.title ?? profile.aliases[0];
    const subtitle = overrides.subtitle;
    const shortDescription = overrides.shortDescription;
    const aspects = overrides.aspects ?? [];
    const identity = extractListingIdentity({ title, subtitle, shortDescription, aspects });
    return {
        id: `mock-${idBase}-${suffix}`,
        title,
        subtitle,
        shortDescription,
        itemWebUrl: overrides.itemWebUrl ?? `https://example.invalid/listing/mock-${idBase}-${suffix}`,
        itemOriginDate,
        priceEur,
        shippingEur,
        totalEur: overrides.totalEur ?? priceEur + shippingEur,
        currency: overrides.currency ?? 'EUR',
        country: overrides.country ?? 'DE',
        buyingOptions: overrides.buyingOptions ?? ['FIXED_PRICE'],
        condition: overrides.condition ?? 'Used',
        sellerFeedbackPercent: overrides.sellerFeedbackPercent ?? 99.8,
        sellerFeedbackScore: overrides.sellerFeedbackScore ?? 420,
        bidCount: overrides.bidCount,
        itemEndDate: overrides.itemEndDate,
        imageUrl: overrides.imageUrl,
        aspects,
        ...identity,
        raw: overrides.raw ?? { source: 'mock' },
    };
}
function buildMockListingsForProfile(profile, baseSequence) {
    const primaryAlias = profile.aliases[0];
    const workingPrice = Math.max(10, profile.prices.buyNowWorking - 15);
    const defectAuctionPrice = Math.max(5, profile.prices.auctionDefect - 8);
    const overpricedPrice = profile.prices.buyNowWorking + 80;
    const auctionEndDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    return [
        buildListing(profile, 'working-deal', baseSequence, {
            title: `${primaryAlias} gebraucht getestet`,
            subtitle: 'Boardpartner siehe Merkmale',
            shortDescription: 'Funktionsfähige Grafikkarte mit voller Leistung.',
            aspects: [
                { name: 'Marke', value: 'Gigabyte' },
                { name: 'Modell', value: 'Gaming OC' },
                { name: 'GPU', value: primaryAlias },
            ],
            priceEur: workingPrice,
            shippingEur: 6.99,
            buyingOptions: ['FIXED_PRICE'],
        }),
        buildListing(profile, 'repairable-auction', baseSequence + 1, {
            title: `${primaryAlias} fuer Bastler`,
            shortDescription: 'In den Merkmalen als defekt markiert.',
            aspects: [
                { name: 'Marke', value: 'ASUS' },
                { name: 'Modell', value: 'Dual OC' },
                { name: 'GPU', value: primaryAlias },
                { name: 'Zustand', value: 'Defekt' },
            ],
            priceEur: defectAuctionPrice,
            shippingEur: 4.99,
            buyingOptions: ['AUCTION'],
            bidCount: 3,
            itemEndDate: auctionEndDate,
        }),
        buildListing(profile, 'overpriced', baseSequence + 2, {
            title: `${primaryAlias} sofort einsatzbereit`,
            priceEur: overpricedPrice,
            shippingEur: 9.99,
            buyingOptions: ['FIXED_PRICE'],
        }),
        buildListing(profile, 'excluded', baseSequence + 3, {
            title: `${primaryAlias} only cooler`,
            aspects: [
                { name: 'Marke', value: 'MSI' },
                { name: 'Modell', value: 'Ventus' },
                { name: 'GPU', value: primaryAlias },
            ],
            priceEur: Math.max(1, profile.prices.buyNowDefect - 20),
            shippingEur: 3.99,
            buyingOptions: ['FIXED_PRICE'],
        }),
    ];
}
export async function searchMockBucketListingsPage(bucket, profiles, offset, limit) {
    const listings = profiles
        .filter(profile => profileBelongsToBucket(bucket, profile))
        .flatMap((profile, index) => buildMockListingsForProfile(profile, index * 10))
        .sort((left, right) => (right.itemOriginDate ?? '').localeCompare(left.itemOriginDate ?? ''));
    const pageListings = listings.slice(offset, offset + limit);
    return {
        listings: pageListings,
        hasNext: offset + limit < listings.length,
        limit,
        offset,
    };
}
