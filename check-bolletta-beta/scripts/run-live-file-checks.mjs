import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import { applyTempCredentials } from './temp-credentials.mjs';

applyTempCredentials();
delete process.env.SENDGRID_API_KEY;

if (!process.env.XAI_API_KEY) {
  throw new Error('Missing XAI_API_KEY');
}

const lambdaUrl = new URL('../../lambda/index.mjs', import.meta.url);
const { handler } = await import(`${lambdaUrl.href}?livefiles=${Date.now()}`);

const files = [
  ['pdf_luce_duferco', 'check-bolletta-beta/docs/00125FT01549423.PDF', 'luce'],
  ['pdf_luce_edison', 'check-bolletta-beta/docs/Edison_6109011896_dettagliata.pdf', 'luce'],
  ['png_readable', 'check-bolletta-beta/fixtures/generated/luce-readable.png', 'luce'],
  ['jpg_readable', 'check-bolletta-beta/fixtures/generated/luce-readable.jpg', 'luce'],
  ['png_blurred_partial', 'check-bolletta-beta/fixtures/generated/luce-blurred-partial.png', 'luce'],
  ['cte_pdf', 'check-bolletta-beta/docs/EE_FIX_FAMILY_RAP.pdf', 'unknown'],
  ['pdf_gas', 'check-bolletta-beta/docs/gas-sample.pdf', 'gas'],
];

function detectMime(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function buildEvent({ filePath, commodityHint }) {
  const boundary = '----hurka-live-batch';
  const buffer = readFileSync(filePath);
  const fields = {
    nome: 'Live Batch',
    telefono: '+393331234567',
    email: 'live-batch@example.com',
    comune: 'Pescara',
    commodityHint,
    consentAnalysis: 'true',
    consentMarketing: 'false',
  };
  const segments = [];

  for (const [name, value] of Object.entries(fields)) {
    segments.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf8',
    ));
  }

  segments.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="billFile"; filename="${basename(filePath)}"\r\nContent-Type: ${detectMime(filePath)}\r\n\r\n`,
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

for (const [name, relativePath, commodityHint] of files) {
  const filePath = resolve(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    console.log(JSON.stringify({ name, skipped: true, reason: 'missing file' }));
    continue;
  }

  const response = await handler(buildEvent({ filePath, commodityHint }));
  const payload = JSON.parse(response.body);

  console.log(JSON.stringify({
    name,
    statusCode: response.statusCode,
    usedFallback: payload.meta?.usedFallback ?? null,
    provider: payload.analysis?.extraction?.provider_name ?? null,
    commodity: payload.analysis?.extraction?.commodity ?? null,
    confidence: payload.analysis?.extraction?.extraction_confidence ?? null,
    xaiFileDeleted: payload.meta?.xaiFileDeleted ?? null,
    emailSent: payload.meta?.emailSent ?? null,
    summary: payload.analysis?.explanation?.summary?.slice(0, 140) ?? null,
    error: payload.error ?? null,
  }));
}
