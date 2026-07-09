import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { listingMatchesAlias } from './aliasMatcher.js';
import { compactComparableText, normalizeListingText } from './listingSignals.js';

function matches(text: string, alias: string): boolean {
  return listingMatchesAlias(normalizeListingText(text), compactComparableText(text), alias);
}

// A token that survives normalization (letters/digits only, non-empty).
const token = fc.stringMatching(/^[a-z0-9]{1,8}$/);
const separator = fc.constantFrom(' ', '  ', '-', '.', '/', ' - ', '');

// Randomly upper/lower-case each character of a string.
function noisyCase(input: string, mask: boolean[]): string {
  return Array.from(input)
    .map((char, index) => (mask[index % Math.max(1, mask.length)] ? char.toUpperCase() : char))
    .join('');
}

test('listingMatchesAlias is tolerant to case, whitespace and punctuation noise', () => {
  fc.assert(
    fc.property(
      fc.array(token, { minLength: 1, maxLength: 3 }),
      fc.array(separator, { minLength: 1, maxLength: 4 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
      fc.string(),
      fc.string(),
      (tokens, separators, caseMask, prefix, suffix) => {
        const alias = tokens.join(' ');
        // Insert the alias tokens contiguously with arbitrary separators between them.
        const noisyAlias = tokens
          .map((tok, index) => (index === 0 ? tok : `${separators[index % separators.length]}${tok}`))
          .join('');
        const text = noisyCase(`${prefix} ${noisyAlias} ${suffix}`, caseMask);
        assert.ok(matches(text, alias), `expected "${text}" to match alias "${alias}"`);
      },
    ),
    { numRuns: 200 },
  );
});

test('listingMatchesAlias handles HTML entities and umlauts around the alias', () => {
  assert.ok(matches('RTX 3070 &amp; Zubehör, defekt', 'RTX 3070'));
  assert.ok(matches('Grafikkarte GTX 1080 (läuft einwandfrei)', 'GTX 1080'));
  assert.ok(matches('Asus&nbsp;RTX3070Ti 8GB', 'RTX 3070 Ti'));
  assert.ok(!matches('Playstation 5 mit Controller', 'RTX 3070'));
});
