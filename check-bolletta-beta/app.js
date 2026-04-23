import {
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
  createMockAnalysis,
  validateUploadInput,
} from './bill-analysis-core.mjs';
import { buildAnalysisMarkup } from './ui-core.mjs';

const doc = typeof document !== 'undefined' ? document : null;

const form = doc?.querySelector('[data-bill-form]') || null;
const feedback = doc?.querySelector('[data-form-feedback]') || null;
const submitButton = doc?.querySelector('[data-submit-button]') || null;
const resultPanel = doc?.querySelector('[data-result-panel]') || null;
const resultState = doc?.querySelector('[data-result-state]') || null;
const resultContent = doc?.querySelector('[data-result-content]') || null;
const exampleButton = doc?.querySelector('[data-example-button]') || null;
const uploadInput = doc?.querySelector('#bill-file') || null;
const uploadHint = doc?.querySelector('[data-upload-hint]') || null;
const progressNodes = Array.from(doc?.querySelectorAll('[data-progress-step]') || []);
const LOCAL_API_PORT = '4173';
const defaultResultStateMarkup = resultState?.innerHTML || '';

function trackEvent(eventName, params = {}) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: eventName, ...params });
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }
}

function setProgress(step) {
  progressNodes.forEach((node) => {
    node.dataset.active = String(node.dataset.progressStep === step);
  });
}

function setFeedback(message, tone = 'neutral') {
  if (!feedback) return;
  feedback.hidden = !message;
  feedback.textContent = message || '';
  feedback.dataset.tone = tone;
}

function setSubmitting(isSubmitting) {
  if (!submitButton) return;
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? 'Analisi in corso...' : 'Carica bolletta';
}

function getFormFields() {
  const formData = new FormData(form);
  return {
    nome: formData.get('nome'),
    telefono: formData.get('telefono'),
    email: formData.get('email'),
    comune: formData.get('comune'),
    commodityHint: formData.get('commodityHint'),
    consentAnalysis: formData.get('consentAnalysis'),
    consentMarketing: formData.get('consentMarketing'),
  };
}

function normalizeApiBase(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  return normalized || '';
}

function getConfiguredApiBase() {
  if (typeof window === 'undefined') return '';
  const windowValue = normalizeApiBase(window.HURKA_BILL_ANALYSIS_API_BASE);
  if (windowValue) return windowValue;

  const metaValue = normalizeApiBase(
    doc?.querySelector('meta[name="bill-analysis-api-base"]')?.getAttribute('content'),
  );
  if (metaValue) return metaValue;

  return normalizeApiBase(form?.dataset.apiBase);
}

function buildApiCandidates() {
  const candidates = [];
  const configuredBase = getConfiguredApiBase();
  if (configuredBase) {
    candidates.push(`${configuredBase}/api/bill-analysis/upload`);
  }

  if (typeof window !== 'undefined') {
    candidates.push(new URL('/api/bill-analysis/upload', window.location.origin).toString());

    const isLocalhost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const isStaticDevPort = window.location.port && window.location.port !== LOCAL_API_PORT;
    if (isLocalhost && isStaticDevPort) {
      candidates.push(`http://127.0.0.1:${LOCAL_API_PORT}/api/bill-analysis/upload`);
      candidates.push(`http://localhost:${LOCAL_API_PORT}/api/bill-analysis/upload`);
    }
  } else {
    candidates.push('/api/bill-analysis/upload');
  }

  return [...new Set(candidates)];
}

async function postBillAnalysis(body) {
  const candidates = buildApiCandidates();
  let lastError = null;

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, { method: 'POST', body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload.error || `HTTP ${response.status}`;
        throw new Error(`${endpoint} -> ${detail}`);
      }
      return { endpoint, payload };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('Analisi non disponibile.');
}

function renderAnalysis(analysis, { fallback = false } = {}) {
  if (!resultState || !resultContent) return;
  resultState.hidden = true;
  resultContent.hidden = false;
  resultContent.innerHTML = buildAnalysisMarkup(analysis, { fallback });
}

