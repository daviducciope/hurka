import {
  BILL_ANALYSIS_JSON_SCHEMA,
  BILL_ANALYSIS_SYSTEM_PROMPT,
  BILL_ANALYSIS_USER_PROMPT,
  XAI_BASE_URL,
  XAI_FILE_PURPOSE,
  XAI_MODEL,
  XAI_TIMEOUT_MS,
  createAnalysisResult,
  normalizeUploadFields,
  validateUploadInput,
} from '../check-bolletta-beta/bill-analysis-core.mjs';
import { rankHurkaOffersForBill } from '../check-bolletta-beta/offer-matcher.mjs';
import { computeLeadScore } from '../check-bolletta-beta/lead-scoring.mjs';
import { buildCustomerEmail, buildInternalLeadEmail } from '../check-bolletta-beta/email-templates.mjs';
import { createHash, createHmac } from 'node:crypto';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || 'info@smartconitalia.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@hurka.it';
const FROM_NAME = process.env.FROM_NAME || 'HURKA!';
const INBOUND_WEBHOOK_TOKEN = process.env.INBOUND_WEBHOOK_TOKEN || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const BILL_ANALYSIS_PROVIDER = XAI_API_KEY ? 'xai' : 'mock';
const DAILY_FREE_ANALYSIS_LIMIT = Number.parseInt(process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT || '3', 10);
const BILL_ANALYSIS_QUOTA_TABLE = process.env.BILL_ANALYSIS_QUOTA_TABLE || '';
const BILL_ANALYSIS_QUOTA_SALT = process.env.BILL_ANALYSIS_QUOTA_SALT || 'hurka-bill-analysis';
const BILL_ANALYSIS_SUBSCRIPTION_URL = process.env.BILL_ANALYSIS_SUBSCRIPTION_URL || 'https://hurka.it/contatti.html';
const PREMIUM_ACCESS_TOKENS = new Set(
  String(process.env.BILL_ANALYSIS_PREMIUM_TOKENS || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean),
);
const localQuotaStore = new Map();

// CORS headers are managed at API Gateway level.
// Only Content-Type is needed here; ACAO headers come from the gateway.
const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

function makePublicError(message, { statusCode = 500, code = 'internal_error', cause } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = code;
  if (cause) error.cause = cause;
  return error;
}

function res(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function getHeader(headers, name) {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] || '' : value || '';
    }
  }
  return '';
}

function sha256(value, encoding = 'hex') {
  return createHash('sha256').update(String(value)).digest(encoding);
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function getRomeDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function getSourceIp(event) {
  const forwarded = getHeader(event.headers, 'x-forwarded-for').split(',')[0]?.trim();
  return forwarded || event?.requestContext?.http?.sourceIp || event?.requestContext?.identity?.sourceIp || '';
}

function getQuotaIdentifier({ fields, event }) {
  const email = String(fields.email || '').trim().toLowerCase();
  const phone = String(fields.telefono || '').replace(/[^\d+]/g, '');
  const ip = getSourceIp(event);
  return email || phone || ip || 'anonymous';
}

function getAccessToken(fields = {}) {
  return String(fields.subscriptionToken || fields.accessToken || fields.premiumToken || '').trim();
}

function hasPremiumAccess(fields = {}) {
  const token = getAccessToken(fields);
  return Boolean(token && PREMIUM_ACCESS_TOKENS.has(token));
}

function buildQuotaKey({ fields, event, day = getRomeDay() }) {
  const identifier = getQuotaIdentifier({ fields, event });
  const digest = sha256(`${BILL_ANALYSIS_QUOTA_SALT}:${identifier}`);
  return {
    pk: `bill-analysis#${digest}`,
    day,
  };
}

function checkLocalQuota({ fields, event, limit = DAILY_FREE_ANALYSIS_LIMIT }) {
  if (hasPremiumAccess(fields) || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, limit, remaining: null, premium: hasPremiumAccess(fields), backend: 'disabled' };
  }

  const { pk, day } = buildQuotaKey({ fields, event });
  const key = `${pk}:${day}`;
  const current = localQuotaStore.get(key) || 0;
  if (current >= limit) {
    return { allowed: false, limit, remaining: 0, count: current, premium: false, backend: 'memory' };
  }
  const next = current + 1;
  localQuotaStore.set(key, next);
  return { allowed: true, limit, remaining: Math.max(limit - next, 0), count: next, premium: false, backend: 'memory' };
}

