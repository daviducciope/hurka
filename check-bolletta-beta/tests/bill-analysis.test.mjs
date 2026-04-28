import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import {
  buildLeadEmailText,
  createAnalysisResult,
  createMockAnalysis,
  validateUploadInput,
} from '../bill-analysis-core.mjs';
import { buildAnalysisMarkup, getEsitoOutcome } from '../ui-core.mjs';

const lambdaModuleUrl = pathToFileURL(resolve(process.cwd(), 'lambda/index.mjs')).href;

function buildMultipartEvent({ fields, file, path = '/api/bill-analysis/upload' }) {
  const boundary = '----hurka-beta-boundary';
  const segments = [];

  for (const [name, value] of Object.entries(fields)) {
    segments.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`,
    );
  }

  segments.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="billFile"; filename="${file.name}"\r\n` +
    `Content-Type: ${file.type}\r\n\r\n` +
    `${file.content}\r\n`,
  );
  segments.push(`--${boundary}--\r\n`);

  const rawBody = segments.join('');
  return {
    rawPath: path,
    path,
    requestContext: { http: { method: 'POST', path } },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.from(rawBody, 'latin1').toString('base64'),
    isBase64Encoded: true,
  };
}

async function loadLambdaModule({ env = {}, fetchImpl } = {}) {
  const originalEnv = {
    XAI_API_KEY: process.env.XAI_API_KEY,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    BILL_ANALYSIS_DAILY_FREE_LIMIT: process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT,
    BILL_ANALYSIS_QUOTA_TABLE: process.env.BILL_ANALYSIS_QUOTA_TABLE,
  };
  const originalFetch = globalThis.fetch;

  if ('XAI_API_KEY' in env) {
    process.env.XAI_API_KEY = env.XAI_API_KEY;
  } else {
    delete process.env.XAI_API_KEY;
  }

  if ('SENDGRID_API_KEY' in env) {
    process.env.SENDGRID_API_KEY = env.SENDGRID_API_KEY;
  } else {
    delete process.env.SENDGRID_API_KEY;
  }

  if ('BILL_ANALYSIS_DAILY_FREE_LIMIT' in env) {
    process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT = env.BILL_ANALYSIS_DAILY_FREE_LIMIT;
  } else {
    process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT = '0';
  }

  if ('BILL_ANALYSIS_QUOTA_TABLE' in env) {
    process.env.BILL_ANALYSIS_QUOTA_TABLE = env.BILL_ANALYSIS_QUOTA_TABLE;
  } else {
    delete process.env.BILL_ANALYSIS_QUOTA_TABLE;
  }

  if (fetchImpl) {
    globalThis.fetch = fetchImpl;
  }

  const module = await import(`${lambdaModuleUrl}?ts=${Date.now()}-${Math.random()}`);

  return {
    module,
    restore() {
      if (originalEnv.XAI_API_KEY == null) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = originalEnv.XAI_API_KEY;

      if (originalEnv.SENDGRID_API_KEY == null) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = originalEnv.SENDGRID_API_KEY;

      if (originalEnv.BILL_ANALYSIS_DAILY_FREE_LIMIT == null) delete process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT;
      else process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT = originalEnv.BILL_ANALYSIS_DAILY_FREE_LIMIT;

      if (originalEnv.BILL_ANALYSIS_QUOTA_TABLE == null) delete process.env.BILL_ANALYSIS_QUOTA_TABLE;
      else process.env.BILL_ANALYSIS_QUOTA_TABLE = originalEnv.BILL_ANALYSIS_QUOTA_TABLE;

      if (fetchImpl) {
        globalThis.fetch = originalFetch;
      }
    },
  };
}

