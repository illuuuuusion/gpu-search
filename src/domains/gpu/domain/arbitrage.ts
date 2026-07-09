import { env } from '../../../app/env/index.js';

// B4: echte Margen-Rechnung. Wiederverkaufswert kommt aus der eigenen
// Beobachtungs-Historie (B2-Basis: Ø funktionierender eBay-Preis pro Profil),
// da wir keine eBay-Marketplace-Insights-Sold-Comps haben.
export interface ArbitrageAssessment {
  resaleReferenceEur: number;
  buyCostEur: number;
  resaleFeeEur: number;
  resaleShippingEur: number;
  marginEur: number;
  profitable: boolean;
}

export function assessArbitrage(input: {
  buyPriceEur: number;
  buyShippingEur: number;
  resaleReferenceEur: number;
}): ArbitrageAssessment {
  const buyCostEur = Number((input.buyPriceEur + input.buyShippingEur).toFixed(2));
  const resaleFeeEur = Number((input.resaleReferenceEur * (env.ARBITRAGE_RESELL_FEE_PERCENT / 100)).toFixed(2));
  const resaleShippingEur = env.ARBITRAGE_RESELL_SHIPPING_EUR;
  const marginEur = Number((input.resaleReferenceEur - resaleFeeEur - resaleShippingEur - buyCostEur).toFixed(2));

  return {
    resaleReferenceEur: Number(input.resaleReferenceEur.toFixed(2)),
    buyCostEur,
    resaleFeeEur,
    resaleShippingEur,
    marginEur,
    profitable: marginEur >= env.ARBITRAGE_MIN_MARGIN_EUR,
  };
}
