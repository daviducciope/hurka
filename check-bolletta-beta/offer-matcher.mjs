import { getEligibleOffers, projectOfferCost, PUN_REFERENCE_MONO_EUR_KWH } from './offers-catalog.mjs';

const MIN_ANNUAL_SAVING_EUR = 30;   // below this threshold, don't recommend
const MIN_CONFIDENCE_FOR_MATCH = 0.60;

// Credibility guardrails — keep projected savings realistic.
const MIN_ANNUAL_KWH = 600;            // below this the annualization from a single bill is unreliable
const MIN_PLAUSIBLE_EUR_KWH = 0.05;    // implausibly low vendor energy rate
const MAX_PLAUSIBLE_EUR_KWH = 0.60;    // implausibly high (likely arrears/una-tantum inside spesa materia)
const MAX_FIXED_ANNUAL_EUR = 250;      // cap on annualized fixed quota to avoid inflating one-off charges
const MAX_CREDIBLE_SAVING_PERCENT = 50; // above this, ask for human verification instead of promising

// Anomaly guardrail — arrears/one-off charges (insoluti, solleciti, conguagli, una-tantum)
// make a single-bill saving estimate misleading: route to assisted review instead of promising.
const ANOMALY_ALTRE_PARTITE_RATIO = 0.30;   // altre partite above this share of the total bill
const ANOMALY_ALTRE_PARTITE_MIN_EUR = 60;   // absolute floor so small adjustments don't trigger
const ANOMALY_KEYWORD_REGEX = /insolut|sollecit|morosit|arretrat|distacc|messa in mora|rateizz|partite pregress|importi? pregress/i;

// Business detection: domestic offers must not be matched to business supplies.
const BUSINESS_ANNUAL_KWH = 10000;
const BUSINESS_NAME_REGEX = /(\bs\.?r\.?l\.?s?\b|\bs\.?p\.?a\.?\b|\bs\.?n\.?c\.?\b|\bs\.?a\.?s\.?\b|societa|ristorante|osteria|trattoria|pizzeria|\bbar\b|\bhotel\b|albergo|\bb&b\b|azienda|\bditta\b|impresa|officina|\bnegozio\b|stabilimento|capannone)/i;

/**
 * Derives billing period in days from ISO date strings.
 * Returns null if dates are invalid.
 */
function billingDays(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start) || isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
}

/**
 * Extracts the vendor-controlled cost (spesa materia) from the bill analysis.
 * Returns { amount, days, source }.
 */
function extractBillProfile(extraction) {
  const days = billingDays(extraction.billing_period_start, extraction.billing_period_end)
    || extraction.billing_period_days
    || 30;

  // spesa_materia_eur: new direct field from AI extraction
  let spesaMateria = 0;
  let source = 'estimated';

  if (extraction.spesa_materia_eur > 0) {
    spesaMateria = extraction.spesa_materia_eur;
    source = 'extracted';
  } else {
    const derived = (extraction.quota_consumi_eur || 0)
      + (extraction.quota_fissa_eur || 0)
      + (extraction.quota_potenza_eur || 0);
    if (derived > 0) {
      spesaMateria = derived;
      source = 'derived';
    } else if (extraction.total_amount_eur > 0) {
      // heuristic: ~52% of total bill is vendor-controlled for luce, ~48% for gas
      const pct = extraction.commodity === 'gas' ? 0.48 : 0.52;
      spesaMateria = extraction.total_amount_eur * pct;
      source = 'estimated';
    }
  }

  // Separate the recurring fixed quota from the variable energy inside spesa materia.
  // Annualizing the whole spesa materia inflates savings when it embeds one-off charges.
  let fixedComponent = Math.max(0, (extraction.quota_fissa_eur || 0) + (extraction.quota_potenza_eur || 0));
  let energyComponent = spesaMateria - fixedComponent;
  if (energyComponent < 0) {
    // Inconsistent extraction (fixed > materia): treat everything as energy, no separate fixed.
    energyComponent = spesaMateria;
    fixedComponent = 0;
  }

  const consumption = extraction.consumption_total || 0;
  return { spesaMateria, energyComponent, fixedComponent, consumption, days, source };
}

/**
 * Detects whether the supply is a business profile, which must not be matched
 * to HURKA domestic offers.
 */
function detectBusiness(extraction, annualKwh) {
  const name = String(extraction.customer_name || '');
  if (BUSINESS_NAME_REGEX.test(name)) return true;
  if (annualKwh >= BUSINESS_ANNUAL_KWH) return true;
  return false;
}

/**
 * Detects arrears/one-off anomalies (insoluti, solleciti, conguagli, una-tantum) that make an
 * automated saving estimate from a single bill unreliable. Returns a reason string or null.
 */