function createStructuredAnalysis() {
  return {
    commodity: 'luce',
    provider_name: 'Enel Energia',
    customer_name: 'Mario Rossi',
    supply_address: 'Via Roma 10, Pescara',
    pod_or_pdr: 'IT001E12345678',
    offer_code: 'PLACET-LUCE',
    market_type: 'libero',
    billing_period_start: '2026-03-01',
    billing_period_end: '2026-03-31',
    invoice_date: '2026-04-05',
    due_date: '2026-04-25',
    total_amount_eur: 182.4,
    consumption_total: 286,
    consumption_unit: 'kWh',
    fascia_f1: 118,
    fascia_f2: 82,
    fascia_f3: 86,
    spesa_materia_eur: 105.1,
    quota_consumi_eur: 76.2,
    quota_fissa_eur: 17.5,
    quota_potenza_eur: 11.4,
    trasporto_e_oneri_eur: 39.2,
    imposte_iva_eur: 21.8,
    altre_partite_eur: 16.3,
    price_formula_text: 'Prezzo variabile indicizzato al PUN con spread.',
    estimated_monthly_cost: 60.8,
    estimated_annual_cost: 729.6,
    extraction_confidence: 0.91,
    summary: 'La spesa e guidata soprattutto dalla quota energia e dai costi di rete.',
    main_cost_drivers: ['Quota energia / consumi', 'Trasporto e oneri', 'Quota fissa'],
    possible_issues: ['Prezzo energia sopra media per il profilo stimato'],
    estimated_savings_range: { min: 90, max: 180 },
    confidence_note: 'Documento leggibile e dati principali coerenti.',
    cta_recommendation: 'Richiedi una verifica gratuita per confrontare l offerta attuale.',
    detailed_explanation: 'La fattura mostra una spesa concentrata sulla materia energia, con costi regolati e imposte in seconda battuta.',
    critical_points: ['Prezzo energia sopra media per il profilo stimato'],
    sales_recommendation: 'HURKA puo verificare la convenienza e proporti un cambio solo se i numeri restano favorevoli.',
  };
}

function attachSalesOpportunity(analysis, overrides = {}) {
  analysis.salesOpportunity = {
    status: 'high-saving',
    hasSavingOpportunity: true,
    savingsRange: { min: 280, max: 400 },
    benchmarkSource: 'cte_hurka',
    confidence: analysis.extraction.extraction_confidence,
    headline: 'La bolletta mostra un margine di risparmio interessante.',
    summary: 'Il range deriva dal confronto tra la spesa materia letta in bolletta e le condizioni economiche disponibili nel catalogo HURKA.',
    nextStep: 'Prenota una verifica gratuita.',
    ...overrides,
  };
  return analysis;
}

test('validateUploadInput rejects missing consent and unsupported mime type', () => {
  const result = validateUploadInput({
    fields: {
      nome: 'Mario Rossi',
      telefono: '+393334445556',
      comune: 'Pescara',
      consentAnalysis: false,
    },
    file: {
      name: 'bolletta.webp',
      type: 'image/webp',
      size: 1024,
    },
  });

  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /consenso/i);
  assert.match(result.errors.join(' '), /Formato non supportato/i);
});

test('createMockAnalysis marks dual expensive files as hot leads', () => {
  const analysis = createMockAnalysis({
    fileName: 'dual-condominio-alto-costo.pdf',
    fileSize: 250000,
    fields: {
      nome: 'Laura Bianchi',
      telefono: '+393334445556',
      comune: 'Pescara',
      commodityHint: 'dual',
      consentAnalysis: true,
    },
  });

  assert.equal(analysis.leadTier, 'caldo');
  assert.equal(analysis.extraction.commodity, 'dual');
  assert.ok(analysis.explanation.estimated_savings_range.max >= 300);
  assert.ok(analysis.extraction.extraction_confidence > 0.9);
});

test('createAnalysisResult coerces malformed structured data defensively', () => {
  const analysis = createAnalysisResult({
    rawAnalysis: {
      ...createStructuredAnalysis(),
      commodity: 'invalid',
      billing_period_start: '03/01/2026',
      extraction_confidence: 75,
      estimated_savings_range: { min: '20', max: '10' },
      main_cost_drivers: ['Quota energia', '', 12],
    },
    meta: {
      mode: 'live',
      provider: 'xai',
      usedFallback: false,
    },
  });

  assert.equal(analysis.extraction.commodity, 'unknown');
  assert.equal(analysis.extraction.billing_period_start, null);
  assert.equal(analysis.extraction.extraction_confidence, 0.75);
  assert.deepEqual(analysis.explanation.estimated_savings_range, { min: 20, max: 20 });
  assert.deepEqual(analysis.explanation.main_cost_drivers, ['Quota energia']);
});

