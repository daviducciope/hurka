import { getEligibleOffers, projectOfferCost, PUN_REFERENCE_MONO_EUR_KWH } from './offers-catalog.mjs';

const MIN_ANNUAL_SAVING_EUR = 30;   // below this threshold, don't recommend
const MIN_CONFIDENCE_FOR_MATCH = 0.60;

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

  const consumption = extraction.consumption_total || 0;
  return { spesaMateria, consumption, days, source };
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
 *   calculatedAt: string,
 * }}
 */
export function rankHurkaOffersForBill(analysis, options = {}) {
  const extraction = analysis?.extraction || {};
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
      calculatedAt: new Date().toISOString(),
    };
  }

  if (confidence < MIN_CONFIDENCE_FOR_MATCH) {
    return {
      hasMatch: false,
      topOffer: null,
      alternativeOffer: null,
      noMatchReason: `Confidenza di estrazione troppo bassa (${Math.round(confidence * 100)}%) per un confronto affidabile. Verifica assistita consigliata.`,
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
      calculatedAt: new Date().toISOString(),
    };
  }

  // Annualize
  const annualKwh = (profile.consumption / profile.days) * 365;
  const annualSpesaMateria = (profile.spesaMateria / profile.days) * 365;

  const eligibleOffers = getEligibleOffers({
    commodity,
    annualConsumptionKwh: annualKwh,
    preferenceType,
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
      calculatedAt: new Date().toISOString(),
    };
  }

  const topOffer = formatMatchOutput(results[0]);
  const alternativeOffer = results[1] ? formatMatchOutput(results[1]) : null;

  return {
    hasMatch: true,
    topOffer,
    alternativeOffer,
    noMatchReason: null,
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
