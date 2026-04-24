import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateListing } from './filterEngine.js';
function buildListing(overrides) {
    return {
        id: 'listing-1',
        title: 'GPU listing',
        itemWebUrl: 'https://example.invalid/listing',
        priceEur: 39,
        shippingEur: 4.99,
        totalEur: 43.99,
        currency: 'EUR',
        country: 'DE',
        buyingOptions: ['FIXED_PRICE'],
        condition: 'Used',
        sellerFeedbackPercent: 99.9,
        sellerFeedbackScore: 100,
        aspects: [],
        raw: {},
        ...overrides,
    };
}
const repairProfile = {
    name: 'GTX 1080 Ti Repair',
    aliases: ['GTX 1080 Ti', '1080 Ti'],
    negativeAliases: [],
    vramGb: 11,
    category: 'Repair / NVIDIA Pascal',
    targetHealth: 'DEFECT',
    vramVariants: false,
    excludeNew: true,
    onlyGermany: false,
    prices: {
        buyNowWorking: 0,
        buyNowDefect: 50,
        auctionWorking: 0,
        auctionDefect: 50,
    },
};
test('evaluateListing accepts targeted repair listings below total price cap', () => {
    const listing = buildListing({
        title: 'GTX 1080 Ti defekt kein Bild',
        totalEur: 49.5,
        priceEur: 44.5,
        shippingEur: 5,
    });
    const result = evaluateListing(repairProfile, listing);
    assert.equal(result.accepted, true);
    assert.equal(result.health, 'DEFECT');
});
test('evaluateListing rejects working listings for repair-only profiles', () => {
    const listing = buildListing({
        title: 'GTX 1080 Ti getestet funktionsfaehig',
    });
    const result = evaluateListing(repairProfile, listing);
    assert.equal(result.accepted, false);
    assert.match(result.reasons.join(' '), /health_mismatch=working/);
});
test('evaluateListing enforces total-price cap including shipping for repair listings', () => {
    const listing = buildListing({
        title: 'GTX 1080 Ti defekt Artefakte',
        priceEur: 45,
        shippingEur: 7,
        totalEur: 52,
    });
    const result = evaluateListing(repairProfile, listing);
    assert.equal(result.accepted, false);
    assert.match(result.reasons.join(' '), /price_above_limit_or_auction_not_soon/);
});
