import { env } from '../../app/env/index.js';
import { loadProfiles } from '../../domains/gpu/domain/profileLoader.js';
import { createMarketReferenceService } from '../../domains/gpu/infrastructure/market/factory.js';
import { importBilligerFeed } from '../../domains/gpu/infrastructure/market/importers/billigerImporter.js';
import { importGuenstigerFeed } from '../../domains/gpu/infrastructure/market/importers/guenstigerImporter.js';

async function main(): Promise<void> {
  if (env.MARKET_REFERENCE_PROVIDER === 'none') {
    throw new Error('MARKET_REFERENCE_PROVIDER must not be set to none');
  }

  const profiles = loadProfiles();
  await importBilligerFeed(profiles);
  await importGuenstigerFeed(profiles);
  const service = createMarketReferenceService();
  if (!service) {
    throw new Error('No market reference service could be created from the current configuration');
  }
  await service.refreshAll(profiles);
  service.stop();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
