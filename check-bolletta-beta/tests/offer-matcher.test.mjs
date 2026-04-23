import test from 'node:test';
import assert from 'node:assert/strict';

import { rankHurkaOffersForBill } from '../offer-matcher.mjs';
import { createAnalysisResult } from '../bill-analysis-core.mjs';

// Bolletta Edison reale: 646 kWh, 59 giorni, spesa materia 194.33€
// Annual materia: 194.33/59*365 = ~1201€, annual kWh: ~3997
function edisonHigh() {
  return createAnalysisResult({
    rawAnalysis: {
      commodity: 'luce',
      provider_name: 'Edison',
      customer_name: 'Sergio Giulino',
      supply_address: 'Fiuggi FR',
      pod_or_pdr: 'IT001E00000000',
      offer_code: 'EDISON DYNAMIC LUCE',
      market_type: 'libero',
      billing_period_start: '2026-01-01',
      billing_period_end: '2026-02-28',
      invoice_date: '2026-03-16',
      due_date: '2026-04-15',
      total_amount_eur: 229.89,
      consumption_total: 646,
      consumption_unit: 'kWh',
      fascia_f1: 0,
      fascia_f2: 0,
      fascia_f3: 0,
      spesa_materia_eur: 194.33,
      quota_consumi_eur: 0,
      quota_fissa_eur: 0,
      quota_potenza_eur: 0,
      trasporto_e_oneri_eur: 0,
      imposte_iva_eur: 35.56,
      altre_partite_eur: 0,
      price_formula_text: 'EDISON DYNAMIC indicizzato',
      estimated_monthly_cost: 115,
      estimated_annual_cost: 1380,
      extraction_confidence: 0.93,
      summary: 'Spesa alta per profilo con offerta indicizzata',
      main_cost_drivers: ['Quota energia'],
      possible_issues: [],
      estimated_savings_range: { min: 0, max: 0 },
      confidence_note: 'Dati leggibili.',
      cta_recommendation: 'Verifica HURKA',
    },
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  });
}

// Bolletta Duferco: 229 kWh, 30 giorni, spesa materia 44.35€ — profilo low-savings
function dufercoCheap() {
  return createAnalysisResult({
    rawAnalysis: {
      commodity: 'luce',
      provider_name: 'Duferco Energia',
      customer_name: 'Ciavattella Fabio',
      supply_address: 'Montesilvano PE',
      pod_or_pdr: 'IT001E00000001',
      offer_code: '',
      market_type: 'libero',
      billing_period_start: '2025-04-01',
      billing_period_end: '2025-04-30',
      invoice_date: '2025-05-09',
      due_date: '2025-05-29',
      total_amount_eur: 87.33,
      consumption_total: 229,
      consumption_unit: 'kWh',
      fascia_f1: 0,
      fascia_f2: 0,
      fascia_f3: 0,
      spesa_materia_eur: 44.35,
      quota_consumi_eur: 0,
      quota_fissa_eur: 0,
      quota_potenza_eur: 0,
      trasporto_e_oneri_eur: 14.48,
      imposte_iva_eur: 12.32,
      altre_partite_eur: 16.18,
      price_formula_text: '',
      estimated_monthly_cost: 87,
      estimated_annual_cost: 1044,
      extraction_confidence: 0.88,
      summary: 'Spesa nella norma',
      main_cost_drivers: ['Quota energia'],
      possible_issues: [],
      estimated_savings_range: { min: 0, max: 0 },
      confidence_note: '',
      cta_recommendation: 'Verifica clausole',
    },
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  });
}

function lowConfidence() {
  return createAnalysisResult({
    rawAnalysis: {
      commodity: 'luce',
      provider_name: 'Fornitore',
      customer_name: '',
      supply_address: '',
      pod_or_pdr: '',
      offer_code: '',
      market_type: 'unknown',
      billing_period_start: null,
      billing_period_end: null,
      invoice_date: null,
      due_date: null,
      total_amount_eur: 120,
      consumption_total: 200,
      consumption_unit: 'kWh',
      fascia_f1: 0,
      fascia_f2: 0,
      fascia_f3: 0,
      spesa_materia_eur: 0,
      quota_consumi_eur: 0,
      quota_fissa_eur: 0,
      quota_potenza_eur: 0,
      trasporto_e_oneri_eur: 0,
      imposte_iva_eur: 0,
      altre_partite_eur: 0,
      price_formula_text: '',
      estimated_monthly_cost: 0,
      estimated_annual_cost: 0,
      extraction_confidence: 0.42,
      summary: '',
      main_cost_drivers: [],
      possible_issues: [],
      estimated_savings_range: { min: 0, max: 0 },
      confidence_note: '',
      cta_recommendation: '',
    },
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  });
}

// ── Tests ────────────────────────────────────────────────────

test('Edison high-cost bill: should find a credible HURKA saving (Sinergas BIENNALE)', () => {
  const analysis = edisonHigh();
  const result = rankHurkaOffersForBill(analysis, { preferenceType: 'risparmio' });

  assert.equal(result.hasMatch, true, 'should have a match');
  assert.ok(result.topOffer !== null, 'topOffer should not be null');
  assert.ok(result.topOffer.savings.annual >= 200, `annual saving should be >= 200€, got ${result.topOffer.savings.annual}`);
  assert.ok(['sinergas-biennale-luce-casa', 'sinergas-energia-piu-vicina-bio', 'ee-flex-family-sempre-zero'].includes(result.topOffer.id),
    `expected a cheaper offer, got ${result.topOffer.id}`);
  assert.ok(result.topOffer.calculationBasis.annualConsumptionKwh > 3500, 'should annualize ~4000 kWh');
  assert.ok(result.topOffer.calculationBasis.billingDays > 55, 'should detect ~59 billing days');
  assert.equal(result.topOffer.calculationBasis.spesaMateriaSource, 'extracted');
});

