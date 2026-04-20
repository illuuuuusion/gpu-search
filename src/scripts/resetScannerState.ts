import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'data/scanner-state.json');

async function main(): Promise<void> {
  const statePath = env.SCANNER_STATE_PATH ?? DEFAULT_STATE_PATH;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    seen: [],
    observations: [],
  }, null, 2));

  console.log(`Scanner state reset: ${statePath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
