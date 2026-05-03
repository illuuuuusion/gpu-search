import { env } from '../../../../app/env/index.js';
import { logger } from '../../../../app/shared/logger.js';
import { CompositeMarketReferenceService } from './compositeReferenceService.js';
import { createBilligerMarketReferenceProvider } from './providers/billiger.js';
import { createGuenstigerMarketReferenceProvider } from './providers/guenstiger.js';
import type { MarketReferenceProvider, MarketReferenceProviderId, MarketReferenceService } from './types.js';

function parseProviderIds(raw: string): MarketReferenceProviderId[] {
  const providers = raw
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value): value is MarketReferenceProviderId => value === 'billiger' || value === 'guenstiger');

  return Array.from(new Set(providers));
}

function createProvider(id: MarketReferenceProviderId): MarketReferenceProvider | null {
  if (id === 'billiger') {
    return createBilligerMarketReferenceProvider();
  }

  if (id === 'guenstiger') {
    return createGuenstigerMarketReferenceProvider();
  }

  logger.warn({ provider: id }, 'Provider is only available as legacy standalone service');
  return null;
}

export function createMarketReferenceService(): MarketReferenceService | undefined {
  if (env.MARKET_REFERENCE_PROVIDER === 'none') {
    return undefined;
  }
  const configuredProviders: MarketReferenceProviderId[] = env.MARKET_REFERENCE_PROVIDER === 'billiger'
    ? ['billiger']
    : env.MARKET_REFERENCE_PROVIDER === 'guenstiger'
      ? ['guenstiger']
      : parseProviderIds(env.MARKET_REFERENCE_PROVIDERS);
  const providers = configuredProviders
    .map(createProvider)
    .filter((provider): provider is MarketReferenceProvider => Boolean(provider));

  if (providers.length === 0) {
    logger.warn({
      marketReferenceProvider: env.MARKET_REFERENCE_PROVIDER,
      configuredProviders,
    }, 'No market reference providers were created');
    return undefined;
  }

  return new CompositeMarketReferenceService(providers);
}
