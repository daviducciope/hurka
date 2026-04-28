import {
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
  createMockAnalysis,
  validateUploadInput,
} from './bill-analysis-core.mjs';
import { buildAnalysisMarkup, getEsitoOutcome } from './ui-core.mjs';

const doc = typeof document !== 'undefined' ? document : null;
const LOCAL_API_PORT = '4173';

// Wizard elements
const wizard = doc?.querySelector('[data-wizard]') || null;
const uploadInput = doc?.querySelector('#bill-file') || null;
const uploadHint = doc?.querySelector('[data-upload-hint]') || null;
const uploadDropzone = doc?.querySelector('[data-upload-dropzone]') || null;
const form = doc?.querySelector('[data-bill-form]') || null;
const feedback = doc?.querySelector('[data-form-feedback]') || null;
const submitButton = doc?.querySelector('[data-submit-button]') || null;
const resultContent = doc?.querySelector('[data-result-content]') || null;
const loadingState = doc?.querySelector('[data-loading-state]') || null;
const exampleButton = doc?.querySelector('[data-example-button]') || null;

function trackEvent(eventName, params = {}) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: eventName, ...params });
  if (typeof window.gtag === 'function') window.gtag('event', eventName, params);
}

function setWizardStep(step) {
  if (!wizard) return;
  wizard.dataset.step = String(step);
  wizard.querySelectorAll('[data-step-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.stepPanel !== String(step);
  });
}

function setFeedback(message, tone = 'neutral') {
  // Update all feedback nodes (step 1 and step 3 both have one)
  doc?.querySelectorAll('[data-form-feedback]').forEach((el) => {
    el.hidden = !message;
    el.textContent = message || '';
    el.dataset.tone = tone;
  });
}

function setSubmitting(isSubmitting) {
  if (!submitButton) return;
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? 'Analisi in corso...' : 'Analizza la bolletta →';
}

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '') || '';
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
  if (configuredBase) candidates.push(`${configuredBase}/api/bill-analysis/upload`);

  if (typeof window !== 'undefined') {
    const isLocalhost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    if (!configuredBase || isLocalhost) {
      candidates.push(new URL('/api/bill-analysis/upload', window.location.origin).toString());
    }
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
        const error = new Error(payload.error || `HTTP ${response.status}`);
        error.endpoint = endpoint;
        error.status = response.status;
        error.apiResponse = true;
        error.payload = payload;
        error.publicCode = payload.code || '';
        throw error;
      }
      return { endpoint, payload };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Stop only on definitive client errors (bad request, auth, validation).
      // For 404/405/5xx the endpoint itself is broken — keep trying other candidates.
      const definitiveClientError = lastError.apiResponse && [400, 401, 403, 422, 429].includes(lastError.status);
      const definitiveApiError = lastError.apiResponse && ['xai_error', 'missing_xai_config', 'daily_quota_exceeded', 'quota_unavailable'].includes(lastError.publicCode);
      if (definitiveApiError) throw lastError;
      if (definitiveClientError) throw lastError;
    }
  }
  throw lastError || new Error('Analisi non disponibile.');
}

function updateStep3Header(analysis) {
  const h2 = doc?.querySelector('[data-step-panel="3"] .wizard-header h2');
  if (!h2) return;
  const outcome = getEsitoOutcome(analysis);
  const headings = {
    match: 'Abbiamo trovato un\'offerta migliore',
    'no-match': 'Il tuo profilo è già competitivo',
    'low-confidence': 'Serve una verifica assistita',
  };
  h2.textContent = headings[outcome] || 'Ecco cosa abbiamo trovato';
}

function renderAnalysis(analysis, { fallback = false } = {}) {
  if (!resultContent) return;
  resultContent.hidden = false;
  resultContent.innerHTML = buildAnalysisMarkup(analysis, { fallback });
  updateStep3Header(analysis);
}

function handleFileSelection() {
  const file = uploadInput?.files?.[0];
  if (!file) return;

  const isSupported = SUPPORTED_MIME_TYPES.includes(file.type);
  const hint = isSupported
    ? `${file.name} selezionato (${Math.round(file.size / 1024)} KB)`
    : 'Formato non supportato. Usa PDF, JPG o PNG.';

  if (uploadHint) uploadHint.textContent = hint;
  if (uploadDropzone) {
    uploadDropzone.dataset.hasFile = isSupported ? 'true' : 'false';
    const label = uploadDropzone.querySelector('[data-file-name]');
    if (label) label.textContent = isSupported ? `✓ ${file.name}` : 'Formato non supportato';
  }

  if (isSupported) {
    setWizardStep('1');
    trackEvent('upload_started', { mime_type: file.type, file_size: file.size });
  }
}

function handleDropzoneClick() {
  uploadInput?.click();
}

function handleDragOver(e) {
  e.preventDefault();
  uploadDropzone?.classList.add('drag-over');
}

function handleDragLeave() {
  uploadDropzone?.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  uploadDropzone?.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (!file || !uploadInput) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  uploadInput.files = dt.files;
  handleFileSelection();
}

