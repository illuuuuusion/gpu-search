import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { selectProfileForListing } from './profileMatcher.js';
import type { EbayListing, GpuProfile } from '../domain/models.js';

function buildListing(overrides: Partial<EbayListing>): EbayListing {
  return {
    id: 'listing-1',
    title: 'Example GPU Listing',
    itemWebUrl: 'https://example.invalid/listing',
    priceEur: 40,
    shippingEur: 5,
    totalEur: 45,
    currency: 'EUR',
    buyingOptions: ['FIXED_PRICE'],
    aspects: [],
    raw: {},
    ...overrides,
  };
}

function buildProfile(overrides: Partial<GpuProfile> & Pick<GpuProfile, 'name' | 'aliases' | 'negativeAliases' | 'vramGb' | 'category' | 'vramVariants' | 'excludeNew' | 'onlyGermany' | 'prices'>): GpuProfile {
  return {
    ...overrides,
  };
}

test('selectProfileForListing rejects mismatched VRAM variants', () => {
  const profiles: GpuProfile[] = [
    buildProfile({
      name: 'RTX 3060 (8GB)',
      aliases: ['RTX 3060 8GB', '3060 8GB'],
      negativeAliases: ['3060 12GB'],
      vramGb: 8,
      category: 'Mainstream / NVIDIA Ampere',
      vramVariants: true,
      excludeNew: true,
      onlyGermany: false,
      prices: { buyNowWorking: 120, buyNowDefect: 40, auctionWorking: 100, auctionDefect: 30 },
    }),
    buildProfile({
      name: 'RTX 3060 (12GB)',
      aliases: ['RTX 3060 12GB', '3060 12GB'],
      negativeAliases: ['3060 8GB'],
      vramGb: 12,
      category: 'Mainstream / NVIDIA Ampere',
      vramVariants: true,
      excludeNew: true,
      onlyGermany: false,
      prices: { buyNowWorking: 140, buyNowDefect: 45, auctionWorking: 120, auctionDefect: 35 },
    }),
  ];

  const listing = buildListing({
    title: 'MSI RTX3060 12GB defekt kein Bild',
    aspects: [{ name: 'Memory Size', value: '12 GB' }],
  });

  const match = selectProfileForListing(profiles, listing);
  assert.equal(match?.profile.name, 'RTX 3060 (12GB)');
});

test('selectProfileForListing handles compact legacy spellings', () => {
  const profiles: GpuProfile[] = [
    buildProfile({
      name: 'GTX 980 Ti Repair',
      aliases: ['GTX 980 Ti', 'GeForce GTX 980 Ti', '980 Ti'],
      negativeAliases: [],
      vramGb: 6,
      category: 'Repair / NVIDIA Maxwell',
      targetHealth: 'DEFECT',
      vramVariants: false,
      excludeNew: true,
      onlyGermany: false,
      prices: { buyNowWorking: 0, buyNowDefect: 50, auctionWorking: 0, auctionDefect: 50 },
    }),
  ];

  const listing = buildListing({
    title: 'Asus GTX980Ti 6GB fuer Bastler',
    gpuModel: 'GTX 980 TI',
  });

  const match = selectProfileForListing(profiles, listing);
  assert.equal(match?.profile.name, 'GTX 980 Ti Repair');
});

test('selectProfileForListing skips negative aliases found outside the title', () => {
  const profiles: GpuProfile[] = [
    buildProfile({
      name: 'GTX 980 Repair',
      aliases: ['GTX 980'],
      negativeAliases: ['980 Ti'],
      vramGb: 4,
      category: 'Repair / NVIDIA Maxwell',
      targetHealth: 'DEFECT',
      vramVariants: false,
      excludeNew: true,
      onlyGermany: false,
      prices: { buyNowWorking: 0, buyNowDefect: 50, auctionWorking: 0, auctionDefect: 50 },
    }),
  ];

  const listing = buildListing({
    title: 'GTX 980 fuer Bastler',
    description: 'Tatsaechlich ist es eine 980 Ti mit Fehlerbild.',
  });

  const match = selectProfileForListing(profiles, listing);
  assert.equal(match, null);
});

test('property: an alias present in the title with no negative alias always matches', () => {
  const aliasToken = fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/);
  fc.assert(
    fc.property(aliasToken, fc.string(), fc.string(), (alias, prefix, suffix) => {
      const profile = buildProfile({
        name: `Profile ${alias}`,
        aliases: [alias],
        negativeAliases: [],
        vramGb: 8,
        category: 'test',
        vramVariants: false,
        excludeNew: false,
        onlyGermany: false,
        prices: { buyNowWorking: 100, buyNowDefect: 40, auctionWorking: 90, auctionDefect: 30 },
      });
      const listing = buildListing({ title: `${prefix} ${alias} ${suffix}` });
      const match = selectProfileForListing([profile], listing);
      assert.equal(match?.profile.name, profile.name);
    }),
    { numRuns: 200 },
  );
});
