import type { EbayListing, GpuProfile } from '../types/domain.js';
import { buildListingSearchText, compactComparableText } from './listingSignals.js';

interface ProfileMatch {
  profile: GpuProfile;
  alias: string;
  score: number;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function listingMatchesAlias(titleNormalized: string, titleCompact: string, alias: string): boolean {
  const aliasNormalized = normalizeText(alias);
  if (!aliasNormalized) return false;

  const aliasCompact = aliasNormalized.replace(/\s+/g, '');
  return titleNormalized.includes(aliasNormalized) || titleCompact.includes(aliasCompact);
}

export function selectProfileForListing(profiles: GpuProfile[], listing: EbayListing): ProfileMatch | null {
  const titleNormalized = normalizeText(listing.title);
  const titleCompact = compactComparableText(listing.title);
  const searchText = buildListingSearchText(listing);
  const searchNormalized = normalizeText(searchText);
  const searchCompact = compactComparableText(searchText);
  const matches: ProfileMatch[] = [];

  for (const profile of profiles) {
    for (const alias of profile.aliases) {
      const titleMatched = listingMatchesAlias(titleNormalized, titleCompact, alias);
      const extendedMatched = titleMatched || listingMatchesAlias(searchNormalized, searchCompact, alias);
      if (!extendedMatched) continue;

      matches.push({
        profile,
        alias,
        score: normalizeText(alias).length + (titleMatched ? 1000 : 0),
      });
    }
  }

  if (matches.length === 0) return null;

  matches.sort((left, right) => right.score - left.score || right.profile.vramGb - left.profile.vramGb);
  return matches[0];
}
