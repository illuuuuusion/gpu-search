import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { evaluateListing } from './filterEngine.js';
import { selectProfileForListing } from './profileMatcher.js';
import { regressionListingTitles } from './__fixtures__/regressionListings.js';
import type { EbayListing, GpuProfile } from '../domain/models.js';

function buildListing(overrides: Partial<EbayListing>): EbayListing {
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

const repairProfile: GpuProfile = {
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

const workingProfile: GpuProfile = {
  name: 'RTX 3090',
  aliases: ['RTX 3090'],
  negativeAliases: ['3090 Ti'],
  vramGb: 24,
  category: 'High-End / NVIDIA Ampere',
  targetHealth: 'WORKING',
  vramVariants: false,
  excludeNew: true,
  onlyGermany: false,
  prices: {
    buyNowWorking: 430,
    buyNowDefect: 135,
    auctionWorking: 385,
    auctionDefect: 105,
  },
};

test('evaluateListing accepts targeted repair listings below total price cap', () => {
  const listing = buildListing({
    title: 'GTX 1080 Ti defekt kein Bild startet noch',
    totalEur: 49.5,
    priceEur: 44.5,
    shippingEur: 5,
  });

  const result = evaluateListing(repairProfile, listing);
  assert.equal(result.accepted, true);
  assert.equal(result.health, 'DEFECT');
  assert.ok(result.repairability);
  assert.ok((result.repairability?.score ?? 0) >= 70);
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

test('evaluateListing gives low repairability scores to severe physical damage', () => {
  const listing = buildListing({
    title: 'GTX 1080 Ti defekt',
    description: 'PCB gebrochen, ohne Chip, verbrannt, nur fuer Teile.',
  });

  const result = evaluateListing(repairProfile, listing);
  assert.ok(result.repairability);
  assert.ok((result.repairability?.score ?? 100) <= 10);
  assert.match((result.repairability?.reasons ?? []).join(' '), /missing_core_parts/);
});

test('evaluateListing rejects hybrid cooler kits as GPU accessories', () => {
  const listing = buildListing({
    title: 'EVGA HYBRID Kit for RTX 3090 / 3080 Ti / 3080 FTW3 - Used - Working',
    priceEur: 120,
    shippingEur: 10,
    totalEur: 130,
  });

  const result = evaluateListing(workingProfile, listing);
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join(' '), /accessory_cooling/);
});

test('evaluateListing rejects GPU carrying cases as accessories', () => {
  const listing = buildListing({
    title: 'Tragetasche Grafikkarte EVA Material fuer RTX 5090 4090 3090 Wasserdicht',
    priceEur: 59.39,
    shippingEur: 0.92,
    totalEur: 60.31,
  });

  const result = evaluateListing(workingProfile, listing);
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join(' '), /accessory_misc/);
});

test('evaluateListing rejects listing when negative alias appears in title', () => {
  const listing = buildListing({
    title: 'RTX 3090 Ti Gaming OC gebraucht',
    priceEur: 500,
    shippingEur: 6.99,
    totalEur: 506.99,
  });

  const result = evaluateListing(workingProfile, listing);
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join(' '), /negative_alias=3090 Ti/);
});

test('evaluateListing rejects listing when negative alias appears only in subtitle', () => {
  const listing = buildListing({
    title: 'RTX 3090 Gaming OC gebraucht',
    subtitle: 'Tatsaechlich eine 3090 Ti',
    priceEur: 430,
    shippingEur: 6.99,
    totalEur: 436.99,
  });

  const result = evaluateListing(workingProfile, listing);
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join(' '), /negative_alias=3090 Ti/);
});

test('evaluateListing rejects listing when negative alias appears only in description', () => {
  const listing = buildListing({
    title: 'RTX 3090 Gaming OC gebraucht',
    description: 'Achtung: es handelt sich um eine 3090 Ti mit Fehlerbild.',
    priceEur: 430,
    shippingEur: 6.99,
    totalEur: 436.99,
  });

  const result = evaluateListing(workingProfile, listing);
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join(' '), /negative_alias=3090 Ti/);
});

test('evaluateListing does not reject listing whose title contains a word that is a substring of the negative alias', () => {
  const listing = buildListing({
    title: 'RTX 3090 gebraucht getestet',
    priceEur: 350,
    shippingEur: 5,
    totalEur: 355,
  });

  // workingProfile has negativeAliases: ['3090 Ti'] — "3090" alone must not trigger
  const result = evaluateListing(workingProfile, listing);
  assert.equal(result.accepted, true);
});

const VALID_HEALTH = new Set(['WORKING', 'DEFECT', 'EXCLUDED', 'UNKNOWN']);

test('property: evaluateListing never throws on arbitrary (even malformed) listings', () => {
  fc.assert(
    fc.property(
      fc.record({
        title: fc.string(),
        description: fc.option(fc.string(), { nil: undefined }),
        subtitle: fc.option(fc.string(), { nil: undefined }),
        condition: fc.option(fc.string(), { nil: undefined }),
        country: fc.option(fc.string(), { nil: undefined }),
        priceEur: fc.double({ noNaN: true, min: -1000, max: 100000 }),
        shippingEur: fc.double({ noNaN: true, min: -1000, max: 100000 }),
        totalEur: fc.double({ noNaN: true, min: -1000, max: 100000 }),
        sellerFeedbackPercent: fc.option(fc.double({ noNaN: true, min: 0, max: 100 }), { nil: undefined }),
        buyingOptions: fc.subarray(['FIXED_PRICE', 'AUCTION'] as const, { minLength: 1 }),
      }),
      partial => {
        const listing = buildListing(partial as Partial<EbayListing>);
        const result = evaluateListing(workingProfile, listing);
        assert.equal(typeof result.accepted, 'boolean');
        assert.ok(VALID_HEALTH.has(result.health));
        assert.ok(Number.isFinite(result.score));
      },
    ),
    { numRuns: 200 },
  );
});

test('regression corpus: no crashes, health always defined for real-world-shaped titles', () => {
  for (const title of regressionListingTitles) {
    const listing = buildListing({ title, description: title });
    const evaluated = evaluateListing(workingProfile, listing);
    assert.ok(VALID_HEALTH.has(evaluated.health), `health undefined for: ${title}`);
    // selectProfileForListing must also stay crash-free on these titles.
    assert.doesNotThrow(() => selectProfileForListing([workingProfile, repairProfile], listing));
  }
});

test('evaluateListing applies the B5 acceptance-bias multiplier to the effective limit', () => {
  const overLimit = buildListing({
    title: 'GTX 1080 Ti defekt kein Bild startet noch',
    priceEur: 47,
    shippingEur: 5,
    totalEur: 52, // base defect limit is 50 -> normally rejected
  });

  assert.equal(evaluateListing(repairProfile, overLimit).accepted, false);
  assert.equal(
    evaluateListing(repairProfile, overLimit, { effectiveLimitMultiplier: 1.1 }).accepted,
    true,
  );
  assert.equal(
    evaluateListing(repairProfile, overLimit, { effectiveLimitMultiplier: 0.9 }).accepted,
    false,
  );
});
