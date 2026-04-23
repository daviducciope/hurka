import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCustomerEmail, buildInternalLeadEmail } from '../email-templates.mjs';

const baseAnalysis = {
  extraction: {
    commodity: 'luce',
    provider_name: 'Edison',
    offer_code: 'DYNAMIC',
    total_amount_eur: 229.89,
    consumption_total: 646,
    consumption_unit: 'kWh',
    billing_period_start: '2026-01-01',
    billing_period_end: '2026-02-28',
    estimated_annual_cost: 1380,
    extraction_confidence: 0.93,
    spesa_materia_eur: 194.33,
    quota_consumi_eur: 0,
    quota_fissa_eur: 0,
    quota_potenza_eur: 0,
  },
  explanation: { summary: 'Spesa alta per profilo indicizzato.' },
  meta: { fileName: 'bolletta.pdf' },
};

const offerMatchPositive = {
  hasMatch: true,
  topOffer: {
    name: 'Biennale Luce Casa',
    provider: 'Sinergas S.p.A.',
    offerCode: '000753ESFML04XXP0094PB3181260416',
    savings: {
      annual: 398,
      monthly: 33,
      percent: 33,
      currentAnnualVendorCost: 1201,
      hurkaAnnualCost: 803,
    },
    priceBasis: 'fixed',
    calculationBasis: {
      annualConsumptionKwh: 3997,
      billingDays: 59,
      spesaMateriaSource: 'extracted',
      punReferenceUsed: null,
    },
    caveats: ['Fisso 24 mesi'],
  },
  alternativeOffer: null,
  noMatchReason: null,
};

const offerMatchNone = {
  hasMatch: false,
  topOffer: null,
  alternativeOffer: null,
  noMatchReason: 'Profilo gia competitivo con offerta attuale.',
};

const leadScore = {
  total: 82,
  scoreA: 48,
  scoreB: 34,
  class: 'caldo',
};

// ── buildCustomerEmail ───────────────────────────────────────

test('customer email with offer match contains saving amount and offer name', () => {
  const { subject, text, html } = buildCustomerEmail({
    nome: 'Mario Rossi',
    commodity: 'luce',
    offerMatch: offerMatchPositive,
    consentMarketing: false,
  });

  assert.match(subject, /bolletta.*analisi/i);
  assert.match(text, /Biennale Luce Casa/i);
  assert.match(text, /398/);
  assert.match(html, /Biennale Luce Casa/);
  // No aggressive sales language
  assert.ok(!text.includes('miglior fornitore assoluto'));
});

test('customer email without offer match is reassuring and contains no sales promise', () => {
  const { text, html } = buildCustomerEmail({
    nome: 'Fabio',
    commodity: 'luce',
    offerMatch: offerMatchNone,
    consentMarketing: false,
  });

  assert.match(text, /contatteremo/i);
  assert.ok(!text.includes('398'));
  assert.ok(!html.includes('Biennale'));
});

test('customer email with marketing consent mentions it', () => {
  const { html } = buildCustomerEmail({
    nome: 'Laura',
    commodity: 'luce',
    offerMatch: offerMatchNone,
    consentMarketing: true,
  });

  assert.match(html, /consenso/i);
});

test('customer email without marketing consent does NOT mention it', () => {
  const { html } = buildCustomerEmail({
    nome: 'Laura',
    commodity: 'luce',
    offerMatch: offerMatchNone,
    consentMarketing: false,
  });

  // The marketing note paragraph should not appear
  assert.ok(!html.includes('aggiornamenti sulle offerte HURKA'));
});

// ── buildInternalLeadEmail ───────────────────────────────────

test('internal email subject contains score class and total', () => {
  const fields = { nome: 'Sergio Giulino', telefono: '+393334445556', email: 's@example.it', comune: 'Fiuggi', commodityHint: 'luce', preferenza: 'risparmio', consentMarketing: true };
  const { subject } = buildInternalLeadEmail({ fields, file: null, analysis: baseAnalysis, leadScore, offerMatch: offerMatchPositive });

  assert.match(subject, /CALDO/i);
  assert.match(subject, /82/);
  assert.match(subject, /Sergio Giulino/);
});

test('internal email body shows offer match details when present', () => {
  const fields = { nome: 'Mario', telefono: '333', email: '', comune: 'Roma', commodityHint: 'luce', preferenza: 'risparmio', consentMarketing: false };
  const { text, html } = buildInternalLeadEmail({ fields, file: null, analysis: baseAnalysis, leadScore, offerMatch: offerMatchPositive });

  assert.match(text, /Biennale Luce Casa/);
  assert.match(text, /398/);
  assert.match(html, /Sinergas/);
  assert.match(text, /Score 82\/100/i);
});

test('internal email body shows no-match reason when no offer found', () => {
  const fields = { nome: 'Fabio', telefono: '333', email: '', comune: 'Pescara', commodityHint: 'luce', preferenza: 'risparmio', consentMarketing: false };
  const lowScore = { ...leadScore, total: 28, class: 'freddo' };
  const { text } = buildInternalLeadEmail({ fields, file: null, analysis: baseAnalysis, leadScore: lowScore, offerMatch: offerMatchNone });

  assert.match(text, /competitivo/i);
  assert.ok(!text.includes('Biennale'));
});

test('internal email correctly shows separated marketing consent', () => {
  const fieldsYes = { nome: 'Anna', telefono: '333', email: 'a@t.it', comune: 'Napoli', commodityHint: 'luce', preferenza: 'risparmio', consentMarketing: true };
  const fieldsNo = { ...fieldsYes, consentMarketing: false };

  const { text: textYes } = buildInternalLeadEmail({ fields: fieldsYes, file: null, analysis: baseAnalysis, leadScore, offerMatch: offerMatchNone });
  const { text: textNo } = buildInternalLeadEmail({ fields: fieldsNo, file: null, analysis: baseAnalysis, leadScore, offerMatch: offerMatchNone });

  assert.match(textYes, /Marketing.*SI/i);
  assert.match(textNo, /Marketing.*NO/i);
});
