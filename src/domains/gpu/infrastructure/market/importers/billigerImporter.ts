import path from 'node:path';
import { env } from '../../../../../app/env/index.js';
import type { GpuProfile } from '../../../domain/models.js';
import { runRawFeedImport } from './rawFeedImporter.js';

const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'data/market-feeds/billiger.json');

export async function importBilligerFeed(profiles: GpuProfile[]): Promise<boolean> {
  return runRawFeedImport(profiles, {
    provider: 'billiger',
    source: env.BILLIGER_IMPORT_SOURCE,
    format: env.BILLIGER_IMPORT_FORMAT,
    inputPath: env.BILLIGER_IMPORT_INPUT_PATH,
    inputUrl: env.BILLIGER_IMPORT_URL,
    authToken: env.BILLIGER_IMPORT_AUTH_TOKEN,
    authHeader: env.BILLIGER_IMPORT_AUTH_HEADER,
    username: env.BILLIGER_IMPORT_USERNAME,
    password: env.BILLIGER_IMPORT_PASSWORD,
    requestTimeoutMs: env.MARKET_REFERENCE_REQUEST_TIMEOUT_MS,
    outputPath: env.BILLIGER_REFERENCE_FILE_PATH ?? DEFAULT_OUTPUT_PATH,
  });
}
