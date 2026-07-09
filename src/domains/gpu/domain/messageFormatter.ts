import type { DealTimingAssessment, EvaluatedListing } from '../domain/models.js';
import type { ArbitrageAssessment } from '../domain/arbitrage.js';
import type { AlertMessage } from '../../../app/shared/notifier/index.js';
import { env } from '../../../app/env/index.js';

// Emojis muessen mit den Reaction-Handlern in notifier.ts uebereinstimmen.
const ACCEPTANCE_UP_EMOJI = '👍';
const ACCEPTANCE_DOWN_EMOJI = '👎';
const EXCLUSION_EMOJI = '🚫';
const AUCTION_REMINDER_EMOJI = '⏰';
const DREAM_DEAL_UP_EMOJI = '🔥';
const DREAM_DEAL_DOWN_EMOJI = '🧊';

function percentDelta(referencePrice: number | undefined, actualPrice: number): number | undefined {
  if (!referencePrice || referencePrice <= 0) {
    return undefined;
  }

  return Number((((referencePrice - actualPrice) / referencePrice) * 100).toFixed(2));
}

function formatDealTiming(timing: DealTimingAssessment): string {
  const label = timing.verdict === 'buy_now'
    ? '🟢 Jetzt kaufen (Preise steigen)'
    : timing.verdict === 'wait'
      ? '🔵 Eher abwarten (Preise fallen)'
      : '🟡 Neutral';
  return `${label} | Ø 7T ${timing.recentAveragePriceEur.toFixed(2)} € vs 30T ${timing.olderAveragePriceEur.toFixed(2)} € (${timing.changePercent > 0 ? '+' : ''}${timing.changePercent.toFixed(1)}%)`;
}

// Reactions fuer einen normalen Alert, abhaengig von Feature-Flags + Angebotsart.
function alertReactions(result: EvaluatedListing): string[] {
  const reactions: string[] = [];
  if (env.ADAPTIVE_THRESHOLD_ENABLED) {
    reactions.push(ACCEPTANCE_UP_EMOJI, ACCEPTANCE_DOWN_EMOJI);
  }
  if (env.RUNTIME_EXCLUSIONS_ENABLED) {
    reactions.push(EXCLUSION_EMOJI);
  }
  const isAuction = !result.listing.buyingOptions.includes('FIXED_PRICE');
  if (env.AUCTION_REMINDER_ENABLED && isAuction && result.listing.itemEndDate) {
    reactions.push(AUCTION_REMINDER_EMOJI);
  }
  return reactions;
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

  // B2: Kauf-jetzt-oder-warten-Zeile (nur wenn genug Historie vorhanden).
  if (result.dealTiming) {
    fields.push({ name: 'Timing', value: formatDealTiming(result.dealTiming), inline: false });
  }

  return {
    title: `${result.profile.name} | ${healthLabel}`,
    description: result.listing.title,
    url: result.listing.itemWebUrl,
    imageUrl: result.listing.imageUrl,
    color: isDefect ? 'danger' : 'success',
    fields,
    listingId: result.listing.id,
    reactions: alertReactions(result),
  };
}

// C1: optisch klar abgesetzte Dream-Deal-Sondernachricht mit 🔥/🧊-Feedback.
export function formatDreamDealMessage(result: EvaluatedListing): AlertMessage {
  const fields = [
    { name: 'Preis', value: `${result.listing.priceEur.toFixed(2)} €`, inline: true },
    { name: 'Gesamt', value: `${result.listing.totalEur.toFixed(2)} €`, inline: true },
    { name: 'Deal-Limit', value: `${result.effectiveLimitEur.toFixed(2)} €`, inline: true },
    { name: 'Spielraum', value: `${result.limitHeadroomPercent.toFixed(2)}%`, inline: true },
    { name: 'Dream-Deal-Score', value: `${(result.dreamDealScore ?? 0).toFixed(2)}`, inline: true },
    { name: 'Verkäuferbewertung', value: `${result.listing.sellerFeedbackPercent ?? 0}%`, inline: true },
  ];

  if (result.dealTiming) {
    fields.push({ name: 'Timing', value: formatDealTiming(result.dealTiming), inline: false });
  }

  return {
    title: `🌟 DREAM DEAL 🌟 | ${result.profile.name}`,
    description: result.listing.title,
    url: result.listing.itemWebUrl,
    imageUrl: result.listing.imageUrl,
    color: 'dream',
    fields,
    reactions: [DREAM_DEAL_UP_EMOJI, DREAM_DEAL_DOWN_EMOJI],
  };
}

// B4: Cross-Marketplace-Arbitrage-Alert (Kaufquelle vs. eBay-Wiederverkaufswert).
export function formatArbitrageMessage(result: EvaluatedListing, assessment: ArbitrageAssessment): AlertMessage {
  const base = formatListingMessage(result);
  return {
    ...base,
    title: `💱 ARBITRAGE | ${result.profile.name}`,
    fields: [
      { name: 'Quelle', value: result.listing.source ?? 'ebay', inline: true },
      { name: 'Kaufpreis inkl. Versand', value: `${assessment.buyCostEur.toFixed(2)} €`, inline: true },
      { name: 'Ø Wiederverkauf (eBay)', value: `${assessment.resaleReferenceEur.toFixed(2)} €`, inline: true },
      { name: 'Gebühren', value: `${assessment.resaleFeeEur.toFixed(2)} €`, inline: true },
      { name: 'Weiterversand', value: `${assessment.resaleShippingEur.toFixed(2)} €`, inline: true },
      { name: 'Marge', value: `${assessment.marginEur.toFixed(2)} €`, inline: true },
    ],
  };
}
