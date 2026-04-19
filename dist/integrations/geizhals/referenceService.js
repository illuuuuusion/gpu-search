import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { buildListingReferenceText, compactComparableText } from '../../core/listingSignals.js';
const DEFAULT_CACHE_PATH = path.resolve(process.cwd(), 'data/geizhals-reference-cache.json');
const LOCAL_CHROMIUM_LIB_PATH = path.resolve(process.cwd(), 'vendor/chromium-libs/usr/lib/x86_64-linux-gnu');
const PLAYWRIGHT_CACHE_PATH = path.resolve(process.env.HOME ?? process.cwd(), '.cache/ms-playwright');
const CLOUDFLARE_MARKERS = [
    'Sichere Verbindung wird überprüft',
    'Enable JavaScript and cookies to continue',
    'challenge-platform',
];
const CHROMIUM_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-crashpad',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-zygote',
    '--noerrdialogs',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--single-process',
    '--disable-seccomp-filter-sandbox',
];
const GENERIC_MATCH_TOKENS = new Set([
    'graphics',
    'graphic',
    'card',
    'grafikkarte',
    'geforce',
    'radeon',
    'nvidia',
    'amd',
    'intel',
    'gb',
    'gddr5',
    'gddr6',
    'gddr6x',
    'gddr7',
    'hdmi',
    'dp',
    'displayport',
    'pcie',
    'pci',
    'retail',
    'aktiv',
    'neu',
    'used',
    'gebraucht',
    'desktop',
    'edition',
]);
const REFERENCE_ACCESSORY_PATTERNS = [
    /\b(?:waterblock|wasserblock|kuehler|kühler|cooler|cooling|kuehlung|kühlung|heatsink|backplate|full\s*cover|radiator|pump|reservoir|aio)\b/i,
    /\b(?:eiswolf|eisblock|quantum\s+vector|hydro\s+x|liquid\s+freezer|nautilus|gpu\s+cooler|vga\s+cooler)\b/i,
    /\b(?:adapter|bracket|halterung|mount|cable|kabel|riser|kit|fan|lüfter|blower)\b/i,
];
const REFERENCE_SYSTEM_PATTERNS = [
    /\b(?:notebook|laptop|thinkpad|ideapad|macbook|vivobook|zenbook|surface|mobile\s+workstation|mini\s*pc|gaming\s*pc|desktop\s*pc|komplettsystem|barebone)\b/i,
    /\b(?:max[\s-]?q|max[\s-]?p)\b/i,
];
const REFERENCE_ARTIFACT_PATTERNS = [
    /<style>/i,
    /{"@context"/i,
    /\bratings\.init\b/i,
    /\bwindow\._gh_/i,
    /\bschema\.org\b/i,
];
const PROFILE_QUERY_OVERRIDES = {
    'Titan RTX': [
        'NVIDIA TITAN RTX Grafikkarte',
        'NVIDIA TITAN RTX',
    ],
    'Arc A770 16GB': [
        'Intel Arc A770 16GB Grafikkarte',
        'Intel Arc A770 Limited Edition 16GB',
    ],
    'RTX 2080': [
        'GeForce RTX 2080 Grafikkarte',
        'RTX 2080 8GB Grafikkarte',
    ],
    'RTX 2080 Super': [
        'GeForce RTX 2080 SUPER Grafikkarte',
        'RTX 2080 SUPER 8GB Grafikkarte',
    ],
    'RTX 4060 Ti (16GB)': [
        'GeForce RTX 4060 Ti 16GB Grafikkarte',
        'RTX 4060 Ti 16GB Grafikkarte',
    ],
    'RX 7900 GRE': [
        'Radeon RX 7900 GRE Grafikkarte',
        'RX 7900 GRE 16GB Grafikkarte',
    ],
};
const REFERENCE_OVERRIDES = {
    'Titan RTX': {
        title: 'NVIDIA TITAN RTX',
        query: 'NVIDIA TITAN RTX',
        url: 'https://geizhals.de/?fs=NVIDIA%20TITAN%20RTX&hloc=at&hloc=de',
        priceEur: 2499,
        note: 'Manueller Fallback, weil Geizhals aktuell keine saubere Live-Referenz mit Preis liefert.',
    },
    'Arc A770 16GB': {
        title: 'Intel Arc A770 Limited Edition, 16GB GDDR6, HDMI, 3x DP',
        query: 'Intel Arc A770 Limited Edition 16GB',
        url: 'https://geizhals.de/?fs=Intel%20Arc%20A770%20Limited%20Edition%2016GB&hloc=at&hloc=de',
        priceEur: 297.19,
        note: 'Manueller Fallback aus sauberem Geizhals-Suchergebnis; die Produktabfrage läuft hier oft in eine Challenge.',
    },
    'RTX 2080': {
        title: 'GeForce RTX 2080 Referenz-Fallback',
        query: 'GeForce RTX 2080 Grafikkarte',
        url: 'https://geizhals.de/?fs=GeForce%20RTX%202080%20Grafikkarte&hloc=at&hloc=de',
        priceEur: 699,
        note: 'Manueller Fallback, weil Geizhals aktuell keine saubere neue RTX 2080 mit belastbarem Live-Preis führt.',
    },
    'RTX 2080 Super': {
        title: 'GeForce RTX 2080 SUPER Referenz-Fallback',
        query: 'GeForce RTX 2080 SUPER Grafikkarte',
        url: 'https://geizhals.de/?fs=GeForce%20RTX%202080%20SUPER%20Grafikkarte&hloc=at&hloc=de',
        priceEur: 699,
        note: 'Manueller Fallback, weil Geizhals aktuell keine saubere neue RTX 2080 SUPER mit belastbarem Live-Preis führt.',
    },
    'RTX 4060 Ti (16GB)': {
        title: 'GeForce RTX 4060 Ti 16GB Referenz-Fallback',
        query: 'GeForce RTX 4060 Ti 16GB Grafikkarte',
        url: 'https://geizhals.de/?fs=GeForce%20RTX%204060%20Ti%2016GB%20Grafikkarte&hloc=at&hloc=de',
        priceEur: 449,
        note: 'Manueller Fallback, weil Geizhals bei diesem Modell derzeit keine stabile Live-Angebotsreferenz liefert.',
    },
    'RX 7900 GRE': {
        title: 'Radeon RX 7900 GRE Referenz-Fallback',
        query: 'Radeon RX 7900 GRE Grafikkarte',
        url: 'https://geizhals.de/?fs=Radeon%20RX%207900%20GRE%20Grafikkarte&hloc=at&hloc=de',
        priceEur: 579,
        note: 'Manueller Fallback aus aktuellem Marktband, weil Geizhals derzeit keine stabile direkte Preisreferenz parsed.',
    },
};
function parseEuroAmount(value) {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}
function getCachePath() {
    return env.MARKET_REFERENCE_CACHE_PATH ?? DEFAULT_CACHE_PATH;
}
function buildQueryCandidates(profile) {
    const aliases = [profile.aliases[0] ?? profile.name, profile.name, ...profile.aliases];
    const gpuModel = [profile.name, ...profile.aliases]
        .map(alias => extractGpuModelToken(alias))
        .find((value) => Boolean(value));
    const vendorPrefix = gpuModel?.startsWith('rtx') || gpuModel?.startsWith('gtx')
        ? 'GeForce'
        : gpuModel?.startsWith('rx')
            ? 'Radeon'
            : gpuModel?.startsWith('arc')
                ? 'Intel'
                : gpuModel?.startsWith('titan')
                    ? 'NVIDIA'
                    : undefined;
    const vendorCandidates = vendorPrefix
        ? aliases.flatMap(alias => [`${vendorPrefix} ${alias}`, `${vendorPrefix} ${alias} Grafikkarte`])
        : [];
    return dedupeComparableTexts([
        ...(PROFILE_QUERY_OVERRIDES[profile.name] ?? []),
        ...aliases,
        ...aliases.map(alias => `${alias} Grafikkarte`),
        ...vendorCandidates,
    ]);
}
function buildOverrideReference(profileName) {
    const override = REFERENCE_OVERRIDES[profileName];
    if (!override) {
        return undefined;
    }
    return {
        source: 'override',
        query: override.query,
        url: override.url,
        lowestPriceEur: override.priceEur,
        fetchedAt: new Date().toISOString(),
        note: override.note,
        families: [
            {
                title: override.title,
                url: override.url,
                lowestPriceEur: override.priceEur,
                variants: [
                    {
                        title: override.title,
                        lowestPriceEur: override.priceEur,
                    },
                ],
            },
        ],
    };
}
function normalizeText(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
function tokenizeMatchText(value) {
    return normalizeText(value)
        .split(' ')
        .filter(Boolean)
        .filter(token => !GENERIC_MATCH_TOKENS.has(token))
        .filter(token => !/^\d+(?:gb|g)?$/.test(token));
}
function dedupeComparableTexts(values) {
    return Array.from(new Map(values
        .filter(Boolean)
        .map(value => [compactComparableText(value), value]))
        .values());
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function extractGpuModelToken(value) {
    const normalized = normalizeText(value);
    const patterns = [
        /\brtx pro \d{4,5}(?: blackwell)?\b/i,
        /\btitan rtx\b/i,
        /\b(?:rtx|gtx|rx|arc)\s+\d{3,5}(?:\s+(?:ti|super|xt|xtx|gre))?\b/i,
    ];
    for (const pattern of patterns) {
        const match = normalized.match(pattern)?.[0];
        if (match) {
            return compactComparableText(match);
        }
    }
    return undefined;
}
function buildProfileGpuModelTokens(profile) {
    return dedupeComparableTexts([profile.name, ...profile.aliases]
        .map(alias => extractGpuModelToken(alias))
        .filter((value) => Boolean(value)));
}
function matchesProfileAlias(profile, title) {
    const normalizedTitle = normalizeText(title);
    return [profile.name, ...profile.aliases].some(alias => {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias)
            return false;
        return new RegExp(`(^|\\s)${escapeRegex(normalizedAlias).replace(/\s+/g, '\\s+')}($|\\s)`, 'i')
            .test(normalizedTitle);
    });
}
function matchesNegativeAlias(profile, title) {
    const normalizedTitle = normalizeText(title);
    return profile.negativeAliases.some(alias => {
        const normalizedAlias = normalizeText(alias);
        return normalizedAlias ? normalizedTitle.includes(normalizedAlias) : false;
    });
}
function looksLikeWholeSystem(title) {
    const normalized = normalizeText(title);
    const hasCpuMarker = /\b(?:core i[3579]|core ultra|ryzen \d|xeon|threadripper)\b/i.test(normalized);
    const hasSystemSpec = /\b(?:ram|ssd|hdd|ddr4|ddr5|tb|w11|w10|win11|win10|windows)\b/i.test(normalized);
    return hasCpuMarker && hasSystemSpec;
}
function referenceRejectionReason(profile, title) {
    const trimmed = title.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed.length < 6) {
        return 'empty';
    }
    if (trimmed.length > 220) {
        return 'too_long';
    }
    if (REFERENCE_ARTIFACT_PATTERNS.some(pattern => pattern.test(trimmed))) {
        return 'artifact';
    }
    if (REFERENCE_ACCESSORY_PATTERNS.some(pattern => pattern.test(trimmed))) {
        return 'accessory';
    }
    if (REFERENCE_SYSTEM_PATTERNS.some(pattern => pattern.test(trimmed)) || looksLikeWholeSystem(trimmed)) {
        return 'system';
    }
    if (matchesNegativeAlias(profile, trimmed)) {
        return 'negative_alias';
    }
    const profileGpuModelTokens = buildProfileGpuModelTokens(profile);
    const titleGpuModel = extractGpuModelToken(trimmed);
    if (titleGpuModel) {
        if (profileGpuModelTokens.length > 0 && !profileGpuModelTokens.includes(titleGpuModel)) {
            return 'gpu_model_mismatch';
        }
    }
    else if (!matchesProfileAlias(profile, trimmed)) {
        return 'alias_missing';
    }
    return undefined;
}
function dedupeVariants(variants) {
    const deduped = new Map();
    for (const variant of variants) {
        const title = variant.title.replace(/\s+/g, ' ').trim();
        if (!title || variant.lowestPriceEur <= 0)
            continue;
        const key = compactComparableText(title);
        const previous = deduped.get(key);
        if (!previous || variant.lowestPriceEur < previous.lowestPriceEur) {
            deduped.set(key, {
                title,
                lowestPriceEur: variant.lowestPriceEur,
                offerCount: variant.offerCount,
            });
        }
    }
    return Array.from(deduped.values()).sort((left, right) => left.lowestPriceEur - right.lowestPriceEur);
}
function filterReferenceVariants(profile, variants) {
    return dedupeVariants(variants)
        .filter(variant => !referenceRejectionReason(profile, variant.title));
}
function filterReferenceFamily(profile, family, allowFallbackWithoutVariants) {
    if (referenceRejectionReason(profile, family.title)) {
        return null;
    }
    const variants = filterReferenceVariants(profile, family.variants);
    const fallbackPriceEur = family.lowestPriceEur > 0 && allowFallbackWithoutVariants ? family.lowestPriceEur : 0;
    const lowestPriceEur = variants.length > 0
        ? Math.min(...variants.map(variant => variant.lowestPriceEur))
        : fallbackPriceEur;
    if (lowestPriceEur <= 0) {
        return null;
    }
    return {
        title: family.title.replace(/\s+/g, ' ').trim(),
        url: family.url,
        lowestPriceEur,
        offerCount: variants.length > 0 ? family.offerCount : undefined,
        variants,
    };
}
function scoreTitleSimilarity(left, right) {
    const leftTokens = tokenizeMatchText(left);
    const rightTokens = tokenizeMatchText(right);
    if (leftTokens.length === 0 || rightTokens.length === 0) {
        return 0;
    }
    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const intersection = leftTokens.filter(token => rightSet.has(token));
    const union = new Set([...leftSet, ...rightSet]);
    let score = intersection.length / Math.max(union.size, 1);
    if (intersection.length > 0 && leftTokens[0] === rightTokens[0]) {
        score += 0.15;
    }
    const leftNormalized = normalizeText(left);
    const rightNormalized = normalizeText(right);
    if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) {
        score += 0.15;
    }
    return Number(score.toFixed(4));
}
function absolutePercentDistance(referencePrice, candidatePrice) {
    if (referencePrice <= 0)
        return Number.POSITIVE_INFINITY;
    return Math.abs((referencePrice - candidatePrice) / referencePrice);
}
function extractPrimaryPrice(bodyText) {
    const match = bodyText.match(/(?:ab|um) €\s*([0-9][0-9.\s]*,[0-9]{2})/i)?.[1];
    return match ? parseEuroAmount(match) : 0;
}
function asJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function flattenJsonLdNodes(input) {
    if (Array.isArray(input)) {
        return input.flatMap(value => flattenJsonLdNodes(value));
    }
    const record = asJsonObject(input);
    if (!record) {
        return [];
    }
    const graph = Array.isArray(record['@graph'])
        ? record['@graph'].flatMap(value => flattenJsonLdNodes(value))
        : [];
    return [record, ...graph];
}
function readJsonString(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed || undefined;
}
function readOfferStats(offers) {
    if (Array.isArray(offers)) {
        for (const entry of offers) {
            const stats = readOfferStats(entry);
            if (stats.priceEur && stats.priceEur > 0) {
                return stats;
            }
        }
        return {};
    }
    const record = asJsonObject(offers);
    if (!record) {
        return {};
    }
    const lowPrice = typeof record.lowPrice === 'number'
        ? record.lowPrice
        : typeof record.lowPrice === 'string'
            ? Number(record.lowPrice)
            : undefined;
    const directPrice = typeof record.price === 'number'
        ? record.price
        : typeof record.price === 'string'
            ? Number(record.price)
            : undefined;
    const offerCount = typeof record.offerCount === 'number'
        ? record.offerCount
        : typeof record.offerCount === 'string'
            ? Number(record.offerCount)
            : undefined;
    const nested = readOfferStats(record.offers);
    const priceEur = [lowPrice, directPrice, nested.priceEur]
        .find((value) => value !== undefined && Number.isFinite(value) && value > 0);
    return {
        priceEur,
        offerCount: offerCount !== undefined && Number.isFinite(offerCount) && offerCount > 0
            ? offerCount
            : nested.offerCount,
    };
}
async function readPageInnerText(page) {
    return (await page.locator('body').evaluate(node => node.innerText ?? '').catch(() => '')) ?? '';
}
async function readSearchResultLinks(page) {
    return page.locator('a[href]').evaluateAll((anchors) => {
        const parsePrice = (text) => {
            const match = text.match(/€\s*([0-9][0-9.\s]*,[0-9]{2})/i)?.[1];
            if (!match)
                return undefined;
            const normalized = match.replace(/\./g, '').replace(',', '.').trim();
            const parsed = Number(normalized);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        };
        return anchors.map(anchor => {
            const href = anchor.href;
            const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
            let seedPriceEur;
            let current = anchor.parentElement;
            for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
                const blockText = (current.innerText ?? '').replace(/\s+/g, ' ').trim();
                if (!blockText)
                    continue;
                if (blockText.length > 600)
                    break;
                if (/keine angebote/i.test(blockText))
                    continue;
                if (text && !blockText.includes(text))
                    continue;
                seedPriceEur = parsePrice(blockText);
                if (seedPriceEur)
                    break;
            }
            return { href, text, seedPriceEur };
        });
    }).catch(() => []);
}
async function parseJsonLdVariants(page) {
    const scriptContents = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => scripts
        .map(script => script.textContent ?? '')
        .filter(Boolean)).catch(() => []);
    const variants = [];
    for (const scriptContent of scriptContents) {
        try {
            const parsed = JSON.parse(scriptContent);
            for (const node of flattenJsonLdNodes(parsed)) {
                const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
                const normalizedTypes = types
                    .map(type => typeof type === 'string' ? type.toLowerCase() : '')
                    .filter(Boolean);
                if (normalizedTypes.includes('productgroup') && Array.isArray(node.hasVariant)) {
                    for (const variantNode of node.hasVariant) {
                        const variant = asJsonObject(variantNode);
                        if (!variant)
                            continue;
                        const title = readJsonString(variant.name);
                        const { priceEur, offerCount } = readOfferStats(variant.offers);
                        if (title && priceEur && priceEur > 0) {
                            variants.push({ title, lowestPriceEur: priceEur, offerCount });
                        }
                    }
                }
                if (normalizedTypes.includes('product')) {
                    const title = readJsonString(node.name);
                    const { priceEur, offerCount } = readOfferStats(node.offers);
                    if (title && priceEur && priceEur > 0) {
                        variants.push({ title, lowestPriceEur: priceEur, offerCount });
                    }
                }
            }
        }
        catch {
            // Ignore malformed JSON-LD blocks.
        }
    }
    return dedupeVariants(variants);
}
function isFresh(reference) {
    const ageMs = Date.now() - new Date(reference.fetchedAt).getTime();
    return ageMs <= env.MARKET_REFERENCE_CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;
}
function parseVariantSection(bodyText, familyTitle, fallbackPriceEur) {
    const lines = bodyText
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const startIndex = lines.findIndex(line => /Alle \d+ Varianten anzeigen/i.test(line));
    if (startIndex === -1) {
        return fallbackPriceEur > 0 ? [{ title: familyTitle, lowestPriceEur: fallbackPriceEur }] : [];
    }
    const variants = [];
    let index = startIndex + 1;
    while (index < lines.length) {
        const currentLine = lines[index];
        if (/^(Mehr Varianten anzeigen|Modell|Aktueller Preisbereich|Letztes Preisupdate)\b/i.test(currentLine)) {
            break;
        }
        if (/^(ab|um) €/i.test(currentLine) ||
            /^Derzeit keine Angebote$/i.test(currentLine) ||
            /^\d+ Angebote?$/i.test(currentLine) ||
            /^Wähle eine Variante:?$/i.test(currentLine)) {
            index += 1;
            continue;
        }
        const titleParts = [currentLine];
        index += 1;
        while (index < lines.length) {
            const nextLine = lines[index];
            if (/^(ab|um) €/i.test(nextLine) ||
                /^Derzeit keine Angebote$/i.test(nextLine) ||
                /^(Mehr Varianten anzeigen|Modell|Aktueller Preisbereich|Letztes Preisupdate)\b/i.test(nextLine)) {
                break;
            }
            if (!/^\d+ Angebote?$/i.test(nextLine) && !/^Wähle eine Variante:?$/i.test(nextLine)) {
                titleParts.push(nextLine);
            }
            index += 1;
        }
        if (index >= lines.length) {
            break;
        }
        if (/^Derzeit keine Angebote$/i.test(lines[index])) {
            index += 1;
            continue;
        }
        const priceMatch = lines[index].match(/^(?:ab|um) €\s*([0-9][0-9.\s]*,[0-9]{2})/i)?.[1];
        const lowestPriceEur = priceMatch ? parseEuroAmount(priceMatch) : 0;
        index += 1;
        let offerCount;
        const offerMatch = lines[index]?.match(/^(\d+) Angebote?$/i)?.[1];
        if (offerMatch) {
            offerCount = Number(offerMatch);
            index += 1;
        }
        if (lowestPriceEur > 0) {
            variants.push({
                title: titleParts.join(' '),
                lowestPriceEur,
                offerCount,
            });
        }
    }
    if (variants.length === 0 && fallbackPriceEur > 0) {
        return [{ title: familyTitle, lowestPriceEur: fallbackPriceEur }];
    }
    return variants;
}
async function waitForUsablePage(page) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.waitForLoadState('domcontentloaded', { timeout: env.GEIZHALS_REQUEST_TIMEOUT_MS });
        await page.waitForTimeout(1500);
        const bodyText = (await page.locator('body').textContent().catch(() => '')) ?? '';
        if (bodyText && !CLOUDFLARE_MARKERS.some(marker => bodyText.includes(marker))) {
            return;
        }
    }
    throw new Error('geizhals_blocked_by_challenge');
}
async function collectFamilyLinks(page, profile) {
    const queryCandidates = buildQueryCandidates(profile);
    const profileGpuModels = new Set(buildProfileGpuModelTokens(profile));
    for (const query of queryCandidates) {
        const searchUrl = `https://geizhals.de/?fs=${encodeURIComponent(query)}&hloc=at&hloc=de`;
        await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: env.GEIZHALS_REQUEST_TIMEOUT_MS,
        });
        await waitForUsablePage(page);
        const deduped = new Map();
        const currentUrl = page.url();
        const currentTitle = ((await page.locator('h1').first().textContent().catch(() => '')) ?? '').trim();
        if (/-[av]\d+\.html$/.test(new URL(currentUrl).pathname) &&
            currentTitle &&
            !referenceRejectionReason(profile, currentTitle)) {
            deduped.set(currentUrl, { title: currentTitle, url: currentUrl });
        }
        const links = await readSearchResultLinks(page);
        for (const link of links) {
            if (!link.href || !link.text)
                continue;
            if (!/https:\/\/geizhals\.(?:de|at|eu)\//.test(link.href))
                continue;
            const pathname = new URL(link.href).pathname;
            if (!/-(?:a|v)\d+\.html$/.test(pathname))
                continue;
            const titleGpuModel = extractGpuModelToken(link.text);
            const matchesProfile = titleGpuModel
                ? profileGpuModels.has(titleGpuModel)
                : matchesProfileAlias(profile, link.text);
            if (!matchesProfile)
                continue;
            if (referenceRejectionReason(profile, link.text))
                continue;
            if (!deduped.has(link.href)) {
                deduped.set(link.href, { title: link.text, url: link.href, seedPriceEur: link.seedPriceEur });
            }
        }
        const collectedLinks = Array.from(deduped.values()).slice(0, env.GEIZHALS_MAX_FAMILY_LINKS_PER_PROFILE);
        if (collectedLinks.length > 0) {
            return { query, links: collectedLinks };
        }
    }
    return {
        query: queryCandidates[0] ?? profile.name,
        links: [],
    };
}
async function parseFamilyPage(page, profile, familyLink) {
    await page.goto(familyLink.url, {
        waitUntil: 'domcontentloaded',
        timeout: env.GEIZHALS_REQUEST_TIMEOUT_MS,
    });
    await waitForUsablePage(page);
    const familyTitle = ((await page.locator('h1').first().textContent().catch(() => '')) ?? '').trim() || familyLink.title;
    const pageText = await readPageInnerText(page);
    const jsonLdVariants = await parseJsonLdVariants(page);
    const fallbackPriceEur = familyLink.seedPriceEur ?? extractPrimaryPrice(pageText);
    const textVariants = jsonLdVariants.length > 0
        ? []
        : parseVariantSection(pageText, familyTitle, fallbackPriceEur);
    const offerCountMatch = pageText.match(/(?:ab|um) €\s*[0-9][0-9.\s]*,[0-9]{2}\s+(\d+) Angebote?/i)?.[1];
    const filteredFamily = filterReferenceFamily(profile, {
        title: familyTitle,
        url: page.url(),
        lowestPriceEur: fallbackPriceEur,
        offerCount: offerCountMatch ? Number(offerCountMatch) : undefined,
        variants: jsonLdVariants.length > 0 ? jsonLdVariants : textVariants,
    }, !/-v\d+\.html$/.test(new URL(page.url()).pathname));
    return filteredFamily;
}
async function fetchGeizhalsReference(page, profile) {
    const { query, links: familyLinks } = await collectFamilyLinks(page, profile);
    const families = [];
    for (const familyLink of familyLinks) {
        try {
            const family = await parseFamilyPage(page, profile, familyLink);
            if (family) {
                families.push(family);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'unknown_error';
            logger.warn({ profile: profile.name, familyUrl: familyLink.url, error: message }, 'Failed to parse Geizhals family page');
        }
    }
    if (families.length === 0) {
        throw new Error('geizhals_price_not_found');
    }
    const dedupedFamilies = Array.from(new Map(families.map(family => [family.url, family])).values())
        .sort((left, right) => left.lowestPriceEur - right.lowestPriceEur);
    const lowestPriceEur = Math.min(...dedupedFamilies.map(family => family.lowestPriceEur));
    return {
        source: 'geizhals',
        query,
        url: `https://geizhals.de/?fs=${encodeURIComponent(query)}&hloc=at&hloc=de`,
        lowestPriceEur,
        fetchedAt: new Date().toISOString(),
        families: dedupedFamilies,
    };
}
async function buildChromiumLaunchEnv() {
    const envWithLibraries = { ...process.env };
    try {
        await fs.access(LOCAL_CHROMIUM_LIB_PATH);
        const libraryParts = [LOCAL_CHROMIUM_LIB_PATH, process.env.LD_LIBRARY_PATH]
            .filter((value) => Boolean(value))
            .join(':');
        envWithLibraries.LD_LIBRARY_PATH = libraryParts;
    }
    catch {
        // No local user-space Chromium libs available yet.
    }
    return envWithLibraries;
}
async function findBundledChromiumExecutable() {
    try {
        const entries = await fs.readdir(PLAYWRIGHT_CACHE_PATH, { withFileTypes: true });
        const chromiumDirs = entries
            .filter(entry => entry.isDirectory() && entry.name.startsWith('chromium-'))
            .map(entry => entry.name)
            .sort()
            .reverse();
        for (const directory of chromiumDirs) {
            const candidate = path.join(PLAYWRIGHT_CACHE_PATH, directory, 'chrome-linux64', 'chrome');
            try {
                await fs.access(candidate);
                return candidate;
            }
            catch {
                // continue
            }
        }
    }
    catch {
        // Playwright cache may not exist yet.
    }
    return undefined;
}
async function buildChromiumLaunchCandidates() {
    const candidates = [];
    const bundledExecutable = await findBundledChromiumExecutable();
    if (bundledExecutable) {
        candidates.push({
            label: 'bundled_chrome',
            executablePath: bundledExecutable,
        });
    }
    candidates.push({ label: 'playwright_default' });
    return candidates;
}
function requestedBrowserEngines() {
    return env.GEIZHALS_BROWSER_ENGINE === 'auto'
        ? ['chromium', 'firefox', 'webkit']
        : [env.GEIZHALS_BROWSER_ENGINE];
}
async function buildBrowserLaunchPlans() {
    const plans = [];
    for (const engine of requestedBrowserEngines()) {
        if (engine === 'chromium') {
            const candidates = await buildChromiumLaunchCandidates();
            plans.push(...candidates.map(candidate => ({
                label: candidate.label,
                engine,
                executablePath: candidate.executablePath,
            })));
            continue;
        }
        plans.push({
            label: `${engine}_default`,
            engine,
        });
    }
    return plans;
}
async function launchBrowser() {
    const launchEnv = await buildChromiumLaunchEnv();
    const plans = await buildBrowserLaunchPlans();
    const errors = [];
    for (const plan of plans) {
        try {
            if (plan.engine === 'chromium') {
                return await chromium.launch({
                    executablePath: plan.executablePath,
                    headless: env.GEIZHALS_BROWSER_HEADLESS,
                    chromiumSandbox: false,
                    args: CHROMIUM_LAUNCH_ARGS,
                    env: launchEnv,
                });
            }
            if (plan.engine === 'firefox') {
                return await firefox.launch({
                    headless: env.GEIZHALS_BROWSER_HEADLESS,
                    env: launchEnv,
                });
            }
            return await webkit.launch({
                headless: env.GEIZHALS_BROWSER_HEADLESS,
                env: launchEnv,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'unknown_error';
            errors.push(`${plan.label}: ${message}`);
        }
    }
    throw new Error(errors.join('\n---\n'));
}
async function openReferencePage() {
    const browser = await launchBrowser();
    const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    });
    return { browser, page };
}
export class GeizhalsReferenceService {
    references = new Map();
    refreshPromise = null;
    refreshTimer = null;
    cacheLoaded = false;
    async start(profiles) {
        await this.ensureCacheLoaded();
        for (const profile of profiles) {
            if (!this.references.has(profile.name)) {
                const override = buildOverrideReference(profile.name);
                if (override) {
                    this.references.set(profile.name, override);
                }
            }
        }
        this.scheduleNextRefresh(profiles);
        if (profiles.some(profile => !this.references.has(profile.name))) {
            void this.refreshAll(profiles);
        }
    }
    matchReference(profile, listing) {
        const reference = this.references.get(profile.name) ?? buildOverrideReference(profile.name);
        if (!reference || !isFresh(reference) || reference.families.length === 0) {
            return undefined;
        }
        const listingReferenceText = buildListingReferenceText(listing);
        let bestTitleMatch;
        for (const family of reference.families) {
            const variants = family.variants.length > 0
                ? family.variants
                : [{ title: family.title, lowestPriceEur: family.lowestPriceEur, offerCount: family.offerCount }];
            for (const variant of variants) {
                const similarityScore = scoreTitleSimilarity(listingReferenceText, variant.title);
                if (!bestTitleMatch || similarityScore > bestTitleMatch.similarityScore) {
                    bestTitleMatch = { family, variant, similarityScore };
                }
            }
        }
        if (bestTitleMatch && bestTitleMatch.similarityScore >= env.GEIZHALS_VARIANT_MATCH_THRESHOLD) {
            return {
                reference,
                family: bestTitleMatch.family,
                variant: bestTitleMatch.variant,
                priceEur: bestTitleMatch.variant.lowestPriceEur,
                strategy: 'title_variant',
                similarityScore: bestTitleMatch.similarityScore,
                matchedTitle: bestTitleMatch.variant.title,
                url: bestTitleMatch.family.url,
            };
        }
        const priceNearest = reference.families
            .flatMap(family => {
            const variants = family.variants.length > 0
                ? family.variants
                : [{ title: family.title, lowestPriceEur: family.lowestPriceEur, offerCount: family.offerCount }];
            return variants.map(variant => ({ family, variant }));
        })
            .sort((left, right) => absolutePercentDistance(left.variant.lowestPriceEur, listing.totalEur) -
            absolutePercentDistance(right.variant.lowestPriceEur, listing.totalEur))[0];
        if (priceNearest) {
            return {
                reference,
                family: priceNearest.family,
                variant: priceNearest.variant,
                priceEur: priceNearest.variant.lowestPriceEur,
                strategy: 'price_proximity',
                similarityScore: bestTitleMatch?.similarityScore ?? 0,
                matchedTitle: priceNearest.variant.title,
                url: priceNearest.family.url,
            };
        }
        const cheapestFamily = reference.families.reduce((best, family) => family.lowestPriceEur < best.lowestPriceEur ? family : best);
        return {
            reference,
            family: cheapestFamily,
            priceEur: cheapestFamily.lowestPriceEur,
            strategy: 'family_lowest',
            similarityScore: bestTitleMatch?.similarityScore ?? 0,
            matchedTitle: cheapestFamily.title,
            url: cheapestFamily.url,
        };
    }
    async refreshAll(profiles) {
        if (this.refreshPromise) {
            await this.refreshPromise;
            return;
        }
        await this.ensureCacheLoaded();
        this.refreshPromise = (async () => {
            logger.info({ profiles: profiles.length }, 'Refreshing Geizhals market references');
            const nextReferences = new Map(this.references);
            let browser;
            let page;
            try {
                ({ browser, page } = await openReferencePage());
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'unknown_error';
                logger.warn({ error: message }, 'Unable to start Chromium for Geizhals reference refresh');
                return;
            }
            try {
                for (const profile of profiles) {
                    try {
                        const reference = await fetchGeizhalsReference(page, profile);
                        nextReferences.set(profile.name, reference);
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : 'unknown_error';
                        logger.warn({ profile: profile.name, error: message }, 'Failed to refresh Geizhals reference');
                        if (message === 'geizhals_price_not_found') {
                            const override = buildOverrideReference(profile.name);
                            if (override) {
                                nextReferences.set(profile.name, override);
                            }
                            else {
                                nextReferences.delete(profile.name);
                            }
                        }
                        if (message === 'geizhals_blocked_by_challenge') {
                            const override = buildOverrideReference(profile.name);
                            if (override) {
                                nextReferences.set(profile.name, override);
                            }
                            await page?.close().catch(() => undefined);
                            await browser?.close().catch(() => undefined);
                            page = undefined;
                            browser = undefined;
                            try {
                                ({ browser, page } = await openReferencePage());
                            }
                            catch (restartError) {
                                const restartMessage = restartError instanceof Error ? restartError.message : 'unknown_error';
                                logger.warn({ profile: profile.name, error: restartMessage }, 'Unable to restart browser after Geizhals challenge');
                                break;
                            }
                        }
                    }
                    finally {
                        if (page && env.GEIZHALS_PROFILE_DELAY_MS > 0) {
                            await page.waitForTimeout(env.GEIZHALS_PROFILE_DELAY_MS);
                        }
                    }
                }
            }
            finally {
                await page?.close().catch(() => undefined);
                await browser?.close().catch(() => undefined);
            }
            this.references.clear();
            for (const [profileName, reference] of nextReferences.entries()) {
                this.references.set(profileName, reference);
            }
            await this.persistCache();
        })();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = null;
        }
    }
    async loadCache() {
        try {
            const raw = await fs.readFile(getCachePath(), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.version !== 3) {
                return;
            }
            for (const entry of parsed.entries ?? []) {
                if (entry?.profileName && entry?.query && entry?.lowestPriceEur && Array.isArray(entry.families)) {
                    this.references.set(entry.profileName, {
                        source: entry.source,
                        query: entry.query,
                        url: entry.url,
                        lowestPriceEur: entry.lowestPriceEur,
                        fetchedAt: entry.fetchedAt,
                        families: entry.families,
                    });
                }
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT') {
                logger.warn({ error }, 'Failed to load Geizhals reference cache');
            }
        }
    }
    async ensureCacheLoaded() {
        if (this.cacheLoaded) {
            return;
        }
        await this.loadCache();
        this.cacheLoaded = true;
    }
    async persistCache() {
        const entries = Array.from(this.references.entries()).map(([profileName, reference]) => ({
            profileName,
            ...reference,
        }));
        const cachePath = getCachePath();
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify({
            version: 3,
            updatedAt: new Date().toISOString(),
            entries,
        }, null, 2));
    }
    scheduleNextRefresh(profiles) {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        const nextRun = new Date();
        nextRun.setHours(env.MARKET_REFERENCE_REFRESH_HOUR, 0, 0, 0);
        if (nextRun.getTime() <= Date.now()) {
            nextRun.setDate(nextRun.getDate() + 1);
        }
        this.refreshTimer = setTimeout(() => {
            void this.refreshAll(profiles).finally(() => this.scheduleNextRefresh(profiles));
        }, nextRun.getTime() - Date.now());
    }
    stop() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}
