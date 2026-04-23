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
import { buildAnalysisMarkup } from '../ui-core.mjs';

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
  };
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
  const html = buildAnalysisMarkup(createAnalysisResult({
    rawAnalysis: createStructuredAnalysis(),
    meta: { mode: 'live', provider: 'xai', usedFallback: false },
  }));

  assert.match(html, /Enel Energia|Quota energia/);
  assert.match(html, /Analisi reale completata/);
  assert.match(html, /Parla con un consulente/);
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

test('bill-analysis endpoint falls back to mock when xAI is not configured', async () => {
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

    assert.equal(response.statusCode, 200);
    assert.equal(payload.meta.usedFallback, true);
    assert.equal(payload.meta.provider, 'mock');
    assert.equal(payload.meta.fallbackReason, 'missing_xai_config');
    assert.equal(payload.analysis.meta.usedFallback, true);
    assert.equal(payload.meta.emailSent, false);
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
    assert.equal(payload.analysis.meta.xaiFileDeleted, true);
    assert.equal(payload.meta.emailSent, false);
    assert.equal(calls.length, 3);
  } finally {
    loaded.restore();
  }
});

test('bill-analysis endpoint degrades to mock on xAI error and still cleans up the uploaded file', async () => {
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

    assert.equal(response.statusCode, 200);
    assert.equal(payload.meta.usedFallback, true);
    assert.equal(payload.meta.fallbackReason, 'xai_error');
    assert.equal(payload.analysis.meta.usedFallback, true);
    assert.equal(payload.analysis.meta.xaiFileDeleted, true);
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
