import { defectTerms, exclusionTerms } from '../config/exclusionTerms.js';
import { env } from '../config/env.js';
const allowedCountries = new Set(env.ALLOW_COUNTRIES.split(',').map(v => v.trim().toUpperCase()));
function includesAny(haystack, needles) {
    const normalized = haystack.toLowerCase();
    return needles.filter(term => normalized.includes(term.toLowerCase()));
}
function resolveHealth(title) {
    const exclusionHits = includesAny(title, exclusionTerms);
    if (exclusionHits.length > 0) {
        return { health: 'EXCLUDED', reasons: [`exclusion_terms=${exclusionHits.join(', ')}`] };
    }
    const defectHits = includesAny(title, defectTerms);
    if (defectHits.length > 0) {
        return { health: 'DEFECT', reasons: [`defect_terms=${defectHits.join(', ')}`] };
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
function acceptedForOfferType(offerType, listing, profile, health) {
    const limit = offerType === 'FIXED_PRICE'
        ? (health === 'DEFECT' ? profile.prices.buyNowDefect : profile.prices.buyNowWorking)
        : (health === 'DEFECT' ? profile.prices.auctionDefect : profile.prices.auctionWorking);
    if (offerType === 'AUCTION' && !isAuctionEndingSoon(listing.itemEndDate)) {
        return false;
    }
    return listing.totalEur <= limit;
}
function scoreListing(listing, profile) {
    const pricePerGb = listing.totalEur / profile.vramGb;
    return Number((1000 / Math.max(pricePerGb, 1)).toFixed(2));
}
export function evaluateListing(profile, listing) {
    const reasons = [];
    const title = listing.title.toLowerCase();
    for (const negative of profile.negativeAliases) {
        if (title.includes(negative.toLowerCase())) {
            reasons.push(`negative_alias=${negative}`);
            return { profile, listing, health: 'EXCLUDED', accepted: false, reasons, score: 0 };
        }
    }
    if (profile.onlyGermany && listing.country && listing.country.toUpperCase() !== 'DE') {
        reasons.push(`country_not_allowed=${listing.country}`);
        return { profile, listing, health: 'EXCLUDED', accepted: false, reasons, score: 0 };
    }
    if (listing.country && !allowedCountries.has(listing.country.toUpperCase())) {
        reasons.push(`country_not_allowed=${listing.country}`);
        return { profile, listing, health: 'EXCLUDED', accepted: false, reasons, score: 0 };
    }
    if (profile.excludeNew && (listing.condition ?? '').toLowerCase().includes('new')) {
        reasons.push('condition_new');
        return { profile, listing, health: 'EXCLUDED', accepted: false, reasons, score: 0 };
    }
    if ((listing.sellerFeedbackPercent ?? 100) < env.MIN_SELLER_FEEDBACK_PERCENT && (listing.sellerFeedbackScore ?? 0) >= 10) {
        reasons.push(`seller_feedback_below_threshold=${listing.sellerFeedbackPercent}`);
        return { profile, listing, health: 'EXCLUDED', accepted: false, reasons, score: 0 };
    }
    const healthResult = resolveHealth(listing.title);
    reasons.push(...healthResult.reasons);
    if (healthResult.health === 'EXCLUDED') {
        return { profile, listing, health: healthResult.health, accepted: false, reasons, score: 0 };
    }
    if (!shippingAccepted(listing.priceEur, listing.shippingEur)) {
        reasons.push(`shipping_too_high=${listing.shippingEur}`);
        return { profile, listing, health: healthResult.health, accepted: false, reasons, score: 0 };
    }
    const offerType = listing.buyingOptions.includes('FIXED_PRICE') ? 'FIXED_PRICE' : 'AUCTION';
    const accepted = acceptedForOfferType(offerType, listing, profile, healthResult.health);
    if (!accepted)
        reasons.push('price_above_limit_or_auction_not_soon');
    return {
        profile,
        listing,
        health: healthResult.health,
        accepted,
        reasons,
        score: scoreListing(listing, profile),
    };
}
