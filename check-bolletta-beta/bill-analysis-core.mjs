export const SUPPORTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const XAI_MODEL = 'grok-4.20-reasoning';
export const XAI_FILE_PURPOSE = 'assistants';
export const XAI_TIMEOUT_MS = 180_000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMMODITY_VALUES = new Set(['luce', 'gas', 'dual', 'unknown']);
const MARKET_TYPE_VALUES = new Set(['libero', 'tutela', 'altro', 'unknown']);
const CONSUMPTION_UNIT_VALUES = new Set(['kWh', 'Smc', 'unknown']);

export const BILL_ANALYSIS_SYSTEM_PROMPT = [
  'Sei un analista specializzato in bollette italiane luce e gas.',
  "Hai in input un documento reale allegato dall'utente.",
  'Devi restituire esclusivamente un JSON conforme allo schema richiesto dal chiamante.',
  'Regole:',
  '- non inventare mai dati mancanti',
  '- se un dato non e leggibile o assente, usa null, "unknown", 0 o [] in modo coerente',
  '- usa italiano semplice nei campi testuali',
  '- spiega la spesa in modo chiaro e commerciale, ma prudente',
  '- non promettere mai "miglior fornitore assoluto"',
  '- se la leggibilita e bassa, abbassa extraction_confidence e suggerisci verifica assistita',
  '- nessun testo fuori dal JSON',
].join('\n');

export const BILL_ANALYSIS_USER_PROMPT = [
  'Analizza la bolletta italiana allegata.',
  '',
  'Obiettivo:',
  '1. estrarre i dati strutturati principali',
  '2. spiegare in modo semplice perche l utente paga questo importo',
  '3. evidenziare le voci che incidono di piu',
  '4. indicare eventuali criticita dell offerta o della struttura di spesa',
  '5. per estimated_savings_range usa 0/0 se il confronto di mercato non e determinabile con certezza — non inventare',
  '6. suggerire la CTA finale piu affidabile',
  '',
  'Campo critico: spesa_materia_eur',
  'Deve contenere ESATTAMENTE la voce "Spesa per la materia energia" (o equivalente: "Consumo fatturato", "Spesa energia") della bolletta.',
  'E la parte controllata dal fornitore — esclude trasporto, oneri di sistema, imposte e IVA.',
  'Se non e leggibile come singola voce, sommala da quota_consumi_eur + quota_fissa_eur + quota_potenza_eur.',
  'Non inventarla: usa 0 se non presente.',
  '',
  'Restituisci solo JSON valido e rigoroso.',
  'Se il documento e incompleto o poco leggibile, dichiaralo chiaramente nel campo confidence_note.',
].join('\n');

