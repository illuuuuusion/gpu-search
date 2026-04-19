import { env } from '../config/env.js';
import { loadProfiles } from '../core/profileLoader.js';
import { GeizhalsReferenceService } from '../integrations/geizhals/referenceService.js';

async function main(): Promise<void> {
  if (env.MARKET_REFERENCE_PROVIDER !== 'geizhals') {
    throw new Error('MARKET_REFERENCE_PROVIDER must be set to geizhals');
  }

  const profiles = loadProfiles();
  const service = new GeizhalsReferenceService();
  await service.refreshAll(profiles);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
