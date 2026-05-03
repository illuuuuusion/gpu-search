import type { EvaluatedListing } from '../domain/models.js';
import type { AlertMessage } from '../../../app/shared/notifier/index.js';

const REFERENCE_SOURCE_LABELS = {
  override: 'Fallback-Referenz',
  billiger: 'billiger.de neu',
  guenstiger: 'guenstiger.de neu',
  composite: 'Preisvergleich neu',
  geizhals: 'Legacy-Referenz',
} as const;

const PRICING_ANCHOR_LABELS = {
  brand_family_median: 'Marke Median',
  family_median: 'Modell Median',
  family_lowest: 'Modell Tiefstpreis',
  market_median: 'Markt Median',
  market_lowest: 'Markt Tiefstpreis',
} as const;

function percentDelta(referencePrice: number | undefined, actualPrice: number): number | undefined {
  if (!referencePrice || referencePrice <= 0) {
    return undefined;
  }

  return Number((((referencePrice - actualPrice) / referencePrice) * 100).toFixed(2));
}

export function formatListingMessage(result: EvaluatedListing): AlertMessage {
  const offerType = result.listing.buyingOptions.includes('FIXED_PRICE') ? 'Sofort-Kaufen' : 'Auktion';
  const isDefect = result.health === 'DEFECT';
  const healthLabel = isDefect ? '❌ Defekt' : '✅ Funktionsfähig';
  const currentAveragePrice = isDefect
    ? result.marketStats?.averageDefectPriceEur
    : result.marketStats?.averageWorkingPriceEur;
  const averageDelta = percentDelta(currentAveragePrice, result.listing.totalEur);
  const fields = [
    { name: 'Angebotsart', value: offerType, inline: true },
    { name: 'Preis', value: `${result.listing.priceEur.toFixed(2)} €`, inline: true },
    { name: 'Versand', value: `${result.listing.shippingEur.toFixed(2)} €`, inline: true },
    { name: 'Gesamt', value: `${result.listing.totalEur.toFixed(2)} €`, inline: true },
    { name: 'Deal-Limit', value: `${result.effectiveLimitEur.toFixed(2)} €`, inline: true },
    { name: 'Spielraum', value: `${result.limitHeadroomPercent.toFixed(2)}%`, inline: true },
    { name: 'Verkäuferbewertung', value: `${result.listing.sellerFeedbackPercent ?? 0}%`, inline: true },
    { name: 'Deal-Score', value: result.score.toFixed(2), inline: true },
  ];

  if (result.evaluationMode === 'debug') {
    fields.unshift({ name: 'Modus', value: 'Debug-Preisfilter', inline: true });
  }

  if (result.listing.boardBrand) {
    fields.push({ name: 'Boardpartner', value: result.listing.boardBrand, inline: true });
  }

  if (result.listing.boardModel) {
    fields.push({ name: 'Variante', value: result.listing.boardModel, inline: true });
  }

  if (result.listing.gpuModel && result.listing.gpuModel !== result.profile.name) {
    fields.push({ name: 'GPU-Merkmal', value: result.listing.gpuModel, inline: true });
  }

  if (result.repairability) {
    fields.push(
      { name: 'Repair-Score', value: `${result.repairability.score}/100`, inline: true },
      { name: 'Repair-Confidence', value: result.repairability.confidence, inline: true },
      { name: 'Repair-Hinweise', value: result.repairability.reasons.slice(0, 4).join(', '), inline: false },
    );
  }

  if (result.referenceMatch) {
    const referenceLabel = REFERENCE_SOURCE_LABELS[result.referenceMatch.reference.source];

    fields.push(
      { name: referenceLabel, value: `${result.referenceMatch.priceEur.toFixed(2)} €`, inline: true },
      {
        name: 'Rabatt vs Referenz',
        value: `${(result.retailDiscountPercent ?? 0).toFixed(2)}%`,
        inline: true,
      },
      {
        name: 'Preisanker',
        value: PRICING_ANCHOR_LABELS[result.referenceMatch.pricingAnchor],
        inline: true,
      },
      {
        name: 'Referenz-Match',
        value: result.referenceMatch.strategy,
        inline: true,
      },
      {
        name: 'Referenz-Modell',
        value: result.referenceMatch.matchedTitle,
        inline: false,
      },
      {
        name: 'Markt Median',
        value: `${result.referenceMatch.marketMedianPriceEur.toFixed(2)} €`,
        inline: true,
      },
      {
        name: 'Markt Tiefstpreis',
        value: `${result.referenceMatch.marketLowestPriceEur.toFixed(2)} €`,
        inline: true,
      },
    );

    if (result.referenceMatch.brandMatchedPriceEur) {
      fields.push({
        name: 'Marken-Median',
        value: `${result.referenceMatch.brandMatchedPriceEur.toFixed(2)} €`,
        inline: true,
      });
    }

    if (result.referenceMatch.reference.source === 'override') {
      fields.push({
        name: 'Referenzquelle',
        value: result.referenceMatch.reference.note ?? 'Manueller Override-Fallback',
        inline: false,
      });
    }
  }

  if (result.marketStats) {
    fields.push({
      name: `Ø Score (${result.marketStats.windowDays}T)`,
      value: `${result.marketStats.averageScore.toFixed(2)} (n=${result.marketStats.acceptedCount})`,
      inline: true,
    });

    if (result.marketStats.averageWorkingPriceEur) {
      fields.push({
        name: `Ø Gebraucht (${result.marketStats.windowDays}T)`,
        value: `${result.marketStats.averageWorkingPriceEur.toFixed(2)} € (n=${result.marketStats.workingCount})`,
        inline: true,
      });
    }

    if (result.marketStats.averageDefectPriceEur) {
      fields.push({
        name: `Ø Defekt (${result.marketStats.windowDays}T)`,
        value: `${result.marketStats.averageDefectPriceEur.toFixed(2)} € (n=${result.marketStats.defectCount})`,
        inline: true,
      });
    }

    if (averageDelta !== undefined) {
      fields.push({
        name: 'vs Ø Markt',
        value: `${averageDelta.toFixed(2)}%`,
        inline: true,
      });
    }
  }

  return {
    title: `${result.profile.name} | ${healthLabel}`,
    description: result.listing.title,
    url: result.listing.itemWebUrl,
    imageUrl: result.listing.imageUrl,
    color: isDefect ? 'danger' : 'success',
    fields,
    listingId: result.listing.id,
  };
}
