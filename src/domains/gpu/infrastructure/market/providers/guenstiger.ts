import path from 'node:path';
import { env } from '../../../../../app/env/index.js';
import { JsonFeedMarketReferenceProvider } from '../jsonFeedProvider.js';

const DEFAULT_GUENSTIGER_FEED_PATH = path.resolve(process.cwd(), 'data/market-feeds/guenstiger.json');
const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), 'data/market-references');

export function createGuenstigerMarketReferenceProvider(): JsonFeedMarketReferenceProvider {
  const cacheDir = env.MARKET_REFERENCE_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  return new JsonFeedMarketReferenceProvider({
    id: 'guenstiger',
    displayName: 'guenstiger.de',
    sourceMode: env.GUENSTIGER_REFERENCE_SOURCE,
    feedFilePath: env.GUENSTIGER_REFERENCE_FILE_PATH ?? DEFAULT_GUENSTIGER_FEED_PATH,
    feedUrl: env.GUENSTIGER_REFERENCE_URL,
    authToken: env.GUENSTIGER_REFERENCE_AUTH_TOKEN,
    authHeaderName: env.GUENSTIGER_REFERENCE_AUTH_HEADER,
    requestTimeoutMs: env.MARKET_REFERENCE_REQUEST_TIMEOUT_MS,
    cachePath: path.resolve(cacheDir, 'guenstiger-reference-cache.json'),
  });
}
