import type { EvaluatedListing } from '../types/domain.js';

export function formatListingMessage(result: EvaluatedListing): string {
  const offerType = result.listing.buyingOptions.includes('FIXED_PRICE') ? 'Sofort-Kaufen' : 'Auktion';
  const health = result.health === 'DEFECT' ? 'Defekt, aber vollständig' : 'Funktionsstatus unklar/OK';

  return [
    `🎮 ${result.profile.name}`,
    `${offerType} | ${health}`,
    `Preis: ${result.listing.priceEur.toFixed(2)} €`,
    `Versand: ${result.listing.shippingEur.toFixed(2)} €`,
    `Gesamt: ${result.listing.totalEur.toFixed(2)} €`,
    `Verkäufer: ${result.listing.sellerUsername ?? 'unbekannt'} (${result.listing.sellerFeedbackPercent ?? 0}%)`,
    `Score: ${result.score}`,
    result.listing.itemWebUrl,
  ].join('\n');
}