export const BILL_ANALYSIS_JSON_SCHEMA = {
  name: 'bill_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'commodity',
      'provider_name',
      'customer_name',
      'supply_address',
      'pod_or_pdr',
      'offer_code',
      'market_type',
      'billing_period_start',
      'billing_period_end',
      'invoice_date',
      'due_date',
      'total_amount_eur',
      'consumption_total',
      'consumption_unit',
      'fascia_f1',
      'fascia_f2',
      'fascia_f3',
      'spesa_materia_eur',
      'quota_consumi_eur',
      'quota_fissa_eur',
      'quota_potenza_eur',
      'trasporto_e_oneri_eur',
      'imposte_iva_eur',
      'altre_partite_eur',
      'price_formula_text',
      'estimated_monthly_cost',
      'estimated_annual_cost',
      'extraction_confidence',
      'summary',
      'main_cost_drivers',
      'possible_issues',
      'estimated_savings_range',
      'confidence_note',
      'cta_recommendation',
    ],
    properties: {
      commodity: { type: 'string', enum: ['luce', 'gas', 'dual', 'unknown'] },
      provider_name: { type: 'string' },
      customer_name: { type: 'string' },
      supply_address: { type: 'string' },
      pod_or_pdr: { type: 'string' },
      offer_code: { type: 'string' },
      market_type: { type: 'string', enum: ['libero', 'tutela', 'altro', 'unknown'] },
      billing_period_start: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      billing_period_end: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      invoice_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      due_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      total_amount_eur: { type: 'number' },
      consumption_total: { type: 'number' },
      consumption_unit: { type: 'string', enum: ['kWh', 'Smc', 'unknown'] },
      fascia_f1: { type: 'number' },
      fascia_f2: { type: 'number' },
      fascia_f3: { type: 'number' },
      spesa_materia_eur: { type: 'number' },
      quota_consumi_eur: { type: 'number' },
      quota_fissa_eur: { type: 'number' },
      quota_potenza_eur: { type: 'number' },
      trasporto_e_oneri_eur: { type: 'number' },
      imposte_iva_eur: { type: 'number' },
      altre_partite_eur: { type: 'number' },
      price_formula_text: { type: 'string' },
      estimated_monthly_cost: { type: 'number' },
      estimated_annual_cost: { type: 'number' },
      extraction_confidence: { type: 'number' },
      summary: { type: 'string' },
      main_cost_drivers: {
        type: 'array',
        items: { type: 'string' },
      },
      possible_issues: {
        type: 'array',
        items: { type: 'string' },
      },
      estimated_savings_range: {
        type: 'object',
        additionalProperties: false,
        required: ['min', 'max'],
        properties: {
          min: { type: 'number' },
          max: { type: 'number' },
        },
      },
      confidence_note: { type: 'string' },
      cta_recommendation: { type: 'string' },
    },
  },
};

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function round(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function sanitizeText(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function sanitizeDate(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return DATE_PATTERN.test(normalized) ? normalized : null;
}

function sanitizeEnum(value, allowedValues, fallback) {
  const normalized = String(value || '').trim();
  return allowedValues.has(normalized) ? normalized : fallback;
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeText(item))
    .filter(Boolean)
    .slice(0, 6);
}

function clampConfidence(value) {
  const normalized = toNumber(value, 0);
  if (normalized <= 0) return 0;
  if (normalized > 1 && normalized <= 100) {
    return Math.round(normalized) / 100;
  }
  if (normalized > 100) return 1;
  if (normalized === 1) return 1;
  return Math.round(normalized * 100) / 100;
}

export function parseBooleanField(value) {
  return ['1', 'true', 'on', 'yes', 'si'].includes(String(value || '').trim().toLowerCase());
}

export function normalizeUploadFields(fields = {}) {
  const preferenza = sanitizeText(fields.preferenza).toLowerCase();
  return {
    nome: sanitizeText(fields.nome),
    telefono: sanitizeText(fields.telefono),
    email: sanitizeText(fields.email),
    comune: sanitizeText(fields.comune),
    commodityHint: sanitizeText(fields.commodityHint).toLowerCase(),
    preferenza: ['risparmio', 'stabilita'].includes(preferenza) ? preferenza : 'risparmio',
    consentAnalysis: parseBooleanField(fields.consentAnalysis),
    consentMarketing: parseBooleanField(fields.consentMarketing),
  };
}

export function validateUploadInput({ fields = {}, file = null } = {}) {
  const normalized = normalizeUploadFields(fields);
  const errors = [];

  if (!file) errors.push('Carica una bolletta in PDF, JPG o PNG.');
  if (!normalized.nome) errors.push('Inserisci il nome e cognome.');
  if (!normalized.telefono) errors.push('Inserisci un telefono per la verifica.');
  if (!normalized.comune) errors.push('Inserisci il comune della fornitura.');
  if (!normalized.consentAnalysis) errors.push('Serve il consenso per analizzare la bolletta.');

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.push('Email non valida.');
  }

  if (file) {
    if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
      errors.push('Formato non supportato. Usa PDF, JPG o PNG.');
    }
    if (toNumber(file.size, 0) > MAX_FILE_SIZE_BYTES) {
      errors.push('La bolletta supera il limite di 10 MB.');
    }
  }

  return {
    fields: normalized,
    errors,
    isValid: errors.length === 0,
  };
}

function detectCommodity(commodityHint, fileName) {
  const haystack = `${commodityHint} ${fileName}`.toLowerCase();
  if (haystack.includes('dual')) return 'dual';
  if (haystack.includes('gas')) return 'gas';
  return 'luce';
}

function detectScenario(fileName, comune) {
  const haystack = `${fileName} ${comune}`.toLowerCase();
  if (/(scan|sfoc|blurry|lowconf|illegible)/.test(haystack)) return 'low-confidence';
  if (/(dual|condominio|business|alto|caro|expensive|premium)/.test(haystack)) return 'high-savings';
  if (/(equa|ok|buona|stabile|fair)/.test(haystack)) return 'low-savings';
  return 'mid-savings';
}

