import axios, { AxiosError } from 'axios';
import { logger } from '../../../../utils/logger.js';
export class LiquipediaRateLimitError extends Error {
    retryAfterSeconds;
    constructor(message, options) {
        super(message);
        this.name = 'LiquipediaRateLimitError';
        this.retryAfterSeconds = options?.retryAfterSeconds;
    }
}
export class LiquipediaMediaWikiClient {
    options;
    http;
    nextRequestAt = 0;
    constructor(options) {
        this.options = options;
        this.http = axios.create({
            baseURL: options.apiBaseUrl,
            headers: {
                'User-Agent': options.userAgent,
            },
            timeout: 30000,
        });
    }
    async waitForRateWindow() {
        const waitMs = this.nextRequestAt - Date.now();
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
    async request(params) {
        await this.waitForRateWindow();
        let nextRequestDelayMs = this.options.minRequestIntervalMs;
        try {
            const response = await this.http.get('', { params });
            return response.data;
        }
        catch (error) {
            if (error instanceof AxiosError && error.response?.status === 429) {
                const retryAfterHeader = error.response.headers['retry-after'];
                const retryAfterSeconds = typeof retryAfterHeader === 'string'
                    ? Number.parseInt(retryAfterHeader, 10)
                    : Array.isArray(retryAfterHeader)
                        ? Number.parseInt(retryAfterHeader[0] ?? '', 10)
                        : undefined;
                const boundedRetryAfterSeconds = retryAfterSeconds && Number.isFinite(retryAfterSeconds)
                    ? retryAfterSeconds
                    : undefined;
                const retryAfterMinutes = retryAfterSeconds && Number.isFinite(retryAfterSeconds)
                    ? Math.max(1, Math.ceil(retryAfterSeconds / 60))
                    : undefined;
                if (boundedRetryAfterSeconds) {
                    nextRequestDelayMs = Math.max(nextRequestDelayMs, boundedRetryAfterSeconds * 1000);
                }
                throw new LiquipediaRateLimitError(retryAfterMinutes
                    ? `Liquipedia blockiert den Sync gerade mit HTTP 429. Bitte warte ungefähr ${retryAfterMinutes} Minute(n) und versuche es dann erneut.`
                    : 'Liquipedia blockiert den Sync gerade mit HTTP 429. Liquipedia setzt bei API-Limit-Verstößen teils temporäre IP-Sperren; wenn der Fehler auch später bleibt, prüfe im Browser auf derselben IP auf ein CAPTCHA.', {
                    retryAfterSeconds: boundedRetryAfterSeconds,
                });
            }
            throw error;
        }
        finally {
            this.nextRequestAt = Date.now() + nextRequestDelayMs;
        }
    }
    async resolveExistingPageTitles(candidates) {
        if (candidates.length === 0) {
            return [];
        }
        const data = await this.request({
            action: 'query',
            format: 'json',
            formatversion: 2,
            titles: candidates.join('|'),
        });
        return (data.query?.pages ?? [])
            .filter(page => !page.missing)
            .map(page => page.title);
    }
    async searchPageTitles(query, limit = 5) {
        const data = await this.request({
            action: 'query',
            format: 'json',
            formatversion: 2,
            list: 'search',
            srsearch: query,
            srlimit: limit,
        });
        return (data.query?.search ?? []).map(result => result.title);
    }
    async fetchPageLinks(pageTitle) {
        const links = new Set();
        let continuationToken;
        do {
            const data = await this.request({
                action: 'query',
                format: 'json',
                formatversion: 2,
                prop: 'links',
                titles: pageTitle,
                pllimit: 'max',
                ...(continuationToken ? { plcontinue: continuationToken } : {}),
            });
            const page = data.query?.pages?.[0];
            if (!page || page.missing) {
                return [];
            }
            for (const link of page.links ?? []) {
                links.add(link.title);
            }
            continuationToken = data.continue?.plcontinue;
        } while (continuationToken);
        return [...links];
    }
    async fetchPageWikitext(pageTitle) {
        const data = await this.request({
            action: 'query',
            format: 'json',
            formatversion: 2,
            prop: 'revisions',
            titles: pageTitle,
            rvslots: 'main',
            rvprop: 'content',
        });
        const page = data.query?.pages?.[0];
        if (!page || page.missing) {
            throw new Error(`Liquipedia page not found: ${pageTitle}`);
        }
        const content = page.revisions?.[0]?.slots?.main?.content;
        if (!content) {
            logger.warn({ pageTitle }, 'Liquipedia page returned empty wikitext');
            return '';
        }
        return content;
    }
    getPageUrl(pageTitle) {
        return `https://liquipedia.net/valorant/${encodeURIComponent(pageTitle.replaceAll(' ', '_'))}`;
    }
}
