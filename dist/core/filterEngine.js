import { defectTerms, exclusionTerms } from '../config/exclusionTerms.js';
import { env } from '../config/env.js';
import { buildListingSearchText, getListingTextSources } from './listingSignals.js';
const allowedCountries = new Set(env.ALLOW_COUNTRIES.split(',').map(v => v.trim().toUpperCase()));
const accessoryPatterns = [
    { reason: 'accessory_fan', regex: /\b(?:vga|gpu|graphics(?:\s+card)?|grafikkarte)\s+fan\b/i },
    { reason: 'accessory_fan', regex: /\b(?:cooling|replacement)\s+fan\b/i },
    { reason: 'accessory_fan', regex: /\b(?:kühlventilator(?:en)?|ventilator(?:en)?|lüfter)\b/i },
    { reason: 'accessory_cooling', regex: /\b(?:radiator|heatsink|kühlung)\b/i },
    { reason: 'accessory_waterblock', regex: /\b(?:water\s?block|wasserblock|wasserkühler|gpu\s+block|ekwb|alphacool|barrow|bykski)\b/i },
    { reason: 'accessory_power', regex: /\b(?:netzteil|ladegerät|ladekabel|power\s+supply|power\s+cable|stromkabel)\b/i },
    { reason: 'accessory_cable', regex: /\b(?:12vhpwr|16pin|8pin|pcie|pci-e|riser(?:-kabel|\s+cable)?|extension\s+cable|verlängerungskabel|splitter|converter|connector|oculink|dock)\b/i },
    { reason: 'accessory_packaging', regex: /\b(?:ovp|leerkarton|verpackung|box)\b/i },
    { reason: 'accessory_av', regex: /\b(?:hdmi|displayport|dp\s*2\.1|glasfaser\s+kabel)\b/i },
    { reason: 'accessory_misc', regex: /\b(?:storage\s+bag|bag|steam\s+code|code\s+steam|laptop)\b/i },
    { reason: 'accessory_part_number', regex: /\b(?:t\d{6,}|pla\d{5,}|pld\d{5,}|ga\d{5,}|cf\d{4,})\w*\b/i },
];
function includesAny(haystack, needles) {
    const normalized = haystack.toLowerCase();
    return needles.filter(term => normalized.includes(term.toLowerCase()));
}
function extractStringValues(value, depth = 0, values = []) {
    if (depth > 3 || values.length >= 24 || value == null) {
        return values;
    }
    if (typeof value === 'string') {
        values.push(value);
        return values;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            extractStringValues(item, depth + 1, values);
            if (values.length >= 24)
                break;
        }
        return values;
    }
    if (typeof value === 'object') {
        for (const nested of Object.values(value)) {
            extractStringValues(nested, depth + 1, values);
            if (values.length >= 24)
                break;
        }
    }
    return values;
}
function accessoryReason(text) {
    for (const pattern of accessoryPatterns) {
        if (pattern.regex.test(text)) {
            return pattern.reason;
        }
    }
    return null;
}
function resolveHealth(listing) {
    const exclusionHits = includesAny(listing.title, exclusionTerms);
    if (exclusionHits.length > 0) {
        return { health: 'EXCLUDED', reasons: [`exclusion_terms=${exclusionHits.join(', ')}`] };
    }
    const seenTexts = new Set(getListingTextSources(listing).map(source => source.text));
    const healthSources = [
        ...getListingTextSources(listing),
        ...extractStringValues(listing.raw)
            .filter(text => !seenTexts.has(text))
            .map(text => ({ label: 'raw', text })),
    ];
    for (const source of healthSources) {
        if (!source.text)
            continue;
        const defectHits = includesAny(source.text, defectTerms);
        if (defectHits.length > 0) {
            return { health: 'DEFECT', reasons: [`${source.label}_defect_terms=${defectHits.join(', ')}`] };
        }
    }
    return { health: 'WORKING', reasons: [] };
}
function shippingAccepted(price, shipping) {
    const dynamicLimit = Math.min(env.MAX_SHIPPING_HARD_CAP_EUR, price * 0.2);
    return shipping <= dynamicLimit;
}
function isAuctionEndingSoon(itemEndDate) {
    if (!itemEndDate)
        return false;
    const diffMs = new Date(itemEndDate).getTime() - Date.now();
    return diffMs > 0 && diffMs <= 5 * 60 * 60 * 1000;
}
function baseLimitForOfferType(offerType, profile, health) {
    return offerType === 'FIXED_PRICE'
        ? (health === 'DEFECT' ? profile.prices.buyNowDefect : profile.prices.buyNowWorking)
        : (health === 'DEFECT' ? profile.prices.auctionDefect : profile.prices.auctionWorking);
}
function acceptedForOfferType(offerType, listing, limit) {
    if (offerType === 'AUCTION' && !isAuctionEndingSoon(listing.itemEndDate)) {
        return false;
    }
    return listing.totalEur <= limit;
}
function calculatePercentDelta(referencePrice, actualPrice) {
    if (referencePrice <= 0)
        return 0;
    return Number((((referencePrice - actualPrice) / referencePrice) * 100).toFixed(2));
}
function effectiveLimitForListing(listing, profile, health, offerType, referenceMatch) {
    const baseLimitEur = baseLimitForOfferType(offerType, profile, health);
    const minimumRetailDiscountPercent = profile.minimumRetailDiscountPercent ?? 0;
    let effectiveLimitEur = baseLimitEur;
    let retailDiscountPercent;
    if (health === 'WORKING' && minimumRetailDiscountPercent > 0 && referenceMatch?.priceEur) {
        retailDiscountPercent = calculatePercentDelta(referenceMatch.priceEur, listing.totalEur);
        const retailGateLimit = Number((referenceMatch.priceEur * (1 - minimumRetailDiscountPercent / 100)).toFixed(2));
        effectiveLimitEur = Math.min(baseLimitEur, retailGateLimit);
    }
    return {
        baseLimitEur,
        effectiveLimitEur,
        retailDiscountPercent,
        limitHeadroomPercent: calculatePercentDelta(effectiveLimitEur, listing.totalEur),
    };
}
function scoreListing(priceEvaluation) {
    return Number((priceEvaluation.retailDiscountPercent ?? priceEvaluation.limitHeadroomPercent).toFixed(2));
}
function rejectedResult(profile, listing, health, reasons) {
    return {
        profile,
        listing,
        health,
        accepted: false,
        reasons,
        score: 0,
        baseLimitEur: 0,
        effectiveLimitEur: 0,
        limitHeadroomPercent: 0,
    };
}
export function evaluateListing(profile, listing, referenceMatch) {
    const reasons = [];
    const title = listing.title.toLowerCase();
    for (const negative of profile.negativeAliases) {
        if (title.includes(negative.toLowerCase())) {
            reasons.push(`negative_alias=${negative}`);
            return rejectedResult(profile, listing, 'EXCLUDED', reasons);
        }
    }
    if (profile.onlyGermany && listing.country && listing.country.toUpperCase() !== 'DE') {
        reasons.push(`country_not_allowed=${listing.country}`);
        return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
    if (listing.country && !allowedCountries.has(listing.country.toUpperCase())) {
        reasons.push(`country_not_allowed=${listing.country}`);
        return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
    if (profile.excludeNew && /\b(?:new|neu|brandneu)\b/i.test(listing.condition ?? '')) {
        reasons.push('condition_new');
        return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
    if ((listing.sellerFeedbackPercent ?? 100) < env.MIN_SELLER_FEEDBACK_PERCENT && (listing.sellerFeedbackScore ?? 0) >= 10) {
        reasons.push(`seller_feedback_below_threshold=${listing.sellerFeedbackPercent}`);
        return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
    if (listing.priceEur <= 0 || listing.totalEur <= 0) {
        reasons.push(`invalid_price=${listing.totalEur}`);
        return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
    const healthResult = resolveHealth(listing);
    reasons.push(...healthResult.reasons);
    if (healthResult.health === 'EXCLUDED') {
        return rejectedResult(profile, listing, healthResult.health, reasons);
    }
    const accessoryHit = accessoryReason(buildListingSearchText(listing));
    if (accessoryHit) {
        reasons.push(accessoryHit);
        return rejectedResult(profile, listing, 'EXCLUDED', reasons);
    }
    if (!shippingAccepted(listing.priceEur, listing.shippingEur)) {
        reasons.push(`shipping_too_high=${listing.shippingEur}`);
        return rejectedResult(profile, listing, healthResult.health, reasons);
    }
    const offerType = listing.buyingOptions.includes('FIXED_PRICE') ? 'FIXED_PRICE' : 'AUCTION';
    const priceEvaluation = effectiveLimitForListing(listing, profile, healthResult.health, offerType, referenceMatch);
    const accepted = acceptedForOfferType(offerType, listing, priceEvaluation.effectiveLimitEur);
    if (!accepted)
        reasons.push('price_above_limit_or_auction_not_soon');
    return {
        profile,
        listing,
        health: healthResult.health,
        accepted,
        reasons,
        score: scoreListing(priceEvaluation),
        baseLimitEur: priceEvaluation.baseLimitEur,
        effectiveLimitEur: priceEvaluation.effectiveLimitEur,
        limitHeadroomPercent: priceEvaluation.limitHeadroomPercent,
        referenceMatch,
        retailDiscountPercent: priceEvaluation.retailDiscountPercent,
    };
}
