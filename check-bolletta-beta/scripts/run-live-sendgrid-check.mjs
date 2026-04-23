import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { applyTempCredentials } from './temp-credentials.mjs';

applyTempCredentials();

if (!process.env.XAI_API_KEY || !process.env.SENDGRID_API_KEY) {
  throw new Error('Missing XAI_API_KEY or SENDGRID_API_KEY');
}

const lambdaUrl = new URL('../../lambda/index.mjs', import.meta.url);
const { handler } = await import(`${lambdaUrl.href}?livesendgrid=${Date.now()}`);

const filePath = resolve(process.cwd(), 'check-bolletta-beta/docs/00125FT01549423.PDF');
const fileBuffer = readFileSync(filePath);
const boundary = '----hurka-sendgrid-check';
const fields = {
  nome: 'Live SendGrid Check',
  telefono: '+393331234567',
  email: 'live-sendgrid@example.com',
  comune: 'Pescara',
  commodityHint: 'luce',
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
  `--${boundary}\r\nContent-Disposition: form-data; name="billFile"; filename="${basename(filePath)}"\r\nContent-Type: application/pdf\r\n\r\n`,
  'utf8',
));
segments.push(fileBuffer);
segments.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

const response = await handler({
  rawPath: '/api/bill-analysis/upload',
  path: '/api/bill-analysis/upload',
  requestContext: { http: { method: 'POST', path: '/api/bill-analysis/upload' } },
  headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  body: Buffer.concat(segments).toString('base64'),
  isBase64Encoded: true,
});

const payload = JSON.parse(response.body);
console.log(JSON.stringify({
  statusCode: response.statusCode,
  usedFallback: payload.meta?.usedFallback ?? null,
  provider: payload.meta?.provider ?? null,
  xaiFileDeleted: payload.meta?.xaiFileDeleted ?? null,
  emailSent: payload.meta?.emailSent ?? null,
  commodity: payload.analysis?.extraction?.commodity ?? null,
  total_amount_eur: payload.analysis?.extraction?.total_amount_eur ?? null,
  summary: payload.analysis?.explanation?.summary?.slice(0, 160) ?? null,
}, null, 2));
