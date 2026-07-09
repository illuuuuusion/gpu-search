import type { EvaluatedListing } from './models.js';

// C1: Dream-Deal-Score, nur fuer WORKING-Listings (defekte sind ausgeschlossen).
// Gewichtung laut Vorgabe: 1. Preis (Headroom), 2. Verkaeuferbewertung.
// ponytail: einfache monotone Kombination, kein ML/Kalibrierung fuer zwei Nutzer.
// Das Feedback ist nur ein kleiner Nudge, damit der Preis-Headroom dominiert und
// die Zahl im selben Prozent-Massstab wie die normale Deal-Score-Schwelle bleibt.
const FEEDBACK_NEUTRAL_PERCENT = 97;
const FEEDBACK_WEIGHT = 0.4; // pro Prozentpunkt ueber/unter 97 %, geclampt
const FEEDBACK_BONUS_CAP = 2;
const FEEDBACK_MALUS_CAP = -5;

function feedbackAdjustment(sellerFeedbackPercent: number | undefined): number {
  if (sellerFeedbackPercent === undefined) {
    return 0;
  }
  const raw = (sellerFeedbackPercent - FEEDBACK_NEUTRAL_PERCENT) * FEEDBACK_WEIGHT;
  return Math.max(FEEDBACK_MALUS_CAP, Math.min(FEEDBACK_BONUS_CAP, raw));
}

// Monoton steigend sowohl in limitHeadroomPercent als auch in sellerFeedbackPercent.
export function calculateDreamDealScore(evaluated: Pick<EvaluatedListing, 'limitHeadroomPercent' | 'listing'>): number {
  const priceComponent = evaluated.limitHeadroomPercent;
  const feedbackComponent = feedbackAdjustment(evaluated.listing.sellerFeedbackPercent);
  return Number((priceComponent + feedbackComponent).toFixed(2));
}
