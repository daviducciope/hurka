import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import process from 'node:process';

import { applyTempCredentials } from './temp-credentials.mjs';

const args = new Set(process.argv.slice(2));
const runLive = args.has('--live');
const runSendgridLive = args.has('--live-sendgrid');
const useTempCredentials = args.has('--use-temp-credentials');

if (useTempCredentials) {
  applyTempCredentials();
}

if (runLive && !runSendgridLive) {
  delete process.env.SENDGRID_API_KEY;
}

if (!runLive && !process.env.XAI_API_KEY) {
  process.env.XAI_API_KEY = 'xai-mock-test';
}
if ((!runLive || runSendgridLive) && !process.env.SENDGRID_API_KEY) {
  process.env.SENDGRID_API_KEY = 'SG.mock-test';
}

const repoRoot = resolve(process.cwd());
const lambdaUrl = new URL('../../lambda/index.mjs', import.meta.url);
const { handler } = await import(`${lambdaUrl.href}?run=${Date.now()}`);

const files = {
  pdfLuce: resolve(repoRoot, 'check-bolletta-beta/docs/00125FT01549423.PDF'),
  pdfLuceAlt: resolve(repoRoot, 'check-bolletta-beta/docs/Edison_6109011896_dettagliata.pdf'),
  cte: resolve(repoRoot, 'check-bolletta-beta/docs/EE_FIX_FAMILY_RAP.pdf'),
  pngReadable: resolve(repoRoot, 'check-bolletta-beta/fixtures/generated/luce-readable.png'),
  jpgReadable: resolve(repoRoot, 'check-bolletta-beta/fixtures/generated/luce-readable.jpg'),
  pngBlurred: resolve(repoRoot, 'check-bolletta-beta/fixtures/generated/luce-blurred-partial.png'),
  gasPdf: resolve(repoRoot, 'check-bolletta-beta/docs/gas-sample.pdf'),
};

function buildFields(overrides = {}) {
  return {
    nome: 'Codex Verifica',
    telefono: '+393331234567',
    email: 'codex@example.com',
    comune: 'Pescara',
    commodityHint: 'luce',
    consentAnalysis: 'true',
    consentMarketing: 'false',
    ...overrides,
  };
}

