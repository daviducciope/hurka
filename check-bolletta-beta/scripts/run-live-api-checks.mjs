import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyTempCredentials } from './temp-credentials.mjs';

applyTempCredentials();

if (!process.env.XAI_API_KEY) {
  throw new Error('Missing XAI_API_KEY');
}

const lambdaUrl = new URL('../../lambda/index.mjs', import.meta.url);
const { uploadFileToXai, analyzeBillWithGrok, deleteXaiFile } = await import(`${lambdaUrl.href}?livecheck=${Date.now()}`);

const filePath = resolve(process.cwd(), 'check-bolletta-beta/docs/00125FT01549423.PDF');
const fileBuffer = readFileSync(filePath);
const originalFetch = globalThis.fetch.bind(globalThis);
const captured = {
  uploadResponseKeys: [],
  analysisRequest: null,
  deleteResponse: null,
};

let liveFileId = '';

try {
  const uploadPayload = await uploadFileToXai(fileBuffer, '00125FT01549423.PDF', 'application/pdf', {
    fetchImpl: async (url, init) => {
      const response = await originalFetch(url, init);
      if (String(url).endsWith('/files') && init.method === 'POST') {
        const clone = response.clone();
        const json = await clone.json();
        captured.uploadResponseKeys = Object.keys(json);
      }
      return response;
    },
  });

  liveFileId = uploadPayload.file_id;

  const analysis = await analyzeBillWithGrok({
    fileId: liveFileId,
    originalFields: {
      nome: 'API Live Check',
      comune: 'Montesilvano',
      commodityHint: 'luce',
    },
  }, {
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/responses') && init.method === 'POST') {
        captured.analysisRequest = JSON.parse(init.body);
      }
      return originalFetch(url, init);
    },
  });

  const deleted = await deleteXaiFile(liveFileId, {
    fetchImpl: async (url, init) => {
      const response = await originalFetch(url, init);
      if (String(url).includes(`/files/${liveFileId}`) && init.method === 'DELETE') {
        captured.deleteResponse = await response.clone().json().catch(() => null);
      }
      return response;
    },
  });

  console.log(JSON.stringify({
    uploadResponseKeys: captured.uploadResponseKeys,
    normalizedFileId: liveFileId,
    analysisRequestChecks: {
      store: captured.analysisRequest?.store,
      model: captured.analysisRequest?.model,
      responseEndpointUsed: true,
      strict: captured.analysisRequest?.text?.format?.strict,
      schemaName: captured.analysisRequest?.text?.format?.name,
      fileIdField: captured.analysisRequest?.input?.[1]?.content?.find((item) => item.type === 'input_file')?.file_id || null,
    },
    analysisSummary: {
      provider_name: analysis.provider_name,
      commodity: analysis.commodity,
      total_amount_eur: analysis.total_amount_eur,
      extraction_confidence: analysis.extraction_confidence,
    },
    deleteCheck: {
      deleted,
      response: captured.deleteResponse,
    },
  }, null, 2));
} finally {
  if (liveFileId && !captured.deleteResponse?.deleted) {
    await deleteXaiFile(liveFileId);
  }
}