function buildScenarioValues(scenario, commodity) {
  if (scenario === 'low-confidence') {
    return {
      confidence: 0.62,
      totalAmount: commodity === 'gas' ? 171.4 : 184.2,
      monthlyCost: commodity === 'gas' ? 57.13 : 61.4,
      annualCost: commodity === 'gas' ? 685.56 : 736.8,
      savingsMin: 0,
      savingsMax: 70,
      cta: 'Ti consigliamo una verifica assistita con un consulente HURKA.',
      headline: 'Abbiamo letto solo parte dei dati disponibili.',
      note: 'La scansione non sembra completa o sufficientemente leggibile per un confronto pieno.',
    };
  }

  if (scenario === 'high-savings') {
    return {
      confidence: 0.93,
      totalAmount: commodity === 'dual' ? 248.9 : 196.8,
      monthlyCost: commodity === 'dual' ? 124.45 : 65.6,
      annualCost: commodity === 'dual' ? 1493.4 : 787.2,
      savingsMin: commodity === 'dual' ? 190 : 160,
      savingsMax: commodity === 'dual' ? 340 : 240,
      cta: 'Richiedi la verifica gratuita: il profilo sembra interessante.',
      headline: 'Il prezzo della materia energia sembra poco competitivo.',
      note: 'La combinazione tra quota energia e costi fissi pesa piu del previsto per un profilo simile.',
    };
  }

  if (scenario === 'low-savings') {
    return {
      confidence: 0.89,
      totalAmount: commodity === 'gas' ? 132.4 : 146.7,
      monthlyCost: commodity === 'gas' ? 44.13 : 48.9,
      annualCost: commodity === 'gas' ? 529.56 : 586.8,
      savingsMin: 20,
      savingsMax: 55,
      cta: 'Possiamo comunque verificare contratto e potenza senza impegno.',
      headline: 'La tua offerta non sembra particolarmente penalizzante.',
      note: 'I margini di risparmio sono contenuti, ma vale la pena verificare i dettagli contrattuali.',
    };
  }

  return {
    confidence: 0.86,
    totalAmount: commodity === 'gas' ? 153.6 : 184.2,
    monthlyCost: commodity === 'gas' ? 51.2 : 61.4,
    annualCost: commodity === 'gas' ? 614.4 : 736.8,
    savingsMin: 80,
    savingsMax: 170,
    cta: 'Puoi richiedere un check gratuito per confermare il margine di risparmio.',
    headline: 'Emergono margini di miglioramento senza segnali critici.',
    note: 'La struttura di spesa e leggibile e lascia spazio a una verifica commerciale.',
  };
}

