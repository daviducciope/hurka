// Catalog of HURKA offers, extracted from CTE PDFs in docs/ on 2026-04-23.
// Values are deterministic: update this file when new CTE PDFs arrive.
// PUN reference price used for projected cost of indexed offers.
export const PUN_REFERENCE_MONO_EUR_KWH = 0.135;   // prudent mono reference (below max 0.1434 March 2026)
export const PUN_REFERENCE_F1_EUR_KWH = 0.140;      // peak hours reference
export const PUN_REFERENCE_F23_EUR_KWH = 0.132;     // off-peak reference

/**
 * @typedef {Object} HurkaOffer
 * @property {string} id
 * @property {string} provider
 * @property {string} name
 * @property {string|null} offerCode
 * @property {'luce'|'gas'} commodity
 * @property {'libero'} marketType
 * @property {'fixed'|'indexed'|'fixed_then_indexed'} priceType
 * @property {string} targetSegment
 * @property {number|null} maxConsumptionKwh  - null means no limit
 * @property {boolean} requiresFascePricing
 * @property {string} validFrom
 * @property {string} validTo
 * @property {number} conditionsDurationMonths
 * @property {boolean} autorinnovo
 * @property {number} quotaFissaAnnua  - €/POD/anno, net of IVA
 * @property {{type:string, eurPerKwh:number}|null} priceFixed
 * @property {{type:string, spread:number, spreadF1?:number, spreadF23?:number, baseIndex:string}|null} priceIndexed
 * @property {boolean} greenEnergy
 * @property {string[]} caveats
 * @property {string} sourceFile
 * @property {string} extractedAt
 * @property {number} extractionConfidence  - 0-1
 */

/** @type {HurkaOffer[]} */
export const HURKA_OFFERS = [
  {
    id: 'sinergas-biennale-luce-casa',
    provider: 'Sinergas S.p.A.',
    name: 'Biennale Luce Casa',
    offerCode: '000753ESFML04XXP0094PB3181260416',
    commodity: 'luce',
    marketType: 'libero',
    priceType: 'fixed_then_indexed',
    targetSegment: 'domestico',
    maxConsumptionKwh: null,
    requiresFascePricing: true,
    validFrom: '2026-04-16',
    validTo: '2026-05-21',
    conditionsDurationMonths: 24,
    autorinnovo: true,
    quotaFissaAnnua: 144.00,
    priceFixed: {
      type: 'mono',
      eurPerKwh: 0.1649,
    },
    priceIndexed: {
      type: 'mono_pun_plus_spread',
      spread: 0.0318,
      baseIndex: 'PUN_GME_monorario',
    },
    greenEnergy: true,
    caveats: [
      'Fisso per 24 mesi poi diventa PUN monorario + 0,0318 €/kWh',
      'Richiede contatore 2G; in assenza si applica profilo PRA fino al 31/12/2026',
    ],
    sourceFile: 'SINERGASSpA_PlicoEE_BIENNALE LUCE CASA.pdf',
    extractedAt: '2026-04-23',
    extractionConfidence: 0.97,
  },
  {
    id: 'sinergas-energia-piu-vicina-bio',
    provider: 'Sinergas S.p.A.',
    name: 'Energia Più Vicina Luce - BIO',
    offerCode: '000753ESVFL04XXP0095PB3176260416',
    commodity: 'luce',
    marketType: 'libero',
    priceType: 'indexed',
    targetSegment: 'domestico',
    maxConsumptionKwh: null,
    requiresFascePricing: true,
    validFrom: '2026-04-16',
    validTo: '2026-05-21',
    conditionsDurationMonths: 12,
    autorinnovo: true,
    quotaFissaAnnua: 144.00,
    priceFixed: null,
    priceIndexed: {
      type: 'biorario_pun_plus_spread',
      spread: 0.01419,
      spreadF1: 0.01419,
      spreadF23: 0.01419,
      baseIndex: 'PUN_GME_fasce',
    },
    greenEnergy: true,
    caveats: [
      'Prezzo variabile: segue il PUN ogni mese',
      'Richiede contatore 2G; in assenza si applica profilo PRA fino al 31/12/2026',
    ],
    sourceFile: "SINERGASSpA_PlicoEE_ENERGIA PIU' VICINA LUCE - BIO.pdf",
    extractedAt: '2026-04-23',
    extractionConfidence: 0.97,
  },
  {
    id: 'ee-fix-family-rap',
    provider: 'EE (partner HURKA)',
    name: 'Fix Family RAP',
    offerCode: '003450ESFOL01XX00000010072520326',
    commodity: 'luce',
    marketType: 'libero',
    priceType: 'fixed_then_indexed',
    targetSegment: 'domestico',
    maxConsumptionKwh: null,
    requiresFascePricing: false,
    validFrom: '2026-03-26',
    validTo: '2026-04-30',
    conditionsDurationMonths: 12,
    autorinnovo: true,
    quotaFissaAnnua: 157.23,
    priceFixed: {
      type: 'mono',
      eurPerKwh: 0.20262,
    },
    priceIndexed: {
      type: 'orario_pun_plus_spread',
      spread: 0.033,
      baseIndex: 'PUN_GME_orario',
    },
    greenEnergy: false,
    caveats: [
      'Fisso solo per i primi 12 mesi; dal 13° diventa PUN orario + 0,033 €/kWh',
      'CTE scaduta il 30/04/2026 — verificare disponibilita rinnovo',
    ],
    sourceFile: 'EE_FIX_FAMILY_RAP.pdf',
    extractedAt: '2026-04-23',
    extractionConfidence: 0.96,
  },
  {
    id: 'ee-flex-family-sempre-zero',
    provider: 'EE (partner HURKA)',
    name: 'Flex Family Sempre Zero S',
    offerCode: null,
    commodity: 'luce',
    marketType: 'libero',
    priceType: 'indexed',
    targetSegment: 'domestico',
    maxConsumptionKwh: 5000,
    requiresFascePricing: false,
    validFrom: '2026-04-01',
    validTo: '2026-04-30',
    conditionsDurationMonths: 12,
    autorinnovo: true,
    quotaFissaAnnua: 145.23,
    priceFixed: null,
    priceIndexed: {
      type: 'orario_pun_plus_spread',
      spread: 0.00000,
      baseIndex: 'PUN_GME_orario',
    },
    greenEnergy: false,
    caveats: [
      'Solo per consumi domestici fino a 5.000 kWh/anno',
      'Spread zero: il prezzo segue il PUN puro senza margine energia',
      'CTE scaduta il 30/04/2026 — verificare disponibilita rinnovo',
    ],
    sourceFile: 'EE_FLEX_FAMILY_SEMPRE_ZERO_S.pdf',
    extractedAt: '2026-04-23',
    extractionConfidence: 0.95,
  },
];