function getAwsCredentialScope({ dateStamp, region, service }) {
  return `${dateStamp}/${region}/${service}/aws4_request`;
}

function getAwsSigningKey({ secretAccessKey, dateStamp, region, service }) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function signAwsJsonRequest({ method, url, region, service, target, body }) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials for DynamoDB quota');
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(url).host;
  const headers = {
    'content-type': 'application/x-amz-json-1.0',
    host,
    'x-amz-date': amzDate,
    'x-amz-target': target,
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(body),
  ].join('\n');
  const credentialScope = getAwsCredentialScope({ dateStamp, region, service });
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
  const signingKey = getAwsSigningKey({ secretAccessKey, dateStamp, region, service });
  const signature = hmac(signingKey, stringToSign, 'hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function incrementDynamoQuota({ fields, event, limit = DAILY_FREE_ANALYSIS_LIMIT, fetchImpl = fetch }) {
  if (hasPremiumAccess(fields) || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, limit, remaining: null, premium: hasPremiumAccess(fields), backend: 'disabled' };
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1';
  const endpoint = `https://dynamodb.${region}.amazonaws.com/`;
  const { pk, day } = buildQuotaKey({ fields, event });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    TableName: BILL_ANALYSIS_QUOTA_TABLE,
    Key: {
      pk: { S: pk },
      day: { S: day },
    },
    UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :ttl, updatedAt = :now',
    ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
    ExpressionAttributeNames: {
      '#count': 'count',
    },
    ExpressionAttributeValues: {
      ':zero': { N: '0' },
      ':one': { N: '1' },
      ':limit': { N: String(limit) },
      ':ttl': { N: String(now + 60 * 60 * 48) },
      ':now': { N: String(now) },
    },
    ReturnValues: 'UPDATED_NEW',
  });
  const headers = signAwsJsonRequest({
    method: 'POST',
    url: endpoint,
    region,
    service: 'dynamodb',
    target: 'DynamoDB_20120810.UpdateItem',
    body,
  });

  const response = await fetchImpl(endpoint, { method: 'POST', headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload?.__type?.includes('ConditionalCheckFailedException')) {
      return { allowed: false, limit, remaining: 0, premium: false, backend: 'dynamodb' };
    }
    throw new Error(`DynamoDB quota failed (${response.status})`);
  }

  const count = Number(payload?.Attributes?.count?.N || 0);
  return { allowed: true, limit, remaining: Math.max(limit - count, 0), count, premium: false, backend: 'dynamodb' };
}

async function checkDailyQuota({ fields, event, options = {} }) {
  if (BILL_ANALYSIS_QUOTA_TABLE) {
    return incrementDynamoQuota({ fields, event, fetchImpl: options.fetchImpl || fetch });
  }
  return checkLocalQuota({ fields, event });
}

function decodeBody(event) {
  if (!event?.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function decodeBodyBuffer(event) {
  if (!event?.body) return Buffer.from('');
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64');
  return Buffer.from(event.body, 'utf8');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmailAddress(value) {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function parseMultipartFormData(body, contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error('Missing multipart boundary');
  }

  const boundary = `--${match[1] || match[2]}`;
  const parts = String(body || '').split(boundary).slice(1, -1);
  const fields = {};

  for (const part of parts) {
    const trimmedPart = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const separatorIndex = trimmedPart.indexOf('\r\n\r\n');
    if (separatorIndex === -1) continue;

    const rawHeaders = trimmedPart.slice(0, separatorIndex);
    let value = trimmedPart.slice(separatorIndex + 4);
    value = value.replace(/\r\n$/, '');

    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    fields[nameMatch[1]] = value;
  }

  return fields;
}

function parseMultipartBuffer(buffer, contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error('Missing multipart boundary');
  }

  const boundary = `--${match[1] || match[2]}`;
  const raw = buffer.toString('latin1');
  const parts = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (const part of parts) {
    const trimmedPart = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const separatorIndex = trimmedPart.indexOf('\r\n\r\n');
    if (separatorIndex === -1) continue;

    const rawHeaders = trimmedPart.slice(0, separatorIndex);
    let bodyChunk = trimmedPart.slice(separatorIndex + 4);
    bodyChunk = bodyChunk.replace(/\r\n$/, '');

    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    const fieldName = nameMatch[1];
    const fileNameMatch = rawHeaders.match(/filename="([^"]*)"/i);
    const typeMatch = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);

    if (fileNameMatch && fileNameMatch[1]) {
      const data = Buffer.from(bodyChunk, 'latin1');
      files.push({
        fieldName,
        name: fileNameMatch[1],
        type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
        data,
        size: data.byteLength,
      });
      continue;
    }

    fields[fieldName] = Buffer.from(bodyChunk, 'latin1').toString('utf8');
  }

  return { fields, files };
}

