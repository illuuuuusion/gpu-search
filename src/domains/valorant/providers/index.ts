import type { ValorantCompositionProvider } from '../domain/models.js';
import type { ValorantCompositionDataProvider } from './types.js';
import { VlrValorantCompositionProvider } from './vlr/provider.js';

interface ProviderFactoryOptions {
  provider: ValorantCompositionProvider;
  vlrBaseUrl: string;
  vlrMinRequestIntervalMs: number;
  vlrMaxEventPages: number;
  vlrMaxMatchTimestampLookups: number;
  vlrRecentMatchDays: number;
}

export function createValorantCompositionProvider(
  options: ProviderFactoryOptions,
): ValorantCompositionDataProvider {
  switch (options.provider) {
    case 'vlr':
      return new VlrValorantCompositionProvider({
        baseUrl: options.vlrBaseUrl,
        minRequestIntervalMs: options.vlrMinRequestIntervalMs,
        maxEventPages: options.vlrMaxEventPages,
        maxMatchTimestampLookups: options.vlrMaxMatchTimestampLookups,
        recentMatchDays: options.vlrRecentMatchDays,
      });
    case 'grid':
      throw new Error('GRID provider is not implemented yet. Set VALORANT_PROVIDER=vlr for now.');
    default: {
      const exhaustiveCheck: never = options.provider;
      throw new Error(`Unsupported VALORANT provider: ${String(exhaustiveCheck)}`);
    }
  }
}
