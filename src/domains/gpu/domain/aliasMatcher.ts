import type { EbayListing } from './models.js';
import { buildListingSearchText, compactComparableText, normalizeListingText } from './listingSignals.js';

export function aliasCandidates(alias: string): string[] {
  const normalized = normalizeListingText(alias);
  if (!normalized) return [];

  const candidates = new Set<string>([
    normalized,
    normalized.replace(/\bgeforce\b/g, '').trim(),
    normalized.replace(/\bradeon\b/g, '').trim(),
    normalized.replace(/\bnvidia\b/g, '').trim(),
    normalized.replace(/\bamd\b/g, '').trim(),
  ]);

  if (/\bti\b/.test(normalized)) {
    candidates.add(normalized.replace(/\bti\b/g, 'ti').replace(/\s+/g, ' ').trim());
  }

  return Array.from(candidates).filter(Boolean);
}

export function listingMatchesAlias(textNormalized: string, textCompact: string, alias: string): boolean {
  return aliasCandidates(alias).some(candidate => {
    const candidateCompact = candidate.replace(/\s+/g, '');
    return textNormalized.includes(candidate) || textCompact.includes(candidateCompact);
  });
}

export function listingMatchesNegativeAlias(listing: EbayListing, negativeAlias: string): boolean {
  const searchText = buildListingSearchText(listing);
  return listingMatchesAlias(
    normalizeListingText(searchText),
    compactComparableText(searchText),
    negativeAlias,
  );
}
