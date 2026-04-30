import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRepairability } from './repairabilityScore.js';
import type { EbayListing } from '../domain/models.js';

function buildListing(overrides: Partial<EbayListing>): EbayListing {
  return {
    id: 'repair-test',
    title: 'GPU defekt',
    itemWebUrl: 'https://example.invalid/item',
    priceEur: 20,
    shippingEur: 5,
    totalEur: 25,
    currency: 'EUR',
    buyingOptions: ['FIXED_PRICE'],
    aspects: [],
    raw: {},
    ...overrides,
  };
}

test('assessRepairability rewards clear and promising defect symptoms', () => {
  const assessment = assessRepairability(buildListing({
    title: 'GTX 980 Ti defekt kein Bild',
    description: 'Luefter drehen, Karte komplett mit Kuehler, nicht geoeffnet.',
  }));

  assert.ok(assessment.score >= 75);
  assert.equal(assessment.confidence, 'high');
  assert.match(assessment.reasons.join(' '), /symptom_no_display/);
});

test('assessRepairability penalizes severe structural damage and missing parts', () => {
  const assessment = assessRepairability(buildListing({
    title: 'RX 580 defekt',
    description: 'Ohne GPU Chip, cracked pcb, verbrannt, for parts only.',
  }));

  assert.ok(assessment.score <= 5);
  assert.match(assessment.reasons.join(' '), /parts_only/);
});

test('assessRepairability stays cautious on vague untested listings', () => {
  const assessment = assessRepairability(buildListing({
    title: 'GTX 970 ungetestet',
    description: 'Geht nicht, unbekannter Fehler.',
  }));

  assert.ok(assessment.score >= 20 && assessment.score <= 45);
  assert.equal(assessment.confidence, 'medium');
});
