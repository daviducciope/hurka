/**
 * Lead scoring system — 0-100, never shown to the user.
 *
 * Component A: Opportunita / Risparmio (0-60)
 * Component B: Intento / Calore (0-40)
 *
 * Classes: freddo 0-39 | nurture 40-64 | buono 65-79 | caldo 80-100
 */

/** @typedef {'freddo'|'nurture'|'buono'|'caldo'} LeadClass */

/**
 * @param {object} analysis - Full analysis result
 * @param {{
 *   phoneValid?: boolean,
 *   emailProvided?: boolean,
 *   answeredQuestions?: boolean,
 *   consentMarketing?: boolean,
 *   whatsappClicked?: boolean,
 *   callbackRequested?: boolean,
 * }} actions
 * @returns {{ total: number, scoreA: number, scoreB: number, class: LeadClass, breakdown: object }}
 */
export function computeLeadScore(analysis, actions = {}) {
  const scoreA = computeOpportunityScore(analysis);
  const scoreB = computeIntentScore(actions);
  const total = Math.min(100, scoreA + scoreB);

  return {
    total,
    scoreA,
    scoreB,
    class: classifyScore(total),
    breakdown: buildBreakdown(analysis, actions, scoreA, scoreB),
  };
}

function computeOpportunityScore(analysis) {
  let score = 0;
  const offerMatch = analysis?.offerMatch;
  const extraction = analysis?.extraction || {};
  const annualSaving = offerMatch?.topOffer?.savings?.annual ?? 0;
  const annualSpend = extraction.estimated_annual_cost || 0;
  const commodity = extraction.commodity || 'unknown';
  const confidence = extraction.extraction_confidence || 0;

  // Risparmio stimato con offerta HURKA
  if (annualSaving >= 300) score += 30;
  else if (annualSaving >= 200) score += 22;
  else if (annualSaving >= 100) score += 14;
  else if (annualSaving >= 30) score += 6;

  // Spesa annua (indica quanto fattura il cliente)
  if (annualSpend >= 1500) score += 18;
  else if (annualSpend >= 1000) score += 13;
  else if (annualSpend >= 600) score += 8;
  else if (annualSpend >= 300) score += 4;

  // Dual commodity
  if (commodity === 'dual') score += 10;

  // Qualita estrazione
  if (confidence >= 0.90) score += 2;

  return Math.min(60, score);
}

function computeIntentScore(actions) {
  let score = 0;

  // Upload completato e' baseline: se siamo qui, 10 punti
  score += 10;

  if (actions.phoneValid) score += 8;
  if (actions.emailProvided) score += 5;
  if (actions.answeredQuestions) score += 5;
  if (actions.consentMarketing) score += 5;
  if (actions.whatsappClicked) score += 7;
  if (actions.callbackRequested) score += 5;

  return Math.min(40, score);
}

/** @param {number} total @returns {LeadClass} */
export function classifyScore(total) {
  if (total >= 80) return 'caldo';
  if (total >= 65) return 'buono';
  if (total >= 40) return 'nurture';
  return 'freddo';
}

function buildBreakdown(analysis, actions, scoreA, scoreB) {
  const extraction = analysis?.extraction || {};
  const offerMatch = analysis?.offerMatch;
  return {
    opportunita: {
      score: scoreA,
      annualSaving: offerMatch?.topOffer?.savings?.annual ?? 0,
      estimatedAnnualSpend: extraction.estimated_annual_cost || 0,
      commodity: extraction.commodity || 'unknown',
      confidence: extraction.extraction_confidence || 0,
    },
    intento: {
      score: scoreB,
      phoneValid: Boolean(actions.phoneValid),
      emailProvided: Boolean(actions.emailProvided),
      answeredQuestions: Boolean(actions.answeredQuestions),
      consentMarketing: Boolean(actions.consentMarketing),
      whatsappClicked: Boolean(actions.whatsappClicked),
      callbackRequested: Boolean(actions.callbackRequested),
    },
  };
}