export function createMockAnalysis({ fileName = 'bolletta.pdf', fileSize = 0, fields = {} } = {}) {
  const normalized = normalizeUploadFields(fields);
  const commodity = detectCommodity(normalized.commodityHint, fileName);
  const scenario = detectScenario(fileName, normalized.comune);
  const values = buildScenarioValues(scenario, commodity);
  const quotaFissa = commodity === 'dual' ? 28.5 : 16.8;
  const quotaPotenza = commodity === 'luce' ? 11.4 : 0;
  const quotaConsumi = Math.max(values.totalAmount * 0.42, 48);
  const trasportoOneri = Math.max(values.totalAmount * 0.21, 22);
  const imposte = Math.max(values.totalAmount * 0.11, 12);
  const altrePartite = Math.max(values.totalAmount - quotaConsumi - quotaFissa - quotaPotenza - trasportoOneri - imposte, 0);

  return createAnalysisResult({
    rawAnalysis: {
      commodity,
      provider_name: 'Fornitore rilevato in fallback',
      customer_name: normalized.nome || 'Cliente HURKA',
      supply_address: normalized.comune ? `${normalized.comune}, Italia` : 'Comune non indicato',
      pod_or_pdr: commodity === 'gas' ? 'PDR-MOCK-7821' : 'POD-MOCK-4821',
      offer_code: scenario === 'high-savings' ? 'OFFERTA-ALTO-COSTO' : 'OFFERTA-BETA-STABILE',
      market_type: 'libero',
      billing_period_start: '2026-03-01',
      billing_period_end: '2026-03-31',
      invoice_date: '2026-04-05',
      due_date: '2026-04-25',
      total_amount_eur: round(values.totalAmount),
      consumption_total: commodity === 'gas' ? 134 : commodity === 'dual' ? 412 : 286,
      consumption_unit: commodity === 'gas' ? 'Smc' : 'kWh',
      fascia_f1: commodity === 'gas' ? 0 : 112,
      fascia_f2: commodity === 'gas' ? 0 : 84,
      fascia_f3: commodity === 'gas' ? 0 : 90,
      spesa_materia_eur: round(quotaConsumi + quotaFissa + quotaPotenza),
      quota_consumi_eur: round(quotaConsumi),
      quota_fissa_eur: round(quotaFissa),
      quota_potenza_eur: round(quotaPotenza),
      trasporto_e_oneri_eur: round(trasportoOneri),
      imposte_iva_eur: round(imposte),
      altre_partite_eur: round(altrePartite),
      price_formula_text: scenario === 'high-savings'
        ? 'Prezzo indicizzato con componente energia elevata nel periodo'
        : 'Prezzo coerente con il profilo rilevato',
      estimated_monthly_cost: round(values.monthlyCost),
      estimated_annual_cost: round(values.annualCost),
      extraction_confidence: values.confidence,
      summary: values.headline,
      main_cost_drivers: [
        'Quota energia / consumi',
        'Quota fissa',
        'Trasporto e oneri',
      ],
      possible_issues: [
        ...(scenario === 'high-savings' ? ['Prezzo materia energia sopra media per il profilo stimato'] : []),
        ...(scenario === 'low-confidence' ? ['Documento parziale o poco leggibile'] : []),
        ...(values.totalAmount > 200 ? ['Spesa totale elevata rispetto al benchmark beta'] : []),
      ],
      estimated_savings_range: {
        min: values.savingsMin,
        max: values.savingsMax,
      },
      confidence_note: values.confidence < 0.75
        ? 'Abbiamo letto solo parte dei dati. Meglio una verifica assistita.'
        : `Confidenza estrazione ${Math.round(values.confidence * 100)}%.`,
      cta_recommendation: values.cta,
    },
    meta: {
      fileName,
      fileSize,
      mode: 'mock',
      provider: 'mock',
      usedFallback: true,
      fallbackReason: 'mock_emergency_fallback',
    },
  });
}

