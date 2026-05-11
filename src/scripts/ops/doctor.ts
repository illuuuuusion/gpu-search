import fs from 'node:fs/promises';
import path from 'node:path';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'data/scanner-state.json');
const DEFAULT_MARKET_SUMMARY_PATH = path.resolve(process.cwd(), 'data/market-summary.json');

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function inspectParentPath(filePath: string): Promise<string> {
  const parentPath = path.dirname(path.resolve(filePath));
  const exists = await pathExists(parentPath);
  return exists
    ? `${parentPath} exists`
    : `${parentPath} does not exist yet; it will be created on write`;
}

async function runDoctor(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const { env } = await import('../../app/env/index.js');
  results.push({
    name: 'environment',
    ok: true,
    detail: `provider=${env.EBAY_PROVIDER}, notifier=${env.NOTIFIER_PROVIDER}, valorant=${env.VALORANT_ENABLED}`,
  });

  const { loadProfiles } = await import('../../domains/gpu/domain/profileLoader.js');
  const profiles = loadProfiles();
  results.push({
    name: 'gpu profiles',
    ok: profiles.length > 0,
    detail: `${profiles.length} profiles loaded`,
  });

  const scannerStatePath = env.SCANNER_STATE_PATH ?? DEFAULT_STATE_PATH;
  results.push({
    name: 'scanner state path',
    ok: true,
    detail: await inspectParentPath(scannerStatePath),
  });

  const marketSummaryPath = env.MARKET_SUMMARY_PATH ?? DEFAULT_MARKET_SUMMARY_PATH;
  results.push({
    name: 'market summary path',
    ok: true,
    detail: await inspectParentPath(marketSummaryPath),
  });

  results.push({
    name: 'ebay credentials',
    ok: env.EBAY_PROVIDER === 'mock' || Boolean(env.EBAY_APP_ID && env.EBAY_CLIENT_SECRET),
    detail: env.EBAY_PROVIDER === 'mock'
      ? 'not required for mock provider'
      : 'configured for non-mock provider',
  });

  results.push({
    name: 'discord credentials',
    ok: env.NOTIFIER_PROVIDER !== 'discord' || Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID),
    detail: env.NOTIFIER_PROVIDER === 'discord'
      ? 'configured for discord notifier'
      : 'not required for console notifier',
  });

  return results;
}

try {
  const results = await runDoctor();
  for (const result of results) {
    const status = result.ok ? 'ok' : 'fail';
    console.log(`[${status}] ${result.name}${result.detail ? ` - ${result.detail}` : ''}`);
  }

  if (results.some(result => !result.ok)) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error('[fail] doctor');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
