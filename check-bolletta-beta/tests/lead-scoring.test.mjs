import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLeadScore, classifyScore } from '../lead-scoring.mjs';

function analysisWithSaving(annualSaving, annualSpend, commodity = 'luce', confidence = 0.9) {
  return {
    extraction: {
      commodity,
      estimated_annual_cost: annualSpend,
      extraction_confidence: confidence,
    },
    offerMatch: annualSaving > 0
      ? { hasMatch: true, topOffer: { savings: { annual: annualSaving } } }
      : { hasMatch: false, topOffer: null },
  };
}

test('classifyScore returns correct class for each band', () => {
  assert.equal(classifyScore(0), 'freddo');
  assert.equal(classifyScore(39), 'freddo');
  assert.equal(classifyScore(40), 'nurture');
  assert.equal(classifyScore(64), 'nurture');
  assert.equal(classifyScore(65), 'buono');
  assert.equal(classifyScore(79), 'buono');
  assert.equal(classifyScore(80), 'caldo');
  assert.equal(classifyScore(100), 'caldo');
});

test('high saving + high spend + dual + full intent = caldo', () => {
  const analysis = analysisWithSaving(350, 1800, 'dual', 0.93);
  const score = computeLeadScore(analysis, {
    phoneValid: true,
    emailProvided: true,
    answeredQuestions: true,
    consentMarketing: true,
    whatsappClicked: true,
    callbackRequested: false,
  });

  assert.equal(score.class, 'caldo');
  assert.ok(score.total >= 80, `expected >= 80, got ${score.total}`);
  assert.ok(score.scoreA <= 60, 'scoreA capped at 60');
  assert.ok(score.scoreB <= 40, 'scoreB capped at 40');
  assert.equal(score.total, score.scoreA + score.scoreB);
});

test('no saving + no phone + no email = freddo', () => {
  const analysis = analysisWithSaving(0, 200, 'luce', 0.8);
  const score = computeLeadScore(analysis, {
    phoneValid: false,
    emailProvided: false,
    answeredQuestions: false,
    consentMarketing: false,
    whatsappClicked: false,
    callbackRequested: false,
  });

  assert.equal(score.class, 'freddo');
  assert.ok(score.total < 40, `expected < 40, got ${score.total}`);
});

test('medium saving + phone + email = at least nurture', () => {
  const analysis = analysisWithSaving(120, 900, 'luce', 0.88);
  const score = computeLeadScore(analysis, {
    phoneValid: true,
    emailProvided: true,
    answeredQuestions: true,
    consentMarketing: false,
    whatsappClicked: false,
    callbackRequested: false,
  });

  assert.ok(score.total >= 40, `expected >= 40 (nurture), got ${score.total}`);
});

test('whatsapp click pushes score up', () => {
  const analysis = analysisWithSaving(80, 700, 'luce', 0.85);
  const withoutWa = computeLeadScore(analysis, { phoneValid: true });
  const withWa = computeLeadScore(analysis, { phoneValid: true, whatsappClicked: true });

  assert.ok(withWa.total > withoutWa.total, 'WhatsApp click should increase score');
  assert.equal(withWa.scoreB - withoutWa.scoreB, 7);
});

test('score A and B are always non-negative and within bounds', () => {
  const analysis = analysisWithSaving(0, 0, 'unknown', 0.1);
  const score = computeLeadScore(analysis, {});

  assert.ok(score.scoreA >= 0);
  assert.ok(score.scoreA <= 60);
  assert.ok(score.scoreB >= 0);
  assert.ok(score.scoreB <= 40);
  assert.ok(score.total >= 0);
  assert.ok(score.total <= 100);
});

test('breakdown contains both components with expected keys', () => {
  const analysis = analysisWithSaving(100, 900, 'luce', 0.9);
  const score = computeLeadScore(analysis, { phoneValid: true, emailProvided: true });

  assert.ok('opportunita' in score.breakdown);
  assert.ok('intento' in score.breakdown);
  assert.ok(typeof score.breakdown.opportunita.annualSaving === 'number');
  assert.ok(typeof score.breakdown.intento.phoneValid === 'boolean');
});
