function normalizeText(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
function compactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
}
function listingMatchesAlias(titleNormalized, titleCompact, alias) {
    const aliasNormalized = normalizeText(alias);
    if (!aliasNormalized)
        return false;
    const aliasCompact = aliasNormalized.replace(/\s+/g, '');
    return titleNormalized.includes(aliasNormalized) || titleCompact.includes(aliasCompact);
}
export function selectProfileForListing(profiles, listing) {
    const titleNormalized = normalizeText(listing.title);
    const titleCompact = compactText(listing.title);
    const matches = [];
    for (const profile of profiles) {
        for (const alias of profile.aliases) {
            if (!listingMatchesAlias(titleNormalized, titleCompact, alias))
                continue;
            matches.push({
                profile,
                alias,
                score: normalizeText(alias).length,
            });
        }
    }
    if (matches.length === 0)
        return null;
    matches.sort((left, right) => right.score - left.score || right.profile.vramGb - left.profile.vramGb);
    return matches[0];
}
