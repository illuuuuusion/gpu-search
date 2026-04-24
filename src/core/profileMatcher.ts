import type { EbayListing, GpuProfile } from '../types/domain.js';
import { buildListingSearchText, compactComparableText, detectListingVramGb, normalizeListingText } from './listingSignals.js';

interface ProfileMatch {
  profile: GpuProfile;
  alias: string;
  score: number;
}

function normalizeText(value: string): string {
  return normalizeListingText(value);
}

function aliasCandidates(alias: string): string[] {
  const normalized = normalizeText(alias);
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

function listingMatchesAlias(titleNormalized: string, titleCompact: string, alias: string): boolean {
  return aliasCandidates(alias).some(aliasCandidate => {
    const aliasCompact = aliasCandidate.replace(/\s+/g, '');
    return titleNormalized.includes(aliasCandidate) || titleCompact.includes(aliasCompact);
  });
}

function listingMatchesNegativeAlias(listing: EbayListing, negativeAlias: string): boolean {
  const searchText = buildListingSearchText(listing);
  return listingMatchesAlias(
    normalizeText(searchText),
    compactComparableText(searchText),
    negativeAlias,
  );
}

export function selectProfileForListing(profiles: GpuProfile[], listing: EbayListing): ProfileMatch | null {
  const titleNormalized = normalizeText(listing.title);
  const titleCompact = compactComparableText(listing.title);
  const searchText = buildListingSearchText(listing);
  const searchNormalized = normalizeText(searchText);
  const searchCompact = compactComparableText(searchText);
  const listingVramGb = detectListingVramGb(listing);
  const matches: ProfileMatch[] = [];

  for (const profile of profiles) {
    if (profile.negativeAliases.some(negativeAlias => listingMatchesNegativeAlias(listing, negativeAlias))) {
      continue;
    }

    if (profile.vramVariants && listingVramGb !== undefined && listingVramGb !== profile.vramGb) {
      continue;
    }

    for (const alias of profile.aliases) {
      const titleMatched = listingMatchesAlias(titleNormalized, titleCompact, alias);
      const extendedMatched = titleMatched || listingMatchesAlias(searchNormalized, searchCompact, alias);
      if (!extendedMatched) continue;

      matches.push({
        profile,
        alias,
        score: normalizeText(alias).length
          + (titleMatched ? 1000 : 0)
          + (profile.vramVariants && listingVramGb === profile.vramGb ? 500 : 0),
      });
    }
  }

  if (matches.length === 0) return null;

  matches.sort((left, right) => right.score - left.score || right.profile.vramGb - left.profile.vramGb);
  return matches[0];
}
