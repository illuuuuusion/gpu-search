import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { buildListingReferenceText } from '../../core/listingSignals.js';
const CACHE_PATH = path.resolve(process.cwd(), 'data/geizhals-reference-cache.json');
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
function parseEuroAmount(value) {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}
function buildQuery(profile) {
    return profile.aliases[0] ?? profile.name;
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
    const query = buildQuery(profile);
    const searchUrl = `https://geizhals.de/?fs=${encodeURIComponent(query)}&hloc=at&hloc=de`;
    await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: env.GEIZHALS_REQUEST_TIMEOUT_MS,
    });
    await waitForUsablePage(page);
    const aliases = [profile.name, ...profile.aliases].map(alias => normalizeText(alias));
    const deduped = new Map();
    const currentUrl = page.url();
    const currentTitle = ((await page.locator('h1').first().textContent().catch(() => '')) ?? '').trim();
    if (/-[av]\d+\.html$/.test(new URL(currentUrl).pathname) && currentTitle) {
        deduped.set(currentUrl, { title: currentTitle, url: currentUrl });
    }
    const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map(anchor => ({
        href: anchor.href,
        text: (anchor.textContent ?? '').trim(),
    })));
    for (const link of links) {
        if (!link.href || !link.text)
            continue;
        if (!/https:\/\/geizhals\.(?:de|at|eu)\//.test(link.href))
            continue;
        const pathname = new URL(link.href).pathname;
        if (!/-(?:a|v)\d+\.html$/.test(pathname))
            continue;
        const normalizedTitle = normalizeText(link.text);
        if (!aliases.some(alias => normalizedTitle.includes(alias)))
            continue;
        if (!deduped.has(link.href)) {
            deduped.set(link.href, { title: link.text, url: link.href });
        }
    }
    return Array.from(deduped.values()).slice(0, env.GEIZHALS_MAX_FAMILY_LINKS_PER_PROFILE);
}
async function parseFamilyPage(page, familyLink) {
    await page.goto(familyLink.url, {
        waitUntil: 'domcontentloaded',
        timeout: env.GEIZHALS_REQUEST_TIMEOUT_MS,
    });
    await waitForUsablePage(page);
    const familyTitle = ((await page.locator('h1').first().textContent().catch(() => '')) ?? '').trim() || familyLink.title;
    const bodyText = (await page.locator('body').textContent().catch(() => '')) ?? '';
    const fallbackPriceEur = extractPrimaryPrice(bodyText);
    const variants = parseVariantSection(bodyText, familyTitle, fallbackPriceEur);
    const lowestPriceEur = variants.length > 0
        ? Math.min(...variants.map(variant => variant.lowestPriceEur))
        : fallbackPriceEur;
    const offerCountMatch = bodyText.match(/(?:ab|um) €\s*[0-9][0-9.\s]*,[0-9]{2}\s+(\d+) Angebote?/i)?.[1];
    if (!familyTitle || lowestPriceEur <= 0) {
        return null;
    }
    return {
        title: familyTitle,
        url: page.url(),
        lowestPriceEur,
        offerCount: offerCountMatch ? Number(offerCountMatch) : undefined,
        variants,
    };
}
async function fetchGeizhalsReference(page, profile) {
    const query = buildQuery(profile);
    const familyLinks = await collectFamilyLinks(page, profile);
    const families = [];
    for (const familyLink of familyLinks) {
        try {
            const family = await parseFamilyPage(page, familyLink);
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
    const lowestPriceEur = Math.min(...families.map(family => family.lowestPriceEur));
    return {
        source: 'geizhals',
        query,
        url: `https://geizhals.de/?fs=${encodeURIComponent(query)}&hloc=at&hloc=de`,
        lowestPriceEur,
        fetchedAt: new Date().toISOString(),
        families,
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
async function launchChromiumBrowser() {
    const launchEnv = await buildChromiumLaunchEnv();
    const candidates = await buildChromiumLaunchCandidates();
    const errors = [];
    for (const candidate of candidates) {
        try {
            return await chromium.launch({
                executablePath: candidate.executablePath,
                headless: env.GEIZHALS_BROWSER_HEADLESS,
                chromiumSandbox: false,
                args: CHROMIUM_LAUNCH_ARGS,
                env: launchEnv,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'unknown_error';
            errors.push(`${candidate.label}: ${message}`);
        }
    }
    throw new Error(errors.join('\n---\n'));
}
export class GeizhalsReferenceService {
    references = new Map();
    refreshPromise = null;
    refreshTimer = null;
    async start(profiles) {
        await this.loadCache();
        this.scheduleNextRefresh(profiles);
        if (profiles.some(profile => !this.references.has(profile.name))) {
            void this.refreshAll(profiles);
        }
    }
    matchReference(profile, listing) {
        const reference = this.references.get(profile.name);
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
        this.refreshPromise = (async () => {
            logger.info({ profiles: profiles.length }, 'Refreshing Geizhals market references');
            let browser;
            let page;
            try {
                browser = await launchChromiumBrowser();
                page = await browser.newPage({
                    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                });
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
                        this.references.set(profile.name, reference);
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : 'unknown_error';
                        logger.warn({ profile: profile.name, error: message }, 'Failed to refresh Geizhals reference');
                        if (message === 'geizhals_blocked_by_challenge') {
                            break;
                        }
                    }
                }
            }
            finally {
                await page?.close().catch(() => undefined);
                await browser?.close().catch(() => undefined);
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
            const raw = await fs.readFile(CACHE_PATH, 'utf8');
            const parsed = JSON.parse(raw);
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
    async persistCache() {
        const entries = Array.from(this.references.entries()).map(([profileName, reference]) => ({
            profileName,
            ...reference,
        }));
        await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
        await fs.writeFile(CACHE_PATH, JSON.stringify({
            version: 2,
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
