function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function formatCurrencyRound(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value || 0));
}

/**
 * Determines the HURKA outcome type.
 * Exported so app.js can read it to update the step-3 header.
 *
 * @param {object} analysis
 * @returns {'match'|'no-match'|'low-confidence'}
 */
export function getEsitoOutcome(analysis) {
  const opportunityStatus = analysis?.salesOpportunity?.status || '';
  if (opportunityStatus === 'high-saving' || opportunityStatus === 'possible-saving') return 'match';
  if (opportunityStatus === 'assisted-review') return 'low-confidence';
  if (opportunityStatus === 'limited-saving') return 'no-match';

  const confidence = analysis?.extraction?.extraction_confidence ?? 0;
  const offerMatch = analysis?.offerMatch;

  // offerMatch not yet computed (e.g. unit tests without lambda) → neutral
  if (!offerMatch) return 'no-match';

  if (offerMatch.hasMatch && offerMatch.topOffer) return 'match';

  const reason = offerMatch.noMatchReason || '';
  if (
    confidence < 0.60 ||
    /confidenza|insufficien|non identificat|dati insufficien/i.test(reason)
  ) {
    return 'low-confidence';
  }

  return 'no-match';
}

// ── Esito A: match forte ─────────────────────────────────────────────────────

function buildEsitoMatchCard(analysis) {
  const opportunity = analysis?.salesOpportunity || {};
  const range = opportunity.savingsRange || { min: 0, max: 0 };
  const sourceLabel = opportunity.benchmarkSource === 'cte_hurka'
    ? 'calcolo su condizioni economiche HURKA disponibili'
    : 'benchmark commerciale da verificare';

  return `
    <article class="esito-card esito-match">
      <div class="eyebrow eyebrow-match">Esito HURKA &middot; Possibile risparmio</div>
      <h2 class="esito-headline">${escapeHtml(opportunity.headline || 'La bolletta mostra un possibile margine di risparmio.')}</h2>

      <div class="esito-saving-row">
        <span class="esito-saving-big">${formatCurrencyRound(range.min)}-${formatCurrencyRound(range.max)}<small>/anno</small></span>
        <span class="esito-saving-sub">range prudente da confermare con verifica gratuita</span>
      </div>

      <div class="esito-meta-grid">
        <div class="esito-meta-item">
          <strong>${Math.round(Number(opportunity.confidence || 0) * 100)}%</strong>
          <span>confidenza lettura</span>
        </div>
        <div class="esito-meta-item">
          <strong>CTE</strong>
          <span>base confronto</span>
        </div>
        <div class="esito-meta-item">
          <strong>Consulente</strong>
          <span>chiusura assistita</span>
        </div>
      </div>

      <p class="esito-body-text">${escapeHtml(opportunity.summary || '')}</p>

      <p class="esito-calc-note">
        Non mostriamo una lista di offerte generiche: il range e basato su ${escapeHtml(sourceLabel)}.
        L'offerta finale viene proposta solo dopo controllo umano dei dati.
      </p>

      <div class="esito-cta-row">
        <a class="esito-cta-primary"
           href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20ho%20visto%20un%20possibile%20risparmio%20sulla%20bolletta%20e%20voglio%20verificarlo."
           target="_blank" rel="noopener" data-whatsapp-link>
          Verifica il risparmio &rarr;
        </a>
        <a class="esito-cta-soft" href="../contatti.html">Richiedi richiamata</a>
        <a class="esito-cta-soft"
           href="https://wa.me/393888668837?text=Vorrei%20parlare%20con%20un%20consulente%20HURKA."
           target="_blank" rel="noopener" data-whatsapp-link>
          Parla con un consulente
        </a>
      </div>
    </article>`;
}

// ── Esito B: nessuna convenienza ─────────────────────────────────────────────

function buildEsitoNoMatchCard(analysis) {
  const opportunity = analysis?.salesOpportunity || {};
  const reason = escapeHtml(
    opportunity.summary ||
    analysis?.offerMatch?.noMatchReason ||
    'Il profilo attuale non mostra un risparmio credibile con le offerte HURKA disponibili.',
  );

  return `
    <article class="esito-card esito-no-match">
      <div class="eyebrow eyebrow-no-match">Esito HURKA &middot; Profilo gi&agrave; competitivo</div>
      <h2 class="esito-headline">${escapeHtml(opportunity.headline || 'Al momento non emerge una convenienza sufficiente')}</h2>
      <p class="esito-body-text">${reason}</p>
      <p class="esito-body-text" style="margin-top:.5rem">
        Non ti mostriamo un&rsquo;offerta se il margine non e abbastanza solido.
        Possiamo comunque fare un check gratuito su potenza, contratto e clausole.
      </p>
      <div class="esito-cta-row">
        <a class="esito-cta-soft"
           href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20vorrei%20una%20verifica%20gratuita%20anche%20senza%20risparmio%20immediato."
           target="_blank" rel="noopener" data-whatsapp-link>
          Verifica gratuita comunque
        </a>
        <a class="esito-cta-soft" href="../contatti.html">Richiedi richiamata</a>
        <a class="esito-cta-soft"
           href="https://wa.me/393888668837"
           target="_blank" rel="noopener" data-whatsapp-link>
          WhatsApp
        </a>
      </div>
    </article>`;
}

// ── Esito C: bassa confidenza / review assistita ──────────────────────────────