function getRequestPath(event) {
  return event?.rawPath || event?.path || event?.requestContext?.http?.path || '';
}

function isBillAnalysisRoute(event) {
  return getRequestPath(event).includes('/api/bill-analysis/upload');
}

function createAbortSignal(timeoutMs = XAI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function mapToFileInputItem(fileId) {
  return {
    type: 'input_file',
    file_id: fileId,
  };
}

function extractStructuredOutput(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Empty xAI response payload');
  }

  const outputText = typeof payload.output_text === 'string' ? payload.output_text.trim() : '';
  if (outputText) return JSON.parse(outputText);

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        return JSON.parse(part.text);
      }
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return JSON.parse(part.text);
      }
      if (part?.type === 'json_schema' && part?.json && typeof part.json === 'object') {
        return part.json;
      }
    }
  }

  throw new Error('Structured JSON not found in xAI response');
}

function buildXaiHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
  };
}

function getUploadedFileId(payload) {
  const fileId = payload?.file_id || payload?.id || '';
  if (!fileId) {
    throw new Error('xAI Files upload did not return file_id or id');
  }
  return String(fileId);
}

export async function uploadFileToXai(fileBuffer, fileName, mimeType, options = {}) {
  const apiKey = options.apiKey || XAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing XAI_API_KEY');
  }

  const endpoint = `${options.baseUrl || XAI_BASE_URL}/files`;
  const form = new FormData();
  form.append('purpose', options.purpose || XAI_FILE_PURPOSE);
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);

  const { signal, clear } = createAbortSignal(options.timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: 'POST',
      headers: buildXaiHeaders(apiKey),
      body: form,
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`xAI Files upload failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    const payload = await response.json();
    return {
      ...payload,
      file_id: getUploadedFileId(payload),
    };
  } finally {
    clear();
  }
}

export async function analyzeBillWithGrok({ fileId, originalFields }, options = {}) {
  const apiKey = options.apiKey || XAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing XAI_API_KEY');
  }

  const endpoint = `${options.baseUrl || XAI_BASE_URL}/responses`;
  const normalizedFields = normalizeUploadFields(originalFields);
  const body = {
    model: options.model || XAI_MODEL,
    store: false,
    temperature: 0,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: BILL_ANALYSIS_SYSTEM_PROMPT,
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              BILL_ANALYSIS_USER_PROMPT,
              '',
              'Contesto aggiuntivo fornito dal form:',
              JSON.stringify({
                nome: normalizedFields.nome || null,
                comune: normalizedFields.comune || null,
                commodityHint: normalizedFields.commodityHint || null,
              }),
              '',
              'Leggi prima il file allegato e usa il contesto solo come supporto secondario.',
            ].join('\n'),
          },
          mapToFileInputItem(fileId),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        ...BILL_ANALYSIS_JSON_SCHEMA,
      },
    },
  };

  const { signal, clear } = createAbortSignal(options.timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: 'POST',
      headers: {
        ...buildXaiHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`xAI analysis failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    const payload = await response.json();
    return extractStructuredOutput(payload);
  } finally {
    clear();
  }
}

export async function deleteXaiFile(fileId, options = {}) {
  const apiKey = options.apiKey || XAI_API_KEY;
  if (!apiKey || !fileId) return false;

  const endpoint = `${options.baseUrl || XAI_BASE_URL}/files/${fileId}`;
  const { signal, clear } = createAbortSignal(options.timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: 'DELETE',
      headers: buildXaiHeaders(apiKey),
      signal,
    });
    if (!response.ok) return false;
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (!contentType.includes('application/json')) return true;
    const payload = await response.json().catch(() => null);
    return payload?.deleted !== false;
  } catch {
    return false;
  } finally {
    clear();
  }
}