export function sanitizeAnalysisData(rawAnalysis = {}) {
  const estimatedSavingsMin = round(toNumber(rawAnalysis?.estimated_savings_range?.min, 0));
  const estimatedSavingsMax = round(Math.max(
    estimatedSavingsMin,
    toNumber(rawAnalysis?.estimated_savings_range?.max, estimatedSavingsMin),
  ));

  return {
    commodity: sanitizeEnum(rawAnalysis.commodity, COMMODITY_VALUES, 'unknown'),
    provider_name: sanitizeText(rawAnalysis.provider_name, 'unknown'),
    customer_name: sanitizeText(rawAnalysis.customer_name, ''),
    supply_address: sanitizeText(rawAnalysis.supply_address, ''),
    pod_or_pdr: sanitizeText(rawAnalysis.pod_or_pdr, ''),
    offer_code: sanitizeText(rawAnalysis.offer_code, ''),
    market_type: sanitizeEnum(rawAnalysis.market_type, MARKET_TYPE_VALUES, 'unknown'),
    billing_period_start: sanitizeDate(rawAnalysis.billing_period_start),
    billing_period_end: sanitizeDate(rawAnalysis.billing_period_end),
    invoice_date: sanitizeDate(rawAnalysis.invoice_date),
    due_date: sanitizeDate(rawAnalysis.due_date),
    total_amount_eur: round(toNumber(rawAnalysis.total_amount_eur, 0)),
    consumption_total: round(toNumber(rawAnalysis.consumption_total, 0)),
    consumption_unit: sanitizeEnum(rawAnalysis.consumption_unit, CONSUMPTION_UNIT_VALUES, 'unknown'),
    fascia_f1: round(toNumber(rawAnalysis.fascia_f1, 0)),
    fascia_f2: round(toNumber(rawAnalysis.fascia_f2, 0)),
    fascia_f3: round(toNumber(rawAnalysis.fascia_f3, 0)),
    spesa_materia_eur: round(toNumber(rawAnalysis.spesa_materia_eur, 0)),
    quota_consumi_eur: round(toNumber(rawAnalysis.quota_consumi_eur, 0)),
    quota_fissa_eur: round(toNumber(rawAnalysis.quota_fissa_eur, 0)),
    quota_potenza_eur: round(toNumber(rawAnalysis.quota_potenza_eur, 0)),
    trasporto_e_oneri_eur: round(toNumber(rawAnalysis.trasporto_e_oneri_eur, 0)),
    imposte_iva_eur: round(toNumber(rawAnalysis.imposte_iva_eur, 0)),
    altre_partite_eur: round(toNumber(rawAnalysis.altre_partite_eur, 0)),
    price_formula_text: sanitizeText(rawAnalysis.price_formula_text),
    estimated_monthly_cost: round(toNumber(rawAnalysis.estimated_monthly_cost, 0)),
    estimated_annual_cost: round(toNumber(rawAnalysis.estimated_annual_cost, 0)),
    extraction_confidence: clampConfidence(rawAnalysis.extraction_confidence),
    summary: sanitizeText(rawAnalysis.summary, 'Analisi completata con dati parziali.'),
    main_cost_drivers: sanitizeStringList(rawAnalysis.main_cost_drivers),
    possible_issues: sanitizeStringList(rawAnalysis.possible_issues),
    estimated_savings_range: {
      min: estimatedSavingsMin,
      max: estimatedSavingsMax,
    },
    confidence_note: sanitizeText(rawAnalysis.confidence_note, 'Verifica assistita consigliata per confermare i dati.'),
    cta_recommendation: sanitizeText(rawAnalysis.cta_recommendation, 'Parla con un consulente per verificare la bolletta.'),
  };
}

export function computeLeadTier(extraction, explanation) {
  const savingsMax = toNumber(explanation?.estimated_savings_range?.max, 0);
  const totalAmount = toNumber(extraction?.total_amount_eur, 0);
  const confidence = toNumber(extraction?.extraction_confidence, 0);

  if (savingsMax >= 180 || totalAmount >= 220) return 'caldo';
  if (savingsMax >= 60 || confidence >= 0.85) return 'medio';
  return 'soft';
}

function buildTopDrivers(extraction, explanation) {
  const knownDrivers = [
    { label: 'Quota energia / consumi', amount: extraction.quota_consumi_eur },
    { label: 'Quota fissa', amount: extraction.quota_fissa_eur },
    { label: 'Quota potenza', amount: extraction.quota_potenza_eur },
    { label: 'Trasporto e oneri', amount: extraction.trasporto_e_oneri_eur },
    { label: 'Imposte e IVA', amount: extraction.imposte_iva_eur },
    { label: 'Altre partite', amount: extraction.altre_partite_eur },
  ]
    .filter((item) => item.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);

  if (knownDrivers.length > 0) return knownDrivers;

  return explanation.main_cost_drivers.slice(0, 3).map((label) => ({ label, amount: 0 }));
}

function buildNarrative(extraction, explanation) {
  const topDrivers = buildTopDrivers(extraction, explanation);
  const driverLabels = topDrivers.map((item) => item.label.toLowerCase()).join(', ');
  const lowConfidence = extraction.extraction_confidence < 0.75;
  const savings = explanation.estimated_savings_range;

  return {
    whyYouPayThis: explanation.summary || (
      lowConfidence
        ? 'La leggibilita del documento limita una lettura completa della struttura di spesa.'
        : `Il totale sembra guidato soprattutto da ${driverLabels || 'quota energia e costi accessori'}.`
    ),
    topDrivers,
    savingsLabel: savings.max > 0
      ? `Range prudente di risparmio stimato: ${savings.min} EUR - ${savings.max} EUR l'anno.`
      : 'Non emerge un risparmio prudente quantificabile dai dati letti.',
    nextStep: explanation.cta_recommendation,
  };
}

