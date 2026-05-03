import path from 'node:path';
import { env } from '../../../../../app/env/index.js';
import type { GpuProfile } from '../../../domain/models.js';
import { runRawFeedImport } from './rawFeedImporter.js';

const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'data/market-feeds/guenstiger.json');

export async function importGuenstigerFeed(profiles: GpuProfile[]): Promise<boolean> {
  return runRawFeedImport(profiles, {
    provider: 'guenstiger',
    source: env.GUENSTIGER_IMPORT_SOURCE,
    format: env.GUENSTIGER_IMPORT_FORMAT,
    inputPath: env.GUENSTIGER_IMPORT_INPUT_PATH,
    inputUrl: env.GUENSTIGER_IMPORT_URL,
    authToken: env.GUENSTIGER_IMPORT_AUTH_TOKEN,
    authHeader: env.GUENSTIGER_IMPORT_AUTH_HEADER,
    username: env.GUENSTIGER_IMPORT_USERNAME,
    password: env.GUENSTIGER_IMPORT_PASSWORD,
    requestTimeoutMs: env.MARKET_REFERENCE_REQUEST_TIMEOUT_MS,
    outputPath: env.GUENSTIGER_REFERENCE_FILE_PATH ?? DEFAULT_OUTPUT_PATH,
  });
}
