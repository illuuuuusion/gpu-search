import path from 'node:path';
import { env } from '../../../../../app/env/index.js';
import { JsonFeedMarketReferenceProvider } from '../jsonFeedProvider.js';

const DEFAULT_BILLIGER_FEED_PATH = path.resolve(process.cwd(), 'data/market-feeds/billiger.json');
const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), 'data/market-references');

export function createBilligerMarketReferenceProvider(): JsonFeedMarketReferenceProvider {
  const cacheDir = env.MARKET_REFERENCE_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  return new JsonFeedMarketReferenceProvider({
    id: 'billiger',
    displayName: 'billiger.de',
    sourceMode: env.BILLIGER_REFERENCE_SOURCE,
    feedFilePath: env.BILLIGER_REFERENCE_FILE_PATH ?? DEFAULT_BILLIGER_FEED_PATH,
    feedUrl: env.BILLIGER_REFERENCE_URL,
    authToken: env.BILLIGER_REFERENCE_AUTH_TOKEN,
    authHeaderName: env.BILLIGER_REFERENCE_AUTH_HEADER,
    requestTimeoutMs: env.MARKET_REFERENCE_REQUEST_TIMEOUT_MS,
    cachePath: path.resolve(cacheDir, 'billiger-reference-cache.json'),
  });
}