export function createAnalysisResult({ rawAnalysis = {}, meta = {} } = {}) {
  const sanitized = sanitizeAnalysisData(rawAnalysis);
  const extraction = {
    commodity: sanitized.commodity,
    provider_name: sanitized.provider_name,
    customer_name: sanitized.customer_name,
    supply_address: sanitized.supply_address,
    pod_or_pdr: sanitized.pod_or_pdr,
    offer_code: sanitized.offer_code,
    market_type: sanitized.market_type,
    billing_period_start: sanitized.billing_period_start,
    billing_period_end: sanitized.billing_period_end,
    invoice_date: sanitized.invoice_date,
    due_date: sanitized.due_date,
    total_amount_eur: sanitized.total_amount_eur,
    consumption_total: sanitized.consumption_total,
    consumption_unit: sanitized.consumption_unit,
    fascia_f1: sanitized.fascia_f1,
    fascia_f2: sanitized.fascia_f2,
    fascia_f3: sanitized.fascia_f3,
    spesa_materia_eur: sanitized.spesa_materia_eur,
    quota_consumi_eur: sanitized.quota_consumi_eur,
    quota_fissa_eur: sanitized.quota_fissa_eur,
    quota_potenza_eur: sanitized.quota_potenza_eur,
    trasporto_e_oneri_eur: sanitized.trasporto_e_oneri_eur,
    imposte_iva_eur: sanitized.imposte_iva_eur,
    altre_partite_eur: sanitized.altre_partite_eur,
    price_formula_text: sanitized.price_formula_text,
    estimated_monthly_cost: sanitized.estimated_monthly_cost,
    estimated_annual_cost: sanitized.estimated_annual_cost,
    extraction_confidence: sanitized.extraction_confidence,
  };
  const explanation = {
    summary: sanitized.summary,
    main_cost_drivers: sanitized.main_cost_drivers,
    possible_issues: sanitized.possible_issues,
    estimated_savings_range: sanitized.estimated_savings_range,
    confidence_note: sanitized.confidence_note,
    cta_recommendation: sanitized.cta_recommendation,
  };

  return {
    mode: sanitizeText(meta.mode, 'live'),
    leadTier: computeLeadTier(extraction, explanation),
    extraction,
    explanation,
    narrative: buildNarrative(extraction, explanation),
    meta: {
      analyzedAt: sanitizeText(meta.analyzedAt, new Date().toISOString()),
      fileName: sanitizeText(meta.fileName),
      fileSize: toNumber(meta.fileSize, 0),
      provider: sanitizeText(meta.provider, 'unknown'),
      usedFallback: Boolean(meta.usedFallback),
      fallbackReason: sanitizeText(meta.fallbackReason),
      xaiFileDeleted: meta.xaiFileDeleted == null ? null : Boolean(meta.xaiFileDeleted),
    },
  };
}

export function buildLeadEmailText({ fields = {}, analysis = null, file = null } = {}) {
  const normalized = normalizeUploadFields(fields);
  const savings = analysis?.explanation?.estimated_savings_range || { min: 0, max: 0 };
  const confidence = analysis?.extraction?.extraction_confidence ?? 0;

  return [
    'Nuova richiesta check bolletta beta',
    `Nome: ${normalized.nome}`,
    `Telefono: ${normalized.telefono}`,
    `Email: ${normalized.email || '-'}`,
    `Comune: ${normalized.comune}`,
    `Consenso analisi: ${normalized.consentAnalysis ? 'si' : 'no'}`,
    `Consenso marketing: ${normalized.consentMarketing ? 'si' : 'no'}`,
    normalized.consentMarketing ? 'Marketing autorizzato: si' : 'Marketing autorizzato: no',
    `File: ${file?.name || analysis?.meta?.fileName || '-'}`,
    `Formato: ${file?.type || '-'}`,
    `Dimensione: ${file?.size || analysis?.meta?.fileSize || 0} bytes`,
    `Commodity: ${analysis?.extraction?.commodity || '-'}`,
    `Totale bolletta: ${analysis?.extraction?.total_amount_eur || 0} EUR`,
    `Risparmio stimato: ${savings.min}-${savings.max} EUR/anno`,
    `Confidenza: ${Math.round(confidence * 100)}%`,
    `Summary: ${analysis?.explanation?.summary || '-'}`,
    `Tier lead: ${analysis?.leadTier || '-'}`,
  ].join('\n');
}
