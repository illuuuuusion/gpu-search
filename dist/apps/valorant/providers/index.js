import { VlrValorantCompositionProvider } from './vlr/provider.js';
export function createValorantCompositionProvider(options) {
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
            const exhaustiveCheck = options.provider;
            throw new Error(`Unsupported VALORANT provider: ${String(exhaustiveCheck)}`);
        }
    }
}