test('buildLeadEmailText keeps marketing consent separated from analysis consent', () => {
  const emailText = buildLeadEmailText({
    fields: {
      nome: 'Sara Neri',
      telefono: '+393331112233',
      comune: 'Chieti',
      consentAnalysis: true,
      consentMarketing: false,
    },
    file: {
      name: 'bolletta.pdf',
      type: 'application/pdf',
      size: 4567,
    },
    analysis: createAnalysisResult({
      rawAnalysis: createStructuredAnalysis(),
      meta: { mode: 'live', provider: 'xai', usedFallback: false },
    }),
  });

  assert.match(emailText, /Consenso analisi: si/);
  assert.match(emailText, /Consenso marketing: no/);
  assert.match(emailText, /Marketing autorizzato: no/);
});

test('buildAnalysisMarkup renders the real payload coherently', () => {
  const html = buildAnalysisMarkup(attachSalesOpportunity(createAnalysisResult({
    rawAnalysis: createStructuredAnalysis(),
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  })));

  assert.match(html, /Enel Energia|Quota energia/);
  assert.match(html, /Analisi AI reale completata/);
  assert.match(html, /WhatsApp|Richiedi richiamata/);
});

test('bill-analysis endpoint returns 400 when required contact data is missing', async () => {
  const loaded = await loadLambdaModule();

  try {
    const response = await loaded.module.handler({
      rawPath: '/api/bill-analysis/upload',
      path: '/api/bill-analysis/upload',
      requestContext: { http: { method: 'POST', path: '/api/bill-analysis/upload' } },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          nome: '',
          telefono: '',
          comune: '',
          consentAnalysis: false,
        },
        file: {
          name: 'bolletta.pdf',
          type: 'application/pdf',
          size: 1024,
        },
      }),
    });
    const payload = JSON.parse(response.body);

    assert.equal(response.statusCode, 400);
    assert.match(payload.error, /nome/i);
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint rejects real submission when xAI is not configured', async () => {
  const loaded = await loadLambdaModule({ env: { XAI_API_KEY: '' } });

  try {
    const response = await loaded.module.handler(buildMultipartEvent({
      fields: {
        nome: 'Mario Rossi',
        telefono: '+393888668837',
        email: 'mario@example.com',
        comune: 'Pescara',
        commodityHint: 'dual',
        consentAnalysis: 'true',
        consentMarketing: 'true',
      },
      file: {
        name: 'dual-condominio-alto-costo.pdf',
        type: 'application/pdf',
        content: '%PDF-1.4 mock pdf content',
      },
    }));
    const payload = JSON.parse(response.body);

    assert.equal(response.statusCode, 503);
    assert.equal(payload.code, 'missing_xai_config');
    assert.equal(payload.meta.usedFallback, false);
    assert.equal(payload.meta.provider, 'none');
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint runs the real xAI pipeline, accepts file_id, and deletes the remote file', async () => {
  const calls = [];
  const structured = createStructuredAnalysis();
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init });

    if (url.endsWith('/files') && init.method === 'POST') {
      return new Response(JSON.stringify({ file_id: 'file_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/responses') && init.method === 'POST') {
      const requestBody = JSON.parse(init.body);
      assert.equal(requestBody.model, 'grok-4.20-reasoning');
      assert.equal(requestBody.store, false);
      assert.equal(requestBody.text.format.type, 'json_schema');
      assert.equal(requestBody.input[1].content[1].file_id, 'file_123');

      return new Response(JSON.stringify({
        output_text: JSON.stringify(structured),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/files/file_123') && init.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const loaded = await loadLambdaModule({
    env: { XAI_API_KEY: 'xai-test-key' },
    fetchImpl: fetchMock,
  });

  try {
    const response = await loaded.module.handler(buildMultipartEvent({
      fields: {
        nome: 'Mario Rossi',
        telefono: '+393888668837',
        email: 'mario@example.com',
        comune: 'Pescara',
        commodityHint: 'luce',
        consentAnalysis: 'true',
        consentMarketing: 'false',
      },
      file: {
        name: 'bolletta-marzo.pdf',
        type: 'application/pdf',
        content: '%PDF-1.4 real mock pdf content',
      },
    }));
    const payload = JSON.parse(response.body);

    assert.equal(response.statusCode, 200);
    assert.equal(payload.meta.usedFallback, false);
    assert.equal(payload.meta.provider, 'xai');
    assert.equal(payload.analysis.mode, 'live');
    assert.equal(payload.analysis.extraction.provider_name, 'Enel Energia');
    assert.equal(payload.analysis.offerMatch, undefined);
    assert.equal(payload.analysis.salesOpportunity.hasSavingOpportunity, true);
    assert.equal(payload.analysis.salesOpportunity.benchmarkSource, 'cte_hurka');
    assert.equal(payload.analysis.meta.xaiFileDeleted, true);
    assert.equal(payload.meta.emailSent, false);
    assert.equal(calls.length, 3);
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint blocks the fourth free analysis in the same day', async () => {
  let uploadCalls = 0;
  const structured = createStructuredAnalysis();
  const fetchMock = async (url, init = {}) => {
    if (url.endsWith('/files') && init.method === 'POST') {
      uploadCalls += 1;
      return new Response(JSON.stringify({ file_id: `file_quota_${uploadCalls}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/responses') && init.method === 'POST') {
      return new Response(JSON.stringify({ output_text: JSON.stringify(structured) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (/\/files\/file_quota_\d+$/.test(url) && init.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const loaded = await loadLambdaModule({
    env: {
      XAI_API_KEY: 'xai-test-key',
      BILL_ANALYSIS_DAILY_FREE_LIMIT: '3',
    },
    fetchImpl: fetchMock,
  });

  try {
    const event = () => buildMultipartEvent({
      fields: {
        nome: 'Quota Test',
        telefono: '+393330000001',
        email: 'quota@example.com',
        comune: 'Pescara',
        commodityHint: 'luce',
        consentAnalysis: 'true',
        consentMarketing: 'false',
      },
      file: {
        name: 'quota.pdf',
        type: 'application/pdf',
        content: '%PDF-1.4 quota',
      },
    });

    for (let i = 0; i < 3; i += 1) {
      const response = await loaded.module.handler(event());
      assert.equal(response.statusCode, 200);
      const payload = JSON.parse(response.body);
      assert.equal(payload.meta.quota.limit, 3);
      assert.equal(payload.meta.quota.remaining, 2 - i);
    }

    const blocked = await loaded.module.handler(event());
    const payload = JSON.parse(blocked.body);
    assert.equal(blocked.statusCode, 429);
    assert.equal(payload.code, 'daily_quota_exceeded');
    assert.equal(payload.quota.remaining, 0);
    assert.equal(uploadCalls, 3);
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint returns a real AI error and still cleans up the uploaded file', async () => {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init });

    if (url.endsWith('/files') && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'file_999' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/responses') && init.method === 'POST') {
      return new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 });
    }

    if (url.endsWith('/files/file_999') && init.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const loaded = await loadLambdaModule({
    env: { XAI_API_KEY: 'xai-test-key' },
    fetchImpl: fetchMock,
  });

  try {
    const response = await loaded.module.handler(buildMultipartEvent({
      fields: {
        nome: 'Giulia Verdi',
        telefono: '+393339998887',
        comune: 'Chieti',
        commodityHint: 'gas',
        consentAnalysis: 'true',
        consentMarketing: 'true',
      },
      file: {
        name: 'gas-aprile.pdf',
        type: 'application/pdf',
        content: '%PDF-1.4 gas pdf content',
      },
    }));
    const payload = JSON.parse(response.body);

    assert.equal(response.statusCode, 502);
    assert.equal(payload.code, 'xai_error');
    assert.equal(payload.meta.usedFallback, false);
    assert.equal(payload.meta.provider, 'xai');
    assert.equal(payload.meta.xaiFileDeleted, true);
    assert.equal(calls.length, 3);
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint reports delete failure without downgrading a successful xAI analysis', async () => {
  const structured = createStructuredAnalysis();
  const fetchMock = async (url, init = {}) => {
    if (url.endsWith('/files') && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'file_del_fail' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/responses') && init.method === 'POST') {
      return new Response(JSON.stringify({ output_text: JSON.stringify(structured) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/files/file_del_fail') && init.method === 'DELETE') {
      return new Response(JSON.stringify({ deleted: false, id: 'file_del_fail' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const loaded = await loadLambdaModule({
    env: { XAI_API_KEY: 'xai-test-key' },
    fetchImpl: fetchMock,
  });

  try {
    const response = await loaded.module.handler(buildMultipartEvent({
      fields: {
        nome: 'Paolo Neri',
        telefono: '+393331112244',
        comune: 'Pescara',
        commodityHint: 'luce',
        consentAnalysis: 'true',
      },
      file: {
        name: 'luce.pdf',
        type: 'application/pdf',
        content: '%PDF-1.4 luce',
      },
    }));
    const payload = JSON.parse(response.body);

    assert.equal(response.statusCode, 200);
    assert.equal(payload.meta.usedFallback, false);
    assert.equal(payload.analysis.meta.xaiFileDeleted, false);
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint preserves successful analysis when SendGrid fails', async () => {
  const structured = createStructuredAnalysis();
  const fetchMock = async (url, init = {}) => {
    if (url.endsWith('/files') && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'file_sendgrid' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/responses') && init.method === 'POST') {
      return new Response(JSON.stringify({ output_text: JSON.stringify(structured) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/files/file_sendgrid') && init.method === 'DELETE') {
      return new Response(JSON.stringify({ deleted: true, id: 'file_sendgrid' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('api.sendgrid.com')) {
      return new Response(JSON.stringify({ errors: [{ message: 'blocked' }] }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const loaded = await loadLambdaModule({
    env: {
      XAI_API_KEY: 'xai-test-key',
      SENDGRID_API_KEY: 'SG.test-key',
    },
    fetchImpl: fetchMock,
  });

  try {
    const response = await loaded.module.handler(buildMultipartEvent({
      fields: {
        nome: 'Marta Blu',
        telefono: '+393331119999',
        email: 'marta@example.com',
        comune: 'Pescara',
        commodityHint: 'luce',
        consentAnalysis: 'true',
        consentMarketing: 'false',
      },
      file: {
        name: 'luce.pdf',
        type: 'application/pdf',
        content: '%PDF-1.4 luce',
      },
    }));
    const payload = JSON.parse(response.body);

    assert.equal(response.statusCode, 200);
    assert.equal(payload.meta.usedFallback, false);
    assert.equal(payload.meta.emailSent, false);
  } finally {
    loaded.restore();
  }
});

// ── Tests per i 3 esiti finali in buildAnalysisMarkup ────────────────────────

test('buildAnalysisMarkup esito A (match forte): mostra risparmio e CTA forte', () => {
  const analysis = attachSalesOpportunity(createAnalysisResult({
    rawAnalysis: createStructuredAnalysis(),
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  }));

  assert.equal(getEsitoOutcome(analysis), 'match');

  const html = buildAnalysisMarkup(analysis, { fallback: false });

  // Esito card is present with match styling
  assert.match(html, /esito-match/);
  assert.match(html, /Possibile risparmio/i);
  // Range risparmio visibile
  assert.match(html, /280|400/);
  // CTA forte WhatsApp
  assert.match(html, /wa\.me.*Verifica/i);
  // CTA soft richiamata
  assert.match(html, /Richiedi richiamata/i);
  // CTA consulente
  assert.match(html, /consulente/i);
  // Offerta e fornitore partner non sono esposti al cliente
  assert.ok(!html.includes('Biennale Luce Casa'));
  assert.ok(!html.includes('Sinergas'));
  // Nessuna promessa aggressiva
  assert.ok(!html.includes('miglior fornitore assoluto'));
  // Footer note corretto
  assert.match(html, /Analisi AI reale completata\./);
  // Detail section presente (provider_name Enel Energia)
  assert.match(html, /Enel Energia/);
});

test('buildAnalysisMarkup esito B (nessuna convenienza): messaggio onesto, nessuna offerta', () => {
  const analysis = attachSalesOpportunity(createAnalysisResult({
    rawAnalysis: createStructuredAnalysis(),
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  }), {
    status: 'limited-saving',
    hasSavingOpportunity: false,
    savingsRange: { min: 0, max: 0 },
    headline: 'Al momento non emerge un risparmio abbastanza forte.',
    summary: 'Il profilo attuale non mostra un risparmio credibile con le condizioni disponibili.',
  });

  assert.equal(getEsitoOutcome(analysis), 'no-match');

  const html = buildAnalysisMarkup(analysis, { fallback: false });

  assert.match(html, /esito-no-match/);
  assert.match(html, /gi.+ competitivo|convenienza sufficiente/i);
  // Nessun numero di risparmio inventato
  assert.ok(!html.includes('esito-saving-big'));
  // CTA soft (verifica gratuita comunque)
  assert.match(html, /Verifica gratuita/i);
  assert.match(html, /WhatsApp/i);
  // Nessuna CTA aggressiva tipo "Attiva con HURKA"
  assert.ok(!html.includes('Attiva con HURKA'));
  // Footer note corretto
  assert.match(html, /Analisi AI reale completata\./);
  // Detail section
  assert.match(html, /Enel Energia/);
  // Prossimo passo con cta_recommendation
  assert.match(html, /Richiedi una verifica/i);
});

test('buildAnalysisMarkup esito C (bassa confidenza): verifica assistita, nessuna offerta', () => {
  const analysis = attachSalesOpportunity(createAnalysisResult({
    rawAnalysis: {
      ...createStructuredAnalysis(),
      extraction_confidence: 0.42,
      spesa_materia_eur: 0,
      quota_consumi_eur: 0,
      quota_fissa_eur: 0,
      quota_potenza_eur: 0,
      consumption_total: 0,
    },
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  }), {
    status: 'assisted-review',
    hasSavingOpportunity: false,
    savingsRange: { min: 0, max: 0 },
    confidence: 0.42,
    headline: 'Serve una verifica assistita.',
    summary: 'Confidenza di estrazione troppo bassa per un confronto affidabile.',
  });

  assert.equal(getEsitoOutcome(analysis), 'low-confidence');

  const html = buildAnalysisMarkup(analysis, { fallback: false });

  assert.match(html, /esito-low-conf/);
  assert.match(html, /verifica assistita/i);
  assert.match(html, /42%/);
  // CTA primaria verso richiamata
  assert.match(html, /Richiedi richiamata/i);
  // CTA WhatsApp assistita
  assert.match(html, /WhatsApp/i);
  // Nessun match offerta
  assert.ok(!html.includes('esito-match'));
  assert.ok(!html.includes('Attiva con HURKA'));
  // Footer note
  assert.match(html, /Analisi AI reale completata\./);
});

test('getEsitoOutcome restituisce no-match quando offerMatch è assente', () => {
  const analysis = createAnalysisResult({
    rawAnalysis: createStructuredAnalysis(),
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  });
  // offerMatch non impostato (come in unit test senza lambda)
  assert.equal(getEsitoOutcome(analysis), 'no-match');
});

test('buildAnalysisMarkup example mode shows demo note', () => {
  const html = buildAnalysisMarkup(createAnalysisResult({
    rawAnalysis: createStructuredAnalysis(),
    meta: { mode: 'mock', provider: 'mock', usedFallback: true },
  }), { fallback: true });

  assert.match(html, /Esempio dimostrativo\./);
  assert.ok(!html.includes('Analisi AI reale completata.'));
});

// ── Test aggiornato regressione buildAnalysisMarkup ──────────────────────────

test('analyzeBillWithGrok parses structured JSON returned in output content blocks', async () => {
  const structured = createStructuredAnalysis();
  const fetchMock = async () => new Response(JSON.stringify({
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: JSON.stringify(structured),
          },
        ],
      },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const loaded = await loadLambdaModule({
    env: { XAI_API_KEY: 'xai-test-key' },
    fetchImpl: fetchMock,
  });

  try {
    const result = await loaded.module.analyzeBillWithGrok({
      fileId: 'file_abc',
      originalFields: { nome: 'Mario Rossi', comune: 'Pescara', commodityHint: 'luce' },
    });

    assert.equal(result.provider_name, 'Enel Energia');
    assert.equal(result.estimated_savings_range.max, 180);
  } finally {
    loaded.restore();
  }
});
