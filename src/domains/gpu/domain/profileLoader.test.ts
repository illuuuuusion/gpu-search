import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProfiles } from './profileLoader.js';
import type { PriceLimits } from './models.js';

const priceKeys = [
  'buyNowWorking',
  'buyNowDefect',
  'auctionWorking',
  'auctionDefect',
] as const satisfies readonly (keyof PriceLimits)[];

function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase().replace(/\s+/g, ' ');
}

test('loadProfiles validates GPU profile config invariants', () => {
  const profiles = loadProfiles();
  assert.ok(profiles.length > 0, 'expected at least one GPU profile');

  const profileNames = new Set<string>();
  const aliasOwners = new Map<string, string>();

  for (const profile of profiles) {
    assert.ok(profile.name.trim().length > 0, 'profile names must not be empty');
    assert.equal(profileNames.has(profile.name), false, `duplicate profile name: ${profile.name}`);
    profileNames.add(profile.name);

    assert.ok(profile.aliases.length > 0, `${profile.name} must define at least one alias`);
    const profileAliases = new Set<string>();
    for (const alias of profile.aliases) {
      assert.ok(alias.trim().length > 0, `${profile.name} contains an empty alias`);
      const normalizedAlias = normalizeAlias(alias);
      assert.equal(profileAliases.has(normalizedAlias), false, `${profile.name} contains duplicate alias: ${alias}`);
      profileAliases.add(normalizedAlias);

      const existingOwner = aliasOwners.get(normalizedAlias);
      assert.ok(
        !existingOwner || existingOwner === profile.name,
        `alias "${alias}" is shared by ${existingOwner} and ${profile.name}`,
      );
      aliasOwners.set(normalizedAlias, profile.name);
    }

    for (const negativeAlias of profile.negativeAliases) {
      assert.ok(negativeAlias.trim().length > 0, `${profile.name} contains an empty negative alias`);
    }

    assert.ok(Number.isInteger(profile.vramGb) && profile.vramGb > 0, `${profile.name} must define positive integer VRAM`);

    for (const key of priceKeys) {
      const value = profile.prices[key];
      assert.ok(Number.isFinite(value), `${profile.name}.${key} must be finite`);
      assert.ok(value >= 0, `${profile.name}.${key} must not be negative`);
    }

    if (profile.targetHealth === 'DEFECT') {
      assert.equal(profile.prices.buyNowWorking, 0, `${profile.name} should disable fixed-price working alerts`);
      assert.equal(profile.prices.auctionWorking, 0, `${profile.name} should disable auction working alerts`);
    } else {
      assert.ok(profile.prices.buyNowWorking > 0, `${profile.name} should define a working fixed-price limit`);
      assert.ok(profile.prices.auctionWorking > 0, `${profile.name} should define a working auction limit`);
    }
  }
});