async function submitAnalysis(event) {
  event.preventDefault();

  const file = uploadInput?.files?.[0] || null;
  const formData = new FormData(form);
  const fields = {
    nome: formData.get('nome'),
    telefono: formData.get('telefono'),
    email: formData.get('email'),
    comune: formData.get('comune'),
    commodityHint: formData.get('commodityHint'),
    preferenza: formData.get('preferenza'),
    consentAnalysis: formData.get('consentAnalysis'),
    consentMarketing: formData.get('consentMarketing'),
  };

  const validation = validateUploadInput({ fields, file });
  if (!validation.isValid) {
    setFeedback(validation.errors[0], 'error');
    return;
  }

  setSubmitting(true);
  setFeedback('');
  setWizardStep('2');
  trackEvent('upload_completed', { mime_type: file.type, file_size: file.size });

  // Build FormData from form fields + file from the dropzone input (outside the form)
  const body = new FormData(form);
  if (file && !body.get('billFile')?.size) {
    body.set('billFile', file, file.name);
  }
  let analysis = null;
  let fallback = false;

  try {
    const { payload } = await postBillAnalysis(body);
    analysis = payload.analysis;
    fallback = Boolean(payload.meta?.usedFallback);
  } catch (error) {
    const isPortMismatch = typeof window !== 'undefined'
      && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
      && window.location.port
      && window.location.port !== LOCAL_API_PORT;
    const message = error instanceof Error ? error.message : '';
    const quotaPayload = error?.payload?.code === 'daily_quota_exceeded' ? error.payload : null;
    setFeedback(
      quotaPayload
        ? `${quotaPayload.error} ${quotaPayload.subscription?.message || ''}`.trim()
        : message || (isPortMismatch
        ? `Backend non raggiungibile. Avvia il server sulla porta ${LOCAL_API_PORT}.`
        : 'Analisi AI reale non disponibile ora. Riprova tra poco o contatta HURKA su WhatsApp.'),
      'error',
    );
    if (quotaPayload?.subscription?.url) {
      setWizardStep('3');
      resultContent.hidden = false;
      resultContent.innerHTML = `
        <article class="esito-card esito-low-conf">
          <div class="eyebrow eyebrow-low-conf">Limite gratuito raggiunto</div>
          <h2 class="esito-headline">Hai usato le ${quotaPayload.quota?.limit || 3} analisi gratuite di oggi.</h2>
          <p class="esito-body-text">Con l'abbonamento HURKA puoi continuare a confrontare bollette con l'AI e ricevere una verifica assistita sulle opportunita migliori.</p>
          <div class="esito-cta-row">
            <a class="esito-cta-primary" href="${quotaPayload.subscription.url}">Sblocca altre comparazioni</a>
            <a class="esito-cta-soft" href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20ho%20raggiunto%20il%20limite%20di%20analisi%20bolletta%20AI." target="_blank" rel="noopener">Parla con HURKA</a>
          </div>
        </article>`;
    }
    console.warn('Bill analysis request failed:', error);
    setSubmitting(false);
    if (!quotaPayload) setWizardStep('1');
    trackEvent('analysis_failed', { reason: error instanceof Error ? error.message : String(error) });
    return;
  }

  renderAnalysis(analysis, { fallback });
  setSubmitting(false);
  setWizardStep('3');

  trackEvent('analysis_completed', {
    fallback_used: fallback,
    lead_tier: analysis.leadTier,
    confidence: analysis.extraction.extraction_confidence,
    opportunity_status: analysis.salesOpportunity?.status || 'unknown',
    has_saving_opportunity: Boolean(analysis.salesOpportunity?.hasSavingOpportunity),
  });
  trackEvent('lead_submitted', {
    comune: fields.comune,
    marketing_opt_in: validation.fields.consentMarketing,
    preferenza: fields.preferenza,
  });

  // Track WhatsApp clicks on result CTAs
  doc?.querySelectorAll('[data-whatsapp-link]').forEach((link) => {
    link.addEventListener('click', () => {
      trackEvent('cta_whatsapp_clicked', { href: link.href, context: 'result' });
    }, { once: true });
  });
}

function showExample() {
  const analysis = createMockAnalysis({
    fileName: 'esempio-bolletta-luce.pdf',
    fileSize: 380000,
    fields: {
      nome: 'Mario Rossi',
      telefono: '+393401112233',
      comune: 'Pescara',
      commodityHint: 'luce',
      preferenza: 'risparmio',
      consentAnalysis: 'true',
    },
  });
  renderAnalysis(analysis, { fallback: true });
  setWizardStep('3');
}

function initChoiceButtons() {
  if (!doc) return;
  doc.querySelectorAll('[data-choice-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.choiceGroup;
      const value = btn.dataset.choiceValue;
      // Update visual state
      doc.querySelectorAll(`[data-choice-group="${group}"]`).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Update hidden input
      const hidden = doc.querySelector(`input[name="${group}"]`);
      if (hidden) hidden.value = value;
    });
  });
}

function syncFileToForm() {
  // When moving to step 1, keep the file available via the form's hidden file input
  // by re-using the same uploadInput reference (it's outside the form but the FormData
  // is built from the form element which has a visible file input in step 1).
  // We handle this by appending the file to FormData manually in submitAnalysis.
}

if (doc) {
  doc.addEventListener('DOMContentLoaded', () => {
    trackEvent('page_view', { page_name: 'compara-bolletta-ai' });
    setWizardStep('0');
    initChoiceButtons();
  });

  uploadInput?.addEventListener('change', handleFileSelection);
  uploadDropzone?.addEventListener('click', handleDropzoneClick);
  uploadDropzone?.addEventListener('dragover', handleDragOver);
  uploadDropzone?.addEventListener('dragleave', handleDragLeave);
  uploadDropzone?.addEventListener('drop', handleDrop);
  form?.addEventListener('submit', submitAnalysis);
  exampleButton?.addEventListener('click', showExample);
}