function detectBillAnomaly(extraction, explanation) {
  const total = extraction.total_amount_eur || 0;
  const altrePartite = extraction.altre_partite_eur || 0;
  if (altrePartite >= ANOMALY_ALTRE_PARTITE_MIN_EUR
    && total > 0
    && (altrePartite / total) > ANOMALY_ALTRE_PARTITE_RATIO) {
    return `La bolletta contiene "altre partite" rilevanti (${Math.round(altrePartite)}€ su ${Math.round(total)}€ totali): probabili conguagli, insoluti o una-tantum che falserebbero una stima di risparmio automatica.`;
  }

  const text = [
    explanation.summary,
    explanation.detailed_explanation,
    ...(Array.isArray(explanation.possible_issues) ? explanation.possible_issues : []),
    ...(Array.isArray(explanation.critical_points) ? explanation.critical_points : []),
  ].filter(Boolean).join(' ');
  if (ANOMALY_KEYWORD_REGEX.test(text)) {
    return 'La bolletta segnala insoluti, solleciti o importi arretrati: serve una verifica assistita prima di stimare un risparmio.';
  }

  return null;
}

/**
 * Builds a match result for a single offer.
 */
function buildMatchResult(offer, annualSpesaMateria, annualKwh, profile) {
  const { annual: hurkaAnnual, perKwhEffective, priceBasis } = projectOfferCost(offer, annualKwh);
  const annualSaving = annualSpesaMateria - hurkaAnnual;
  const savingPercent = annualSpesaMateria > 0
    ? Math.round((annualSaving / annualSpesaMateria) * 100)
    : 0;

  return {
    offer,
    hurkaAnnualCost: Math.round(hurkaAnnual * 100) / 100,
    currentAnnualVendorCost: Math.round(annualSpesaMateria * 100) / 100,
    annualSaving: Math.round(annualSaving * 100) / 100,
    monthlySaving: Math.round((annualSaving / 12) * 100) / 100,
    savingPercent,
    perKwhEffective: Math.round(perKwhEffective * 100000) / 100000,
    priceBasis,
    calculationBasis: {
      annualConsumptionKwh: Math.round(annualKwh),
      annualSpesaMateria: Math.round(annualSpesaMateria * 100) / 100,
      billingDays: profile.days,
      spesaMateriaSource: profile.source,
      punReferenceUsed: priceBasis === 'pun_reference' ? PUN_REFERENCE_MONO_EUR_KWH : null,
    },
  };
}

/**
 * Main matching function.
 *
 * @param {object} analysis - Full analysis result from createAnalysisResult()
 * @param {{ preferenceType?: 'risparmio'|'stabilita', commodityOverride?: string }} options
 * @returns {{
 *   hasMatch: boolean,
 *   topOffer: object|null,
 *   alternativeOffer: object|null,
 *   noMatchReason: string|null,
 *   noMatchType: string|null,
 *   calculatedAt: string,
 * }}
 */