async function runBillAnalysisPipeline({ fields, file, fileBuffer }, options = {}) {
  if (!XAI_API_KEY) {
    throw makePublicError('Servizio AI reale non configurato.', {
      statusCode: 503,
      code: 'missing_xai_config',
    });
  }

  let uploadedFileId = '';
  let fileDeleted = null;

  try {
    const uploadedFile = await uploadFileToXai(fileBuffer, file.name, file.type, options);
    uploadedFileId = uploadedFile.file_id;

    const structured = await analyzeBillWithGrok({
      fileId: uploadedFileId,
      originalFields: fields,
    }, options);

    const analysis = createAnalysisResult({
      rawAnalysis: structured,
      meta: {
        fileName: file.name,
        fileSize: file.size,
        mode: 'live',
        provider: 'xai',
        usedFallback: false,
      },
    });

    return {
      analysis,
      meta: {
        usedFallback: false,
        provider: 'xai',
        fallbackReason: '',
        uploadedFileId,
        xaiFileDeleted: false,
      },
    };
  } catch (error) {
    throw makePublicError('Analisi AI reale non disponibile in questo momento.', {
      statusCode: 502,
      code: 'xai_error',
      cause: error,
    });
  } finally {
    if (uploadedFileId) {
      fileDeleted = await deleteXaiFile(uploadedFileId, options);
    }
    if (options.onCleanup) {
      options.onCleanup({ uploadedFileId, xaiFileDeleted: fileDeleted });
    }
  }
}

function roundToNearest(value, step, mode = 'round') {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  return fn(normalized / step) * step;
}

function buildSalesOpportunity({ analysis, offerMatch }) {
  const confidence = Number(analysis?.extraction?.extraction_confidence || 0);

  if (offerMatch?.hasMatch && offerMatch.topOffer?.savings?.annual > 0) {
    const annual = Number(offerMatch.topOffer.savings.annual || 0);
    const min = Math.max(30, roundToNearest(annual * 0.72, 10, 'floor'));
    const max = Math.max(min + 20, roundToNearest(annual, 10, 'ceil'));
    const status = annual >= 180 ? 'high-saving' : 'possible-saving';

    return {
      status,
      hasSavingOpportunity: true,
      savingsRange: { min, max },
      benchmarkSource: 'cte_hurka',
      confidence,
      headline: status === 'high-saving'
        ? 'La bolletta mostra un margine di risparmio interessante.'
        : 'La bolletta mostra un possibile margine di risparmio.',
      summary: 'Il range deriva dal confronto tra la spesa materia letta in bolletta e le condizioni economiche disponibili nel catalogo HURKA. I dettagli dell offerta vengono confermati da un consulente prima di qualunque cambio.',
      nextStep: 'Prenota una verifica gratuita: ti confermiamo i numeri e, solo se conviene davvero, ti proponiamo la soluzione adatta.',
    };
  }

  const reason = String(offerMatch?.noMatchReason || '');
  const lowConfidence = confidence < 0.60 || /confidenza|insufficien|non identificat|dati insufficien/i.test(reason);

  if (lowConfidence) {
    return {
      status: 'assisted-review',
      hasSavingOpportunity: false,
      savingsRange: { min: 0, max: 0 },
      benchmarkSource: 'assisted_review',
      confidence,
      headline: 'Serve una verifica assistita.',
      summary: reason || 'I dati letti non bastano per stimare un risparmio serio senza controllo umano.',
      nextStep: 'Fissa una verifica con un consulente HURKA per leggere la bolletta senza rischiare conclusioni sbagliate.',
    };
  }

  return {
    status: 'limited-saving',
    hasSavingOpportunity: false,
    savingsRange: { min: 0, max: 0 },
    benchmarkSource: 'cte_hurka',
    confidence,
    headline: 'Al momento non emerge un risparmio abbastanza forte.',
    summary: reason || 'Il confronto con le condizioni disponibili non mostra un margine commerciale credibile.',
    nextStep: 'Possiamo comunque controllare potenza, clausole e struttura della spesa per capire se ci sono anomalie.',
  };
}

function buildClientAnalysis(analysis, salesOpportunity) {
  return {
    ...analysis,
    salesOpportunity,
    offerMatch: undefined,
  };
}

