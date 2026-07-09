import test from 'node:test';
import assert from 'node:assert/strict';
import { assessArbitrage } from './arbitrage.js';

// Env-Defaults: Marge >= 40 €, Gebuehr 12 %, Weiterversand 8 €.
test('arbitrage margin uses fees + shipping and flags profitable deals', () => {
  const good = assessArbitrage({ buyPriceEur: 200, buyShippingEur: 0, resaleReferenceEur: 320 });
  // 320 - 38.40 (12%) - 8 - 200 = 73.60
  assert.equal(good.marginEur, 73.6);
  assert.equal(good.profitable, true);

  const thin = assessArbitrage({ buyPriceEur: 300, buyShippingEur: 0, resaleReferenceEur: 320 });
  assert.equal(thin.profitable, false);
});