function buildEsitoLowConfCard(analysis, offerMatch) {
  const opportunity = analysis?.salesOpportunity || {};
  const confidence = analysis?.extraction?.extraction_confidence ?? 0;
  const reason = escapeHtml(
    opportunity.summary ||
    offerMatch?.noMatchReason ||
    'I dati estratti non sono sufficienti per un confronto affidabile.',
  );

  return `
    <article class="esito-card esito-low-conf">
      <div class="eyebrow eyebrow-low-conf">Esito HURKA &middot; Verifica assistita necessaria</div>
      <h2 class="esito-headline">${escapeHtml(opportunity.headline || 'Serve una verifica assistita')}</h2>
      <p class="esito-body-text">${reason}</p>
      <p class="esito-body-text" style="margin-top:.5rem">
        Confidenza di lettura: <strong>${Math.round(confidence * 100)}%</strong>.
        Un consulente HURKA pu&ograve; leggere il documento insieme a te e fare un check preciso.
      </p>
      <div class="esito-cta-row">
        <a class="esito-cta-primary" href="../contatti.html">Richiedi richiamata</a>
        <a class="esito-cta-soft"
           href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20vorrei%20una%20verifica%20assistita%20sulla%20bolletta."
           target="_blank" rel="noopener" data-whatsapp-link>
          Invia via WhatsApp
        </a>
        <a class="esito-cta-soft"
           href="https://wa.me/393888668837?text=Vorrei%20un%27analisi%20completa%20con%20consulente%20HURKA."
           target="_blank" rel="noopener" data-whatsapp-link>
          Analisi completa con consulente
        </a>
      </div>
    </article>`;
}

// ── Detail cards (secondary, below the esito) ────────────────────────────────

function buildDetailCards(analysis, outcome) {
  const extraction = analysis?.extraction || {};
  const explanation = analysis?.explanation || {};
  const narrative = analysis?.narrative || {};
  const topDrivers = Array.isArray(narrative.topDrivers) ? narrative.topDrivers : [];
  const possibleIssues = Array.isArray(explanation.possible_issues) ? explanation.possible_issues : [];
  const criticalPoints = Array.isArray(explanation.critical_points) && explanation.critical_points.length
    ? explanation.critical_points
    : possibleIssues;

  // Skip detail section when data is very thin (very low confidence + no consumption data)
  const hasMinimalData = extraction.total_amount_eur > 0 || extraction.provider_name;
  if (!hasMinimalData) return '';

  const topDriversMarkup = topDrivers
    .map((item) => `<li><span>${escapeHtml(item.label)}</span><strong>${formatCurrency(item.amount)}</strong></li>`)
    .join('');

  const possibleIssuesMarkup = criticalPoints.length
    ? `<ul class="result-list compact">${criticalPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p style="margin:.5rem 0 0;color:rgba(16,26,44,.65)">Nessuna criticit&agrave; evidente dai dati letti.</p>';

  const ctaRecommendation = escapeHtml(explanation.cta_recommendation || '');
  const detailedExplanation = escapeHtml(explanation.detailed_explanation || narrative.whyYouPayThis || explanation.summary || '');
  const salesRecommendation = escapeHtml(explanation.sales_recommendation || explanation.cta_recommendation || '');

  return `
    <div class="result-grid" style="margin-top:0">
      <article class="result-card result-card-primary">
        <div class="eyebrow">Spiegazione AI della fattura</div>
        <h3>${escapeHtml(explanation.summary || 'Analisi completata')}</h3>
        <p>${detailedExplanation}</p>
        <div class="inline-metrics">
          <div>
            <span>Totale bolletta</span>
            <strong>${formatCurrency(extraction.total_amount_eur)}</strong>
          </div>
          <div>
            <span>Fornitore</span>
            <strong style="font-size:1.2rem">${escapeHtml(extraction.provider_name || '&mdash;')}</strong>
          </div>
          <div>
            <span>Confidenza lettura</span>
            <strong>${Math.round(Number(extraction.extraction_confidence || 0) * 100)}%</strong>
          </div>
        </div>
      </article>

      <article class="result-card">
        <div class="eyebrow">Voci che pesano di pi&ugrave;</div>
        <ul class="result-list">${topDriversMarkup}</ul>
        <div class="eyebrow" style="margin-top:1rem">Possibili criticit&agrave;</div>
        ${possibleIssuesMarkup}
        ${salesRecommendation ? `
          <div class="eyebrow" style="margin-top:1rem">Proposta HURKA</div>
          <p style="margin:.6rem 0 0;color:rgba(16,26,44,.72)">${salesRecommendation}</p>` : ''}
        ${ctaRecommendation ? `
          <div class="eyebrow" style="margin-top:1rem">Prossimo passo</div>
          <p style="margin:.6rem 0 0;color:rgba(16,26,44,.72)">${ctaRecommendation}</p>` : ''}
      </article>
    </div>`;
}

// ── Footer note ───────────────────────────────────────────────────────────────

function buildFooterNote(analysis, fallback) {
  const confidenceNote = escapeHtml(analysis?.explanation?.confidence_note || '');

  return `
    <div class="result-note">
      <strong>${fallback ? 'Esempio dimostrativo.' : 'Analisi AI reale completata.'}</strong>
      ${confidenceNote ? `<span>${confidenceNote}</span>` : ''}
    </div>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildAnalysisMarkup(analysis, { fallback = false } = {}) {
  const outcome = getEsitoOutcome(analysis);
  const offerMatch = analysis?.offerMatch || null;

  let esitoCard = '';
  if (outcome === 'match') {
    esitoCard = buildEsitoMatchCard(analysis);
  } else if (outcome === 'low-confidence') {
    esitoCard = buildEsitoLowConfCard(analysis, offerMatch);
  } else {
    esitoCard = buildEsitoNoMatchCard(analysis);
  }

  const detailCards = buildDetailCards(analysis, outcome);
  const footerNote = buildFooterNote(analysis, fallback);

  return `
    ${esitoCard}
    ${detailCards}
    ${footerNote}
  `;
}