async function handleBillAnalysisUpload(event, options = {}) {
  const contentType = getHeader(event.headers, 'content-type');
  let fields = {};
  let file = null;
  let fileBuffer = null;

  if (contentType.includes('multipart/form-data')) {
    const parsed = parseMultipartBuffer(decodeBodyBuffer(event), contentType);
    fields = parsed.fields;
    const uploaded = parsed.files.find((entry) => entry.fieldName === 'billFile') || parsed.files[0];
    if (uploaded) {
      file = { name: uploaded.name, type: uploaded.type, size: uploaded.size };
      fileBuffer = uploaded.data;
    }
  } else {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    fields = body?.fields || {};
    file = body?.file || null;
  }

  const validation = validateUploadInput({ fields, file });
  if (!validation.isValid) {
    return res(400, { error: validation.errors[0], errors: validation.errors });
  }

  if (!fileBuffer) {
    return res(400, { error: 'Upload file mancante o non leggibile.' });
  }

  let quota = null;
  try {
    quota = await checkDailyQuota({ fields: validation.fields, event, options });
  } catch (error) {
    console.error('Bill analysis quota error:', error);
    return res(503, {
      error: 'Controllo limite giornaliero non disponibile. Riprova tra poco.',
      code: 'quota_unavailable',
    });
  }

  if (!quota.allowed) {
    return res(429, {
      error: `Hai usato le ${quota.limit} analisi gratuite disponibili oggi.`,
      code: 'daily_quota_exceeded',
      quota: {
        limit: quota.limit,
        remaining: 0,
        reset: 'Domani',
      },
      subscription: {
        required: true,
        url: BILL_ANALYSIS_SUBSCRIPTION_URL,
        message: 'Sblocca altre comparazioni con un abbonamento HURKA.',
      },
    });
  }

  let cleanupMeta = { uploadedFileId: '', xaiFileDeleted: null };
  let pipeline = null;

  try {
    pipeline = await runBillAnalysisPipeline({
      fields: validation.fields,
      file,
      fileBuffer,
    }, {
      ...options,
      onCleanup: (meta) => {
        cleanupMeta = meta;
        if (typeof options.onCleanup === 'function') options.onCleanup(meta);
      },
    });
  } catch (error) {
    const statusCode = error?.statusCode || 502;
    console.error('Bill analysis AI error:', error?.cause || error);
    return res(statusCode, {
      error: error?.message || 'Analisi AI reale non disponibile.',
      code: error?.publicCode || 'xai_error',
      meta: {
        usedFallback: false,
        provider: XAI_API_KEY ? 'xai' : 'none',
        fallbackReason: '',
        xaiFileDeleted: cleanupMeta.xaiFileDeleted,
      },
    });
  }

  if (cleanupMeta.uploadedFileId) {
    pipeline.analysis.meta.xaiFileDeleted = cleanupMeta.xaiFileDeleted;
  }

  // Offer matching: deterministic, based on CTE data + extracted bill numbers
  const offerMatch = rankHurkaOffersForBill(pipeline.analysis, {
    preferenceType: validation.fields.preferenza || 'risparmio',
    commodityOverride: validation.fields.commodityHint || undefined,
  });
  pipeline.analysis.offerMatch = offerMatch;
  pipeline.analysis.salesOpportunity = buildSalesOpportunity({
    analysis: pipeline.analysis,
    offerMatch,
  });

  // Lead scoring
  const leadScore = computeLeadScore(pipeline.analysis, {
    phoneValid: Boolean(validation.fields.telefono),
    emailProvided: Boolean(validation.fields.email),
    answeredQuestions: Boolean(validation.fields.preferenza && validation.fields.commodityHint),
    consentMarketing: validation.fields.consentMarketing,
    whatsappClicked: false,
    callbackRequested: false,
  });

  let emailSent = false;
  let customerEmailSent = false;

  try {
    // Internal notification with full lead data
    const internal = buildInternalLeadEmail({
      fields: validation.fields,
      file,
      analysis: pipeline.analysis,
      leadScore,
      offerMatch,
    });
    await sendEmail({
      personalizations: [{ to: [{ email: TO_EMAIL }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: validation.fields.email ? { email: validation.fields.email, name: validation.fields.nome } : undefined,
      subject: internal.subject,
      content: [
        { type: 'text/plain', value: internal.text },
        { type: 'text/html', value: internal.html },
      ],
    });
    emailSent = true;
  } catch {
    console.warn('Internal lead notification failed');
  }

  // Customer confirmation email (only if email was provided)
  if (validation.fields.email) {
    try {
      const customer = buildCustomerEmail({
        nome: validation.fields.nome,
        commodity: pipeline.analysis.extraction?.commodity || validation.fields.commodityHint,
        salesOpportunity: pipeline.analysis.salesOpportunity,
        offerMatch,
        consentMarketing: validation.fields.consentMarketing,
      });
      await sendEmail({
        personalizations: [{ to: [{ email: validation.fields.email, name: validation.fields.nome }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        reply_to: { email: TO_EMAIL, name: FROM_NAME },
        subject: customer.subject,
        content: [
          { type: 'text/plain', value: customer.text },
          { type: 'text/html', value: customer.html },
        ],
      });
      customerEmailSent = true;
    } catch {
      console.warn('Customer confirmation email failed');
    }
  }

  return res(200, {
    message: 'Analisi completata',
    analysis: buildClientAnalysis(pipeline.analysis, pipeline.analysis.salesOpportunity),
    meta: {
      usedFallback: Boolean(pipeline.meta?.usedFallback),
      provider: pipeline.meta?.provider || BILL_ANALYSIS_PROVIDER,
      fallbackReason: pipeline.meta?.fallbackReason || '',
      xaiFileDeleted: pipeline.analysis.meta?.xaiFileDeleted,
      emailSent,
      customerEmailSent,
      leadScoreClass: leadScore.class,
      quota: quota ? {
        limit: quota.limit,
        remaining: quota.remaining,
        premium: quota.premium,
        backend: quota.backend,
      } : null,
    },
  });
}

async function handleInboundEmail(event) {
  const token = event?.queryStringParameters?.inboundToken || '';
  if (!INBOUND_WEBHOOK_TOKEN || token !== INBOUND_WEBHOOK_TOKEN) {
    return res(401, { error: 'Unauthorized inbound webhook' });
  }

  const contentType = getHeader(event.headers, 'content-type');
  const fields = parseMultipartFormData(decodeBody(event), contentType);
  const inboundTo = fields.to || '';
  const inboundFrom = fields.from || '';
  const subject = fields.subject || '(senza oggetto)';
  const textBody = fields.text || '';
  const htmlBody = fields.html || '';
  const originalRecipient = FROM_EMAIL.toLowerCase();

  if (!inboundTo.toLowerCase().includes(originalRecipient)) {
    return res(202, { message: 'Inbound email ignored' });
  }

  const replyToEmail = extractEmailAddress(inboundFrom);
  const normalizedText = textBody || stripHtml(htmlBody) || '(messaggio vuoto)';
  const notifyHtml = `
    <div style="font-family:sans-serif;max-width:720px;margin:0 auto;color:#333;">
      <div style="background:#203863;padding:24px 32px;">
        <h1 style="margin:0;color:#fae04a;font-size:24px;letter-spacing:1px;">Nuova email ricevuta su ${escapeHtml(FROM_EMAIL)}</h1>
      </div>
      <div style="padding:24px 32px;background:#ffffff;">
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;width:140px;">Da</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${escapeHtml(inboundFrom)}</td></tr>
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">A</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${escapeHtml(inboundTo)}</td></tr>
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Oggetto</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${escapeHtml(subject)}</td></tr>
        </table>
        <div style="margin-top:24px;padding:20px;background:#f8f7f4;border-left:4px solid #fae04a;border-radius:4px;white-space:pre-wrap;">${escapeHtml(normalizedText)}</div>
      </div>
    </div>`;

  await sendEmail({
    personalizations: [{ to: [{ email: TO_EMAIL }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: replyToEmail ? { email: replyToEmail } : undefined,
    subject: `[HURKA! Inbox] ${subject}`,
    content: [
      {
        type: 'text/plain',
        value: `Nuova email ricevuta su ${FROM_EMAIL}\nDa: ${inboundFrom}\nA: ${inboundTo}\nOggetto: ${subject}\n\n${normalizedText}`,
      },
      { type: 'text/html', value: notifyHtml },
    ],
  });

  return res(200, { message: 'Inbound email forwarded' });
}

async function sendEmail(payload, options = {}) {
  if (!SENDGRID_API_KEY) {
    throw new Error('Missing SENDGRID_API_KEY');
  }

  const response = await (options.fetchImpl || fetch)('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SendGrid ${response.status}: ${detail}`);
  }
}

export async function handler(event) {
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return res(200, { message: 'OK' });
  }

  try {
    if (isBillAnalysisRoute(event)) {
      return await handleBillAnalysisUpload(event);
    }

    const contentType = getHeader(event.headers, 'content-type');
    if (contentType.includes('multipart/form-data')) {
      return await handleInboundEmail(event);
    }

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { servizio, nome, email, telefono, messaggio } = body || {};

    if (!nome || !email || !messaggio) {
      return res(400, { error: 'Campi obbligatori: nome, email, messaggio' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res(400, { error: 'Email non valida' });
    }

    const notifyHtml = `
      <h2 style="color:#203863;">Nuova richiesta dal sito HURKA!</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;">
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Servizio</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${servizio || 'Non specificato'}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Nome</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${nome}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Email</td><td style="padding:10px 12px;border:1px solid #e0e0e0;"><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Telefono</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${telefono || 'Non fornito'}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Messaggio</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${messaggio}</td></tr>
      </table>`;

    await sendEmail({
      personalizations: [{ to: [{ email: TO_EMAIL }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email, name: nome },
      subject: `[HURKA!] Richiesta da ${nome} - ${servizio || 'Generale'}`,
      content: [
        { type: 'text/plain', value: `Nuova richiesta:\nServizio: ${servizio}\nNome: ${nome}\nEmail: ${email}\nTelefono: ${telefono || '-'}\n\n${messaggio}` },
        { type: 'text/html', value: notifyHtml },
      ],
    });

    const replyHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;">
        <div style="background:#203863;padding:24px 32px;text-align:center;">
          <h1 style="color:#fae04a;margin:0;font-size:28px;letter-spacing:2px;">HURKA!</h1>
        </div>
        <div style="padding:32px;background:#ffffff;">
          <p style="font-size:16px;">Ciao <strong>${nome}</strong>,</p>
          <p style="font-size:15px;line-height:1.6;">
            grazie per averci contattato! Abbiamo ricevuto la tua richiesta riguardo a
            <strong>${servizio || 'i nostri servizi'}</strong>.
          </p>
          <p style="font-size:15px;line-height:1.6;">
            Il nostro team la sta gia analizzando. Ti ricontatteremo il prima possibile con
            una <strong>prima valutazione tecnica</strong> del tuo caso.
          </p>
          <div style="margin:28px 0;padding:20px;background:#f8f7f4;border-left:4px solid #fae04a;border-radius:4px;">
            <p style="margin:0;font-size:14px;color:#555;">
              <strong>La tua richiesta:</strong><br/>
              ${messaggio}
            </p>
          </div>
          <p style="font-size:15px;line-height:1.6;">
            Nel frattempo, se hai bisogno puoi rispondere direttamente a questa email.
          </p>
          <p style="font-size:15px;margin-top:24px;">
            A presto,<br/>
            <strong style="color:#203863;">Il team HURKA!</strong>
          </p>
        </div>
        <div style="background:#203863;padding:16px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,.5);">
            HURKA! - Consulenza Energetica Integrata<br/>
            <a href="https://hurka.it" style="color:#fae04a;text-decoration:none;">hurka.it</a>
          </p>
        </div>
      </div>`;

    await sendEmail({
      personalizations: [{ to: [{ email, name: nome }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email: TO_EMAIL, name: 'HURKA! Team' },
      subject: `Grazie ${nome}! Abbiamo ricevuto la tua richiesta - HURKA!`,
      content: [
        { type: 'text/plain', value: `Ciao ${nome},\n\ngrazie per averci contattato! Abbiamo ricevuto la tua richiesta riguardo a ${servizio || 'i nostri servizi'}.\n\nIl nostro team la sta gia analizzando e ti ricontattera il prima possibile.\n\nLa tua richiesta:\n${messaggio}\n\nA presto,\nIl team HURKA!\nhurka.it` },
        { type: 'text/html', value: replyHtml },
      ],
    });

    return res(200, { message: 'Richiesta inviata con successo! Controlla la tua email per la conferma.' });
  } catch (err) {
    console.error('Lambda error:', err);
    return res(500, { error: "Errore nell'invio. Riprova piu tardi." });
  }
}
