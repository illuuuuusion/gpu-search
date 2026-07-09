import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDreamDealScore } from './dreamDealScore.js';
import type { EbayListing } from './models.js';

function listing(sellerFeedbackPercent?: number): EbayListing {
  return {
    id: 'x', title: 't', itemWebUrl: '', priceEur: 100, shippingEur: 0, totalEur: 100,
    currency: 'EUR', buyingOptions: ['FIXED_PRICE'], aspects: [], sellerFeedbackPercent, raw: {},
  };
}

test('dream deal score is monotonic in headroom and seller feedback', () => {
  const lowHeadroom = calculateDreamDealScore({ limitHeadroomPercent: 10, listing: listing(99) });
  const highHeadroom = calculateDreamDealScore({ limitHeadroomPercent: 20, listing: listing(99) });
  assert.ok(highHeadroom > lowHeadroom, 'more headroom => higher score');

  const lowFeedback = calculateDreamDealScore({ limitHeadroomPercent: 15, listing: listing(92) });
  const highFeedback = calculateDreamDealScore({ limitHeadroomPercent: 15, listing: listing(100) });
  assert.ok(highFeedback >= lowFeedback, 'better feedback => not lower score');

  // Preis dominiert: mehr Headroom schlaegt besseres Feedback nicht um.
  assert.ok(
    calculateDreamDealScore({ limitHeadroomPercent: 25, listing: listing(80) })
    > calculateDreamDealScore({ limitHeadroomPercent: 15, listing: listing(100) }),
  );
});