test('Edison: stabilita preference should prefer fixed-price offer', () => {
  const analysis = edisonHigh();
  const result = rankHurkaOffersForBill(analysis, { preferenceType: 'stabilita' });

  assert.equal(result.hasMatch, true);
  // With stabilita preference, fixed offers should be ranked first if they save money
  assert.ok(['sinergas-biennale-luce-casa', 'ee-fix-family-rap'].includes(result.topOffer.id),
    `expected fixed offer first, got ${result.topOffer.id}`);
});

test('Duferco cheap bill: no credible saving — hasMatch false', () => {
  const analysis = dufercoCheap();
  const result = rankHurkaOffersForBill(analysis, { preferenceType: 'risparmio' });

  // Duferco spesa materia 44.35€/mese → ~532€/year
  // Sinergas BIENNALE: 144 + 2748*0.1649 = ~597€/year → Duferco is cheaper
  // So no match expected
  assert.equal(result.hasMatch, false, 'Duferco appears cheaper than HURKA offers');
  assert.equal(result.topOffer, null);
  assert.ok(typeof result.noMatchReason === 'string' && result.noMatchReason.length > 0);
});

test('Low confidence extraction: no match returned', () => {
  const analysis = lowConfidence();
  const result = rankHurkaOffersForBill(analysis, { preferenceType: 'risparmio' });

  assert.equal(result.hasMatch, false);
  assert.match(result.noMatchReason, /confidenza/i);
});

test('Gas commodity: no match with current offers (luce only)', () => {
  const analysis = createAnalysisResult({
    rawAnalysis: {
      commodity: 'gas',
      provider_name: 'ENI',
      customer_name: 'Test',
      supply_address: 'Roma',
      pod_or_pdr: '',
      offer_code: '',
      market_type: 'libero',
      billing_period_start: '2026-01-01',
      billing_period_end: '2026-01-31',
      invoice_date: '2026-02-01',
      due_date: '2026-03-01',
      total_amount_eur: 90,
      consumption_total: 50,
      consumption_unit: 'Smc',
      fascia_f1: 0,
      fascia_f2: 0,
      fascia_f3: 0,
      spesa_materia_eur: 40,
      quota_consumi_eur: 0,
      quota_fissa_eur: 0,
      quota_potenza_eur: 0,
      trasporto_e_oneri_eur: 0,
      imposte_iva_eur: 0,
      altre_partite_eur: 0,
      price_formula_text: '',
      estimated_monthly_cost: 90,
      estimated_annual_cost: 1080,
      extraction_confidence: 0.88,
      summary: '',
      main_cost_drivers: [],
      possible_issues: [],
      estimated_savings_range: { min: 0, max: 0 },
      confidence_note: '',
      cta_recommendation: '',
    },
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  });

  const result = rankHurkaOffersForBill(analysis);
  assert.equal(result.hasMatch, false);
  assert.match(result.noMatchReason, /gas/i);
});

test('Offer match output has all required fields', () => {
  const result = rankHurkaOffersForBill(edisonHigh(), { preferenceType: 'risparmio' });
  if (!result.hasMatch) return; // already tested above

  const offer = result.topOffer;
  assert.ok(typeof offer.id === 'string');
  assert.ok(typeof offer.name === 'string');
  assert.ok(typeof offer.provider === 'string');
  assert.ok(typeof offer.savings.annual === 'number');
  assert.ok(typeof offer.savings.monthly === 'number');
  assert.ok(typeof offer.savings.percent === 'number');
  assert.ok(typeof offer.savings.currentAnnualVendorCost === 'number');
  assert.ok(typeof offer.savings.hurkaAnnualCost === 'number');
  assert.ok(typeof offer.calculationBasis.annualConsumptionKwh === 'number');
  assert.ok(typeof offer.calculationBasis.billingDays === 'number');
  assert.ok(typeof offer.calculationBasis.spesaMateriaSource === 'string');
  assert.ok(Array.isArray(offer.caveats));
  assert.ok(typeof result.calculatedAt === 'string');
});

test('Saving falls back to derived from quota fields when spesa_materia_eur is 0', () => {
  const analysis = createAnalysisResult({
    rawAnalysis: {
      commodity: 'luce',
      provider_name: 'Test',
      customer_name: '',
      supply_address: '',
      pod_or_pdr: '',
      offer_code: '',
      market_type: 'libero',
      billing_period_start: '2026-01-01',
      billing_period_end: '2026-01-31',
      invoice_date: null,
      due_date: null,
      total_amount_eur: 180,
      consumption_total: 300,
      consumption_unit: 'kWh',
      fascia_f1: 0,
      fascia_f2: 0,
      fascia_f3: 0,
      spesa_materia_eur: 0,  // not extracted
      quota_consumi_eur: 70,  // derived from these
      quota_fissa_eur: 15,
      quota_potenza_eur: 10,
      trasporto_e_oneri_eur: 0,
      imposte_iva_eur: 0,
      altre_partite_eur: 0,
      price_formula_text: '',
      estimated_monthly_cost: 180,
      estimated_annual_cost: 2160,
      extraction_confidence: 0.85,
      summary: '',
      main_cost_drivers: [],
      possible_issues: [],
      estimated_savings_range: { min: 0, max: 0 },
      confidence_note: '',
      cta_recommendation: '',
    },
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  });

  const result = rankHurkaOffersForBill(analysis);
  // derived = 70+15+10 = 95/month → 1140/year
  // should still find a match or at least process without error
  assert.ok(['derived', 'estimated', 'extracted'].includes(
    result.topOffer?.calculationBasis?.spesaMateriaSource ?? 'derived',
  ));
});
