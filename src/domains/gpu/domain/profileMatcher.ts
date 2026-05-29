import type { EbayListing, GpuProfile } from '../domain/models.js';
import { buildListingSearchText, compactComparableText, detectListingVramGb, normalizeListingText } from './listingSignals.js';
import { listingMatchesAlias, listingMatchesNegativeAlias } from './aliasMatcher.js';

interface ProfileMatch {
  profile: GpuProfile;
  alias: string;
  score: number;
}

export function selectProfileForListing(profiles: GpuProfile[], listing: EbayListing): ProfileMatch | null {
  const titleNormalized = normalizeListingText(listing.title);
  const titleCompact = compactComparableText(listing.title);
  const searchText = buildListingSearchText(listing);
  const searchNormalized = normalizeListingText(searchText);
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
        score: normalizeListingText(alias).length
          + (titleMatched ? 1000 : 0)
          + (profile.vramVariants && listingVramGb === profile.vramGb ? 500 : 0),
      });
    }
  }

  if (matches.length === 0) return null;

  matches.sort((left, right) => right.score - left.score || right.profile.vramGb - left.profile.vramGb);
  return matches[0];
}