function detectMime(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function buildMultipartEvent({ fields, filePath, fileType, fileName }) {
  const boundary = '----hurka-live-boundary';
  const segments = [];
  const buffer = readFileSync(filePath);

  for (const [name, value] of Object.entries(fields)) {
    segments.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf8',
    ));
  }

  segments.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="billFile"; filename="${fileName}"\r\nContent-Type: ${fileType}\r\n\r\n`,
    'utf8',
  ));
  segments.push(buffer);
  segments.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

  return {
    rawPath: '/api/bill-analysis/upload',
    path: '/api/bill-analysis/upload',
    requestContext: { http: { method: 'POST', path: '/api/bill-analysis/upload' } },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(segments).toString('base64'),
    isBase64Encoded: true,
  };
}

function responseJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const realFetch = globalThis.fetch.bind(globalThis);

function createSelectiveMockFetch({ sendgridOk = true, invalidJson = false, xaiError = false, deleteOk = true } = {}) {
  return async (url, init = {}) => {
    const target = String(url);

    if (target.includes('api.sendgrid.com')) {
      return sendgridOk
        ? new Response(null, { status: 202 })
        : responseJson(500, { errors: [{ message: 'forced sendgrid failure' }] });
    }

    if (target.endsWith('/files') && init.method === 'POST') {
      return responseJson(200, { file_id: 'file_integration' });
    }

    if (target.endsWith('/responses') && init.method === 'POST') {
      if (xaiError) return responseJson(502, { error: 'forced xai failure' });
      if (invalidJson) return responseJson(200, { output_text: '{bad json' });

      return responseJson(200, {
        output_text: JSON.stringify({
          commodity: 'luce',
          provider_name: 'Provider Test',
          customer_name: 'Codex Verifica',
          supply_address: 'Via Test 10, Pescara',
          pod_or_pdr: 'IT001E000TEST',
          offer_code: 'TEST-LIVE',
          market_type: 'libero',
          billing_period_start: '2025-04-01',
          billing_period_end: '2025-04-30',
          invoice_date: '2025-05-09',
          due_date: '2025-05-29',
          total_amount_eur: 87.33,
          consumption_total: 229,
          consumption_unit: 'kWh',
          fascia_f1: 90,
          fascia_f2: 70,
          fascia_f3: 69,
          quota_consumi_eur: 44.35,
          quota_fissa_eur: 14.48,
          quota_potenza_eur: 0,
          trasporto_e_oneri_eur: 7.18,
          imposte_iva_eur: 12.32,
          altre_partite_eur: 9,
          price_formula_text: 'Prezzo energia e costi di sistema.',
          estimated_monthly_cost: 29.11,
          estimated_annual_cost: 349.32,
          extraction_confidence: 0.93,
          summary: 'Test integrazione riuscito.',
          main_cost_drivers: ['Quota energia / consumi', 'Trasporto e oneri'],
          possible_issues: [],
          estimated_savings_range: { min: 40, max: 95 },
          confidence_note: 'Documento leggibile.',
          cta_recommendation: 'Richiedi verifica.',
        }),
      });
    }

    if (target.endsWith('/files/file_integration') && init.method === 'DELETE') {
      return responseJson(200, { deleted: deleteOk, id: 'file_integration' });
    }

    return realFetch(url, init);
  };
}

async function runMultipartScenario({
  name,
  filePath,
  fields,
  expectedStatus = 200,
  fetchImpl = realFetch,
  validate,
}) {
  globalThis.fetch = fetchImpl;
  const response = await handler(buildMultipartEvent({
    fields,
    filePath,
    fileType: detectMime(filePath),
    fileName: basename(filePath),
  }));
  const payload = JSON.parse(response.body);

  if (response.statusCode !== expectedStatus) {
    throw new Error(`${name}: expected ${expectedStatus}, got ${response.statusCode}: ${response.body}`);
  }
  if (validate) validate(payload);

  return {
    name,
    statusCode: response.statusCode,
    payload,
  };
}

async function runJsonScenario({ name, body, expectedStatus = 400, validate }) {
  globalThis.fetch = realFetch;
  const response = await handler({
    rawPath: '/api/bill-analysis/upload',
    path: '/api/bill-analysis/upload',
    requestContext: { http: { method: 'POST', path: '/api/bill-analysis/upload' } },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = JSON.parse(response.body);

  if (response.statusCode !== expectedStatus) {
    throw new Error(`${name}: expected ${expectedStatus}, got ${response.statusCode}: ${response.body}`);
  }
  if (validate) validate(payload);

  return {
    name,
    statusCode: response.statusCode,
    payload,
  };
}

const results = [];

try {
  results.push(await runMultipartScenario({
    name: 'validation_missing_consent',
    filePath: files.pdfLuce,
    fields: buildFields({ consentAnalysis: 'false' }),
    expectedStatus: 400,
    validate: (payload) => {
      if (!/consenso/i.test(payload.error)) throw new Error('validation_missing_consent: missing consent error');
    },
  }));

  results.push(await runJsonScenario({
    name: 'validation_file_too_large',
    body: {
      fields: buildFields(),
      file: {
        name: 'oversized.pdf',
        type: 'application/pdf',
        size: 11 * 1024 * 1024,
      },
    },
    validate: (payload) => {
      if (!/10 MB/i.test(payload.error)) throw new Error('validation_file_too_large: wrong error');
    },
  }));

  results.push(await runJsonScenario({
    name: 'validation_unsupported_mime',
    body: {
      fields: buildFields(),
      file: {
        name: 'unsupported.webp',
        type: 'image/webp',
        size: 1024,
      },
    },
    validate: (payload) => {
      if (!/Formato non supportato/i.test(payload.error)) throw new Error('validation_unsupported_mime: wrong error');
    },
  }));

  const mockedCases = [
    ['mock_xai_5xx_fallback', files.pdfLuce, createSelectiveMockFetch({ xaiError: true }), (payload) => {
      if (!payload.meta.usedFallback) throw new Error('mock_xai_5xx_fallback: expected fallback');
    }],
    ['mock_invalid_json_fallback', files.pdfLuce, createSelectiveMockFetch({ invalidJson: true }), (payload) => {
      if (!payload.meta.usedFallback) throw new Error('mock_invalid_json_fallback: expected fallback');
    }],
    ['mock_delete_fail', files.pdfLuce, createSelectiveMockFetch({ deleteOk: false }), (payload) => {
      if (payload.analysis.meta.xaiFileDeleted !== false) throw new Error('mock_delete_fail: delete should fail');
    }],
    ['mock_sendgrid_fail', files.pdfLuce, createSelectiveMockFetch({ sendgridOk: false }), (payload) => {
      if (payload.meta.emailSent !== false) throw new Error('mock_sendgrid_fail: emailSent should be false');
    }],
  ];

  for (const [name, filePath, fetchImpl, validate] of mockedCases) {
    results.push(await runMultipartScenario({
      name,
      filePath,
      fields: buildFields(),
      fetchImpl,
      validate,
    }));
  }

  if (runLive) {
    if (!process.env.XAI_API_KEY) {
      throw new Error('Missing XAI_API_KEY for live scenarios');
    }

    const liveCases = [
      ['live_pdf_luce', files.pdfLuce, buildFields({ commodityHint: 'luce' })],
      ['live_pdf_luce_alt_format', files.pdfLuceAlt, buildFields({ commodityHint: 'luce' })],
      ['live_png_readable', files.pngReadable, buildFields({ commodityHint: 'luce' })],
      ['live_jpg_readable', files.jpgReadable, buildFields({ commodityHint: 'luce' })],
      ['live_png_blurred_partial', files.pngBlurred, buildFields({ commodityHint: 'luce' })],
      ['live_cte_different_structure', files.cte, buildFields({ commodityHint: 'unknown' })],
    ];

    if (existsSync(files.gasPdf)) {
      liveCases.push(['live_pdf_gas', files.gasPdf, buildFields({ commodityHint: 'gas' })]);
    } else {
      results.push({
        name: 'live_pdf_gas',
        statusCode: 0,
        payload: { skipped: true, reason: 'Missing real gas file in repo' },
      });
    }

    for (const [name, filePath, fields] of liveCases) {
      results.push(await runMultipartScenario({
        name,
        filePath,
        fields,
        validate: (payload) => {
          if (payload.meta.usedFallback) throw new Error(`${name}: unexpected fallback`);
          if (!payload.analysis?.extraction?.provider_name) throw new Error(`${name}: missing provider_name`);
          if (payload.meta.xaiFileDeleted !== true) throw new Error(`${name}: expected delete success`);
          if (name.includes('blurred') && payload.analysis.extraction.extraction_confidence > 0.85) {
            throw new Error(`${name}: expected lower confidence on blurred input`);
          }
        },
      }));
    }

    if (runSendgridLive) {
      if (!process.env.SENDGRID_API_KEY) {
        throw new Error('Missing SENDGRID_API_KEY for live SendGrid scenario');
      }
      results.push(await runMultipartScenario({
        name: 'live_sendgrid_end_to_end',
        filePath: files.pdfLuce,
        fields: buildFields({ consentMarketing: 'false' }),
        validate: (payload) => {
          if (payload.meta.usedFallback) throw new Error('live_sendgrid_end_to_end: unexpected fallback');
          if (payload.meta.emailSent !== true) throw new Error('live_sendgrid_end_to_end: expected emailSent=true');
        },
      }));
    }
  }

  console.log(JSON.stringify({
    mode: runLive ? 'live+mocked' : 'mocked-only',
    sendgridLive: runSendgridLive,
    results: results.map((entry) => ({
      name: entry.name,
      statusCode: entry.statusCode,
      usedFallback: entry.payload?.meta?.usedFallback ?? null,
      provider: entry.payload?.meta?.provider ?? null,
      xaiFileDeleted: entry.payload?.meta?.xaiFileDeleted ?? null,
      emailSent: entry.payload?.meta?.emailSent ?? null,
      summary: entry.payload?.analysis?.explanation?.summary ?? null,
      confidence: entry.payload?.analysis?.extraction?.extraction_confidence ?? null,
      error: entry.payload?.error ?? entry.payload?.reason ?? null,
      skipped: entry.payload?.skipped ?? false,
    })),
  }, null, 2));
} finally {
  globalThis.fetch = realFetch;
}