/**
 * Returns offers compatible with the given bill profile.
 * @param {{ commodity?: string, annualConsumptionKwh?: number, preferenceType?: 'risparmio'|'stabilita' }} filters
 * @returns {HurkaOffer[]}
 */
export function getEligibleOffers(filters = {}) {
  const commodity = filters.commodity || 'luce';
  const consumption = filters.annualConsumptionKwh || 0;

  let offers = HURKA_OFFERS.filter((o) => {
    if (o.commodity !== commodity && commodity !== 'dual') return false;
    if (o.maxConsumptionKwh !== null && consumption > o.maxConsumptionKwh) return false;
    return true;
  });

  if (filters.preferenceType === 'stabilita') {
    // sort: fixed offers first, then by quota fissa asc
    offers = [...offers].sort((a, b) => {
      const aFixed = a.priceType.startsWith('fixed') ? 0 : 1;
      const bFixed = b.priceType.startsWith('fixed') ? 0 : 1;
      if (aFixed !== bFixed) return aFixed - bFixed;
      return a.quotaFissaAnnua - b.quotaFissaAnnua;
    });
  }

  return offers;
}

/**
 * Projected annual vendor cost for a given offer at a given consumption.
 * For indexed offers uses the PUN reference constants defined above.
 * @param {HurkaOffer} offer
 * @param {number} annualKwh
 * @returns {{ annual: number, perKwhEffective: number, priceBasis: 'fixed'|'pun_reference' }}
 */
export function projectOfferCost(offer, annualKwh) {
  const qf = offer.quotaFissaAnnua;

  if (offer.priceType === 'fixed' || offer.priceType === 'fixed_then_indexed') {
    // Use the fixed price for the initial period (most relevant for near-term comparison)
    const fixed = offer.priceFixed;
    if (!fixed) return projectIndexedCost(offer, annualKwh, qf);
    const energyCost = annualKwh * fixed.eurPerKwh;
    return {
      annual: qf + energyCost,
      perKwhEffective: fixed.eurPerKwh,
      priceBasis: 'fixed',
    };
  }

  return projectIndexedCost(offer, annualKwh, qf);
}

function projectIndexedCost(offer, annualKwh, qf) {
  const idx = offer.priceIndexed;
  if (!idx) return { annual: qf, perKwhEffective: 0, priceBasis: 'pun_reference' };

  let effectiveSpread = idx.spread ?? 0;
  let punRef = PUN_REFERENCE_MONO_EUR_KWH;

  if (idx.type === 'biorario_pun_plus_spread') {
    punRef = (PUN_REFERENCE_F1_EUR_KWH + PUN_REFERENCE_F23_EUR_KWH) / 2;
    effectiveSpread = idx.spread ?? 0;
  }

  const pricePerKwh = punRef + effectiveSpread;
  return {
    annual: qf + annualKwh * pricePerKwh,
    perKwhEffective: pricePerKwh,
    priceBasis: 'pun_reference',
  };
}
