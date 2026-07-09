import test from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, similarityRatio, wouldBlockLegitimateAlias } from './aliasSimilarity.js';
import type { GpuProfile } from './models.js';

function profile(name: string, aliases: string[]): GpuProfile {
  return {
    name,
    aliases,
    negativeAliases: [],
    vramGb: 8,
    category: 'test',
    vramVariants: false,
    excludeNew: false,
    onlyGermany: false,
    prices: { buyNowWorking: 1, buyNowDefect: 1, auctionWorking: 1, auctionDefect: 1 },
  };
}

test('levenshtein classic sanity', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(similarityRatio('abc', 'abc'), 1);
});

test('C2 example: 3070Ti collides with alias, "ohne Kühler" does not', () => {
  const profiles = [profile('RTX 3070 Ti', ['RTX 3070 Ti']), profile('RTX 3080', ['RTX 3080'])];
  assert.ok(wouldBlockLegitimateAlias('3070Ti', profiles, 2));
  assert.equal(wouldBlockLegitimateAlias('ohne Kühler', profiles, 2), null);
});
