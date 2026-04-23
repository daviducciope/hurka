import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyTempCredentials } from './temp-credentials.mjs';

const rootDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mockMode = process.env.MOCK_EXTERNAL_MODE || 'none';
const allowTempCredentials = process.env.ALLOW_TEMP_CREDENTIALS_FILE === '1';
const runSendgridLive = process.env.RUN_SENDGRID_LIVE === '1';

if (allowTempCredentials) {
  applyTempCredentials();
  if (!runSendgridLive) {
    delete process.env.SENDGRID_API_KEY;
  }
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.pdf', 'application/pdf'],
  ['.ico', 'image/x-icon'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const mockStructuredAnalysis = {
  commodity: 'luce',
  provider_name: 'Duferco Energia',
  customer_name: 'Fabio Ciavattella',
  supply_address: 'Via dei Ciclamini 3, Montesilvano PE',
  pod_or_pdr: 'IT001E68567257',
  offer_code: 'OFFERTA-LUCE-TEST',
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
  price_formula_text: 'Prezzo energia e costi di sistema incidono sulla spesa finale.',
  estimated_monthly_cost: 29.11,
  estimated_annual_cost: 349.32,
  extraction_confidence: 0.94,
  summary: 'La bolletta e guidata soprattutto da quota energia, costi di rete e canone TV.',
  main_cost_drivers: ['Quota energia / consumi', 'Trasporto e oneri', 'Altre partite'],
  possible_issues: ['Presenza di canone TV nel totale da pagare'],
  estimated_savings_range: { min: 40, max: 95 },
  confidence_note: 'Documento leggibile e dati principali presenti.',
  cta_recommendation: 'Richiedi una verifica per confrontare l offerta attuale con alternative compatibili.',
};

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init = {}) => {
  if (mockMode === 'none') {
    return realFetch(url, init);
  }

  const target = String(url);

  if (target.includes('api.sendgrid.com')) {
    if (mockMode === 'sendgrid-fail') {
      return makeJsonResponse({ errors: [{ message: 'forced sendgrid failure' }] }, 500);
    }
    return new Response(null, { status: 202 });
  }

  if (!target.startsWith('https://api.x.ai/')) {
    return realFetch(url, init);
  }

  if (target.endsWith('/files') && init.method === 'POST') {
    return makeJsonResponse({ file_id: 'file_browser_test' });
  }

  if (target.endsWith('/responses') && init.method === 'POST') {
    if (mockMode === 'xai-5xx') {
      return makeJsonResponse({ error: 'forced xai failure' }, 502);
    }
    if (mockMode === 'invalid-json') {
      return makeJsonResponse({ output_text: '{invalid' });
    }
    return makeJsonResponse({ output_text: JSON.stringify(mockStructuredAnalysis) });
  }

  if (target.endsWith('/files/file_browser_test') && init.method === 'DELETE') {
    if (mockMode === 'delete-fail') {
      return makeJsonResponse({ deleted: false, id: 'file_browser_test' });
    }
    return makeJsonResponse({ deleted: true, id: 'file_browser_test' });
  }

  return realFetch(url, init);
};

// In mock modes: set a dummy key so the lambda uses the real xAI pipeline path
// (the intercepted fetch above prevents any real API call from reaching x.ai).
// Always override, even if a real key exists in the environment.
if (mockMode !== 'none') {
  process.env.XAI_API_KEY = 'mock-key-browser-test';
}

const { handler } = await import('../../lambda/index.mjs');

function contentTypeFor(filePath) {
  return MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  let targetPath = pathname;
  if (targetPath === '/') targetPath = '/index.html';
  if (targetPath.endsWith('/')) targetPath = `${targetPath}index.html`;

  const safePath = normalize(targetPath).replace(/^(\.\.[/\\])+/, '');
  const absolutePath = join(rootDir, safePath);

  if (!absolutePath.startsWith(rootDir) || !existsSync(absolutePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  let body = await readFile(absolutePath);

  // When serving the beta HTML, override the API base so the browser uses the
  // local server instead of the production endpoint. This prevents local E2E
  // tests from leaking real PDF data to the live Lambda.
  if (absolutePath.endsWith('check-bolletta-beta/index.html')) {
    let html = body.toString('utf8');
    html = html.replace(
      /<meta name="bill-analysis-api-base" content="[^"]*"/,
      '<meta name="bill-analysis-api-base" content=""',
    );
    body = Buffer.from(html, 'utf8');
  }

  res.writeHead(200, { 'content-type': contentTypeFor(absolutePath) });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/api/bill-analysis/upload') {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);

      const event = {
        rawPath: url.pathname,
        path: url.pathname,
        requestContext: { http: { method: req.method, path: url.pathname } },
        headers: req.headers,
        body: rawBody.toString('base64'),
        isBase64Encoded: true,
      };

      const response = await handler(event);
      res.writeHead(response.statusCode || 200, response.headers || {});
      res.end(response.body || '');
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url.pathname);
      return;
    }

    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});

server.listen(port, () => {
  console.log(`HURKA beta server listening on http://127.0.0.1:${port} (mock=${mockMode})`);
});