export function rankHurkaOffersForBill(analysis, options = {}) {
  const extraction = analysis?.extraction || {};
  const explanation = analysis?.explanation || {};
  const confidence = extraction.extraction_confidence || 0;
  const commodity = options.commodityOverride || extraction.commodity || 'luce';
  const preferenceType = options.preferenceType || 'risparmio';

  if (commodity === 'gas' || commodity === 'unknown') {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: commodity === 'gas'
        ? 'Le offerte HURKA attuali coprono solo la luce. Per il gas ti ricontatteremo separatamente.'
        : 'Commodity non identificata dalla bolletta — non e possibile fare un confronto affidabile.',
      noMatchType: commodity === 'gas' ? 'gas' : 'unknown-commodity',
      calculatedAt: new Date().toISOString(),
    };
  }

  if (confidence < MIN_CONFIDENCE_FOR_MATCH) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: `Confidenza di estrazione troppo bassa (${Math.round(confidence * 100)}%) per un confronto affidabile. Verifica assistita consigliata.`,
      noMatchType: 'low-confidence',
      calculatedAt: new Date().toISOString(),
    };
  }

  const profile = extractBillProfile(extraction);
  if (profile.consumption <= 0 || profile.spesaMateria <= 0) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: 'Dati insufficienti estratti dalla bolletta (consumo o spesa materia non leggibili).',
      noMatchType: 'insufficient-data',
      calculatedAt: new Date().toISOString(),
    };
  }

  // Guardrail: arrears/one-off anomalies (insoluti, solleciti, conguagli) → assisted review, not a promise.
  const anomalyReason = detectBillAnomaly(extraction, explanation);
  if (anomalyReason) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: anomalyReason,
      noMatchType: 'manual_check',
      calculatedAt: new Date().toISOString(),
    };
  }

  // Annualize: energy follows consumption; fixed quota is capped to avoid inflating one-off charges.
  const annualKwh = (profile.consumption / profile.days) * 365;
  const annualEnergy = (profile.energyComponent / profile.days) * 365;
  const annualFixed = Math.min((profile.fixedComponent / profile.days) * 365, MAX_FIXED_ANNUAL_EUR);
  const annualSpesaMateria = annualEnergy + annualFixed;

  // Guardrail: business supplies must not be matched to domestic offers.
  if (detectBusiness(extraction, annualKwh)) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: 'La fornitura risulta di tipo business (consumo elevato o ragione sociale). Le offerte domestiche HURKA non sono adatte: un consulente business ti propone condizioni dedicate.',
      noMatchType: 'business',
      calculatedAt: new Date().toISOString(),
    };
  }

  // Guardrail: too little consumption to annualize a single bill reliably.
  if (annualKwh < MIN_ANNUAL_KWH) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: `Consumo annuo stimato troppo basso (${Math.round(annualKwh)} kWh) per un confronto affidabile da una sola bolletta. Meglio una verifica assistita su piu periodi.`,
      noMatchType: 'low-consumption',
      calculatedAt: new Date().toISOString(),
    };
  }

  // Guardrail: implausible effective €/kWh (often arrears/una-tantum inside spesa materia).
  const effectiveVendorPerKwh = annualKwh > 0 ? annualEnergy / annualKwh : 0;
  if (effectiveVendorPerKwh < MIN_PLAUSIBLE_EUR_KWH || effectiveVendorPerKwh > MAX_PLAUSIBLE_EUR_KWH) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: `La spesa materia letta (${effectiveVendorPerKwh.toFixed(3)} €/kWh) sembra includere voci una-tantum o conguagli: serve una verifica assistita prima di stimare un risparmio.`,
      noMatchType: 'implausible-rate',
      calculatedAt: new Date().toISOString(),
    };
  }

  const eligibleOffers = getEligibleOffers({
    commodity,
    annualConsumptionKwh: annualKwh,
    preferenceType,
    segment: 'domestico',
  });

  const sortFn = preferenceType === 'stabilita'
    ? (a, b) => {
        const aFixed = a.offer.priceType.startsWith('fixed') ? 0 : 1;
        const bFixed = b.offer.priceType.startsWith('fixed') ? 0 : 1;
        if (aFixed !== bFixed) return aFixed - bFixed;
        return b.annualSaving - a.annualSaving;
      }
    : (a, b) => b.annualSaving - a.annualSaving;

  const results = eligibleOffers
    .map((offer) => buildMatchResult(offer, annualSpesaMateria, annualKwh, profile))
    .filter((r) => r.annualSaving >= MIN_ANNUAL_SAVING_EUR)
    .sort(sortFn);

  if (results.length === 0) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: 'Il profilo attuale non mostra un risparmio credibile con le offerte HURKA disponibili. Potremmo comunque verificare clausole o potenza contrattuale.',
      noMatchType: 'limited',
      calculatedAt: new Date().toISOString(),
    };
  }

  // Guardrail: a saving that is too high to be true needs human verification, not a promise.
  const topResult = results[0];
  if (topResult.savingPercent > MAX_CREDIBLE_SAVING_PERCENT) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: `Il risparmio stimato (${topResult.savingPercent}%) e troppo alto per essere confermato in automatico: probabile anomalia nei dati. Ti proponiamo una verifica assistita.`,
      noMatchType: 'too-good',
      calculatedAt: new Date().toISOString(),
    };
  }

  const topOffer = formatMatchOutput(topResult);
  const alternativeOffer = results[1] ? formatMatchOutput(results[1]) : null;

  return {
    hasMatch: true,
    topOffer,
    alternativeOffer,
    noMatchReason: null,
    noMatchType: null,
    calculatedAt: new Date().toISOString(),
  };
}

function formatMatchOutput(result) {
  return {
    id: result.offer.id,
    name: result.offer.name,
    provider: result.offer.provider,
    offerCode: result.offer.offerCode,
    priceType: result.offer.priceType,
    greenEnergy: result.offer.greenEnergy,
    quotaFissaAnnua: result.offer.quotaFissaAnnua,
    caveats: result.offer.caveats,
    savings: {
      annual: result.annualSaving,
      monthly: result.monthlySaving,
      percent: result.savingPercent,
      currentAnnualVendorCost: result.currentAnnualVendorCost,
      hurkaAnnualCost: result.hurkaAnnualCost,
    },
    calculationBasis: result.calculationBasis,
    priceBasis: result.priceBasis,
    perKwhEffective: result.perKwhEffective,
  };
}