function showLoadingState(fileName) {
  if (!resultState || !resultContent) return;
  resultContent.hidden = true;
  resultState.hidden = false;
  resultState.innerHTML = `
    <div class="loading-shell">
      <div class="ai-badge"><span class="ai-spinner" aria-hidden="true"></span>AI HURKA in elaborazione</div>
      <h3 style="font-size:2rem;color:var(--navy);margin-top:1rem;">Stiamo analizzando la bolletta</h3>
      <p style="max-width:38ch;margin:1rem auto 0;">${fileName ? `${fileName} e in lettura.` : 'Il documento e in lettura.'} Attendi: la AI sta estraendo totale, consumi, offerta e voci di costo.</p>
      <div class="loading-steps">
        <div class="loading-step">
          <strong>Upload completato</strong>
          Il file e arrivato al motore di analisi.
        </div>
        <div class="loading-step">
          <strong>Lettura AI in corso</strong>
          La AI interpreta bolletta, costi e struttura dell'offerta.
        </div>
        <div class="loading-step">
          <strong>Risposta finale in preparazione</strong>
          Tra poco vedrai il motivo della spesa e il risparmio stimato.
        </div>
      </div>
    </div>
  `;
}

async function submitAnalysis(event) {
  event.preventDefault();
  const file = uploadInput?.files?.[0] || null;
  const fields = getFormFields();
  const validation = validateUploadInput({ fields, file });

  if (!validation.isValid) {
    setFeedback(validation.errors[0], 'error');
    setProgress('upload');
    return;
  }

  setSubmitting(true);
  setFeedback('');
  if (resultPanel) resultPanel.hidden = false;
  showLoadingState(file?.name || '');
  setProgress('analysis');
  trackEvent('upload_completed', { mime_type: file.type, file_size: file.size });

  const body = new FormData(form);
  let analysis = null;
  let fallback = false;

  try {
    const { payload } = await postBillAnalysis(body);
    analysis = payload.analysis;
    fallback = Boolean(payload.meta?.usedFallback);

    if (fallback) {
      setFeedback('Analisi reale non disponibile in questo momento. Ti mostriamo un fallback coerente per non interrompere il flusso.', 'warning');
    }
  } catch (error) {
    analysis = createMockAnalysis({
      fileName: file.name,
      fileSize: file.size,
      fields,
    });
    fallback = true;
    const isLikelyStaticServerMismatch = typeof window !== 'undefined'
      && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
      && window.location.port
      && window.location.port !== LOCAL_API_PORT;

    setFeedback(
      isLikelyStaticServerMismatch
        ? `Analisi reale non raggiungibile da ${window.location.port}. Avvia il server beta completo sulla porta ${LOCAL_API_PORT} oppure configura l'endpoint API.`
        : 'Analisi reale non raggiungibile. Ti mostriamo un fallback coerente e puoi comunque lasciare i dati per la verifica.',
      'warning',
    );
    console.warn('Bill analysis request failed:', error);
  }

  renderAnalysis(analysis, { fallback });
  setSubmitting(false);
  setProgress('done');
  trackEvent('analysis_completed', {
    fallback_used: fallback,
    lead_tier: analysis.leadTier,
    confidence: analysis.extraction.extraction_confidence,
  });
  trackEvent('lead_submitted', {
    comune: fields.comune,
    marketing_opt_in: validation.fields.consentMarketing,
  });
}

function handleFileSelection() {
  const file = uploadInput?.files?.[0];
  if (!file) {
    if (uploadHint) {
      uploadHint.textContent = `Accettiamo PDF, JPG, PNG fino a ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB.`;
    }
    return;
  }

  const isSupported = SUPPORTED_MIME_TYPES.includes(file.type);
  if (uploadHint) {
    uploadHint.textContent = isSupported
      ? `${file.name} selezionato (${Math.round(file.size / 1024)} KB).`
      : 'Formato non supportato. Usa PDF, JPG o PNG.';
  }
  setProgress('upload');
  trackEvent('upload_started', { mime_type: file.type, file_size: file.size });
}

function showExample() {
  const analysis = createMockAnalysis({
    fileName: 'dual-condominio-alto-costo.pdf',
    fileSize: 420000,
    fields: {
      nome: 'Mario Rossi',
      telefono: '+393401112233',
      comune: 'Pescara',
      commodityHint: 'dual',
      consentAnalysis: 'true',
    },
  });
  if (resultPanel) resultPanel.hidden = false;
  renderAnalysis(analysis, { fallback: true });
  resultPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (doc) {
  doc.addEventListener('DOMContentLoaded', () => {
    trackEvent('page_view', { page_name: 'check-bolletta-beta' });
    setProgress('upload');
    if (resultState && defaultResultStateMarkup) {
      resultState.innerHTML = defaultResultStateMarkup;
    }
  });

  form?.addEventListener('submit', submitAnalysis);
  uploadInput?.addEventListener('change', handleFileSelection);
  exampleButton?.addEventListener('click', showExample);

  doc.addEventListener('click', (event) => {
    const link = event.target.closest('[data-whatsapp-link]');
    if (!link) return;
    trackEvent('cta_whatsapp_clicked', { href: link.href });
  });
}
