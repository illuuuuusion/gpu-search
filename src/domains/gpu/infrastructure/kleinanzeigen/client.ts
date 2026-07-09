import axios from 'axios';
import { env } from '../../../../app/env/index.js';
import { logger } from '../../../../app/shared/logger.js';
import type { MarketplaceListing } from '../../domain/models.js';

// B4: Kleinanzeigen-Adapter (zweite Marktplatz-Quelle).
//
// ponytail / WICHTIG: Kleinanzeigen bietet KEINE offizielle API — das hier ist
// HTML-Scraping in einer ToS-Grauzone. Der Parser unten ist best effort und
// konnte in dieser Umgebung NICHT gegen die Live-Seite verifiziert werden.
// Selektoren brechen erfahrungsgemaess regelmaessig. Deshalb ist das Feature per
// KLEINANZEIGEN_ENABLED standardmaessig AUS. Vor Produktivnutzung:
//   1. Rechtliche/ToS-Freigabe klaeren (siehe TODO-Liste).
//   2. `parseSearchResults` gegen echtes HTML verifizieren/nachziehen.
// Ceiling: naives Regex-Parsing, ein Request pro Suche, kein Anti-Bot-Handling.

const client = axios.create({
  timeout: env.EBAY_HTTP_TIMEOUT_MS,
  headers: {
    'User-Agent': 'gpu-search/0.1 (+https://github.com/; contact configured operator)',
    'Accept-Language': 'de-DE,de;q=0.9',
  },
});

let nextRequestAt = 0;
const MIN_REQUEST_INTERVAL_MS = 2_000;

async function throttle(): Promise<void> {
  const wait = nextRequestAt - Date.now();
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
}

function parsePriceEur(raw: string): number {
  const match = raw.replace(/\./g, '').match(/(\d+)(?:,(\d{1,2}))?/);
  if (!match) return 0;
  return Number(`${match[1]}.${match[2] ?? '0'}`);
}

// Best-effort-Extraktion aus dem Suchergebnis-HTML. Muss gegen echtes HTML
// verifiziert werden — bei Nicht-Match liefert es einfach [] (kein Crash).
export function parseSearchResults(html: string, baseUrl: string): MarketplaceListing[] {
  const listings: MarketplaceListing[] = [];
  const articleRegex = /<article[^>]*class="[^"]*aditem[^"]*"[^>]*data-adid="(\d+)"[\s\S]*?<\/article>/g;

  for (const match of html.matchAll(articleRegex)) {
    const block = match[0];
    const id = match[1];
    const title = block.match(/class="[^"]*ellipsis[^"]*"[^>]*>([^<]+)</)?.[1]?.trim()
      ?? block.match(/<a[^>]*class="[^"]*text-module-begin[^"]*"[^>]*>([^<]+)</)?.[1]?.trim();
    const href = block.match(/href="(\/s-anzeige\/[^"]+)"/)?.[1];
    const priceRaw = block.match(/class="[^"]*aditem-main--middle--price[^"]*"[^>]*>([^<]+)</)?.[1]?.trim();
    if (!title || !href || !priceRaw) {
      continue;
    }

    const priceEur = parsePriceEur(priceRaw);
    if (priceEur <= 0) {
      continue;
    }

    listings.push({
      id: `kleinanzeigen-${id}`,
      source: 'kleinanzeigen',
      title,
      itemWebUrl: `${baseUrl}${href}`,
      priceEur,
      shippingEur: 0, // Kleinanzeigen: Versand meist verhandelbar; konservativ 0.
      totalEur: priceEur,
      currency: 'EUR',
      country: 'DE',
      buyingOptions: ['FIXED_PRICE'],
      aspects: [],
      raw: { id, href },
    });
  }

  return listings;
}

export async function searchKleinanzeigenListings(query: string): Promise<MarketplaceListing[]> {
  if (!env.KLEINANZEIGEN_ENABLED) {
    return [];
  }

  await throttle();
  try {
    const url = `${env.KLEINANZEIGEN_BASE_URL}/s-${encodeURIComponent(query.replace(/\s+/g, '-'))}/k0`;
    const response = await client.get<string>(url, { responseType: 'text' });
    const listings = parseSearchResults(String(response.data), env.KLEINANZEIGEN_BASE_URL);
    if (listings.length === 0) {
      logger.warn({ query }, 'kleinanzeigen search returned no parseable listings; verify scraper selectors');
    }
    return listings;
  } catch (error) {
    logger.warn({ error, query }, 'kleinanzeigen search failed');
    return [];
  }
}
