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

function buildOfferMatchBlock(offerMatch) {
  if (!offerMatch) return '';

  if (!offerMatch.hasMatch || !offerMatch.topOffer) {
    return `
      <article class="result-card result-card-no-match">
        <div class="eyebrow">Offerta HURKA</div>
        <h3 style="color:var(--teal)">Profilo gia competitivo</h3>
        <p>${escapeHtml(offerMatch.noMatchReason || 'Non emerge un risparmio credibile con le offerte attuali.')}</p>
        <a class="match-cta-link" href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20ho%20analizzato%20la%20bolletta%20e%20vorrei%20un%20check%20gratuito." target="_blank" rel="noopener" data-whatsapp-link>
          Verifica gratuita &rarr;
        </a>
      </article>`;
  }

  const offer = offerMatch.topOffer;
  const saving = offer.savings;
  const basis = offer.calculationBasis;
  const basisNote = offer.priceBasis === 'fixed'
    ? `Prezzo fisso da CTE ${escapeHtml(offer.name)}`
    : `PUN di riferimento ${basis.punReferenceUsed} €/kWh + spread offerta`;

  const altBlock = offerMatch.alternativeOffer
    ? `<div class="match-alt">
        <span class="match-alt-label">Alternativa</span>
        <strong>${escapeHtml(offerMatch.alternativeOffer.name)}</strong>
        <span>${formatCurrencyRound(offerMatch.alternativeOffer.savings.annual)}/anno</span>
      </div>`
    : '';

  return `
    <article class="result-card result-card-match">
      <div class="eyebrow eyebrow-green">Offerta HURKA suggerita</div>
      <h3>${escapeHtml(offer.name)}</h3>
      <p style="color:rgba(16,26,44,.7)">${escapeHtml(offer.provider)}${offer.greenEnergy ? ' · Energia verde certificata' : ''}</p>
      <div class="match-savings">
        <div class="match-savings-main">
          <span>Risparmio stimato</span>
          <strong>${formatCurrencyRound(saving.annual)}<small>/anno</small></strong>
          <em>${formatCurrencyRound(saving.monthly)}/mese · ${saving.percent}% sulla spesa materia</em>
        </div>
        <div class="match-savings-detail">
          <div><span>Spesa attuale materia</span><strong>${formatCurrencyRound(saving.currentAnnualVendorCost)}/anno</strong></div>
          <div><span>Con HURKA</span><strong>${formatCurrencyRound(saving.hurkaAnnualCost)}/anno</strong></div>
        </div>
      </div>
      <p class="match-basis-note">Calcolo basato su: ${escapeHtml(basisNote)} · ${Math.round(basis.annualConsumptionKwh)} kWh/anno annualizzati da ${basis.billingDays} giorni di fatturazione.</p>
      ${altBlock}
      <div class="match-cta-row">
        <a class="match-cta-primary" href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20ho%20visto%20l%27offerta%20${encodeURIComponent(offer.name)}%20e%20vorrei%20saperne%20di%20piu." target="_blank" rel="noopener" data-whatsapp-link>
          Attiva con HURKA &rarr;
        </a>
      </div>
    </article>`;
}

export function buildAnalysisMarkup(analysis, { fallback = false } = {}) {
  const extraction = analysis?.extraction || {};
  const explanation = analysis?.explanation || {};
  const narrative = analysis?.narrative || {};
  const offerMatch = analysis?.offerMatch || null;
  const topDrivers = Array.isArray(narrative.topDrivers) ? narrative.topDrivers : [];
  const possibleIssues = Array.isArray(explanation.possible_issues) ? explanation.possible_issues : [];

  const topDriversMarkup = topDrivers
    .map((item) => `<li><span>${escapeHtml(item.label)}</span><strong>${formatCurrency(item.amount)}</strong></li>`)
    .join('');

  const possibleIssuesMarkup = possibleIssues.length
    ? `<ul class="result-list compact">${possibleIssues.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>Nessuna criticita evidente dai dati letti.</p>';

  return `
    <div class="result-grid">
      <article class="result-card result-card-primary">
        <div class="eyebrow">Cosa stai pagando</div>
        <h3>${escapeHtml(explanation.summary || 'Analisi completata')}</h3>
        <p>${escapeHtml(narrative.whyYouPayThis || explanation.summary || '')}</p>
        <div class="inline-metrics">
          <div>
            <span>Totale bolletta</span>
            <strong>${formatCurrency(extraction.total_amount_eur)}</strong>
          </div>
          <div>
            <span>Fornitore</span>
            <strong style="font-size:1.2rem">${escapeHtml(extraction.provider_name || '—')}</strong>
          </div>
          <div>
            <span>Confidenza lettura</span>
            <strong>${Math.round(Number(extraction.extraction_confidence || 0) * 100)}%</strong>
          </div>
        </div>
      </article>
      <article class="result-card">
        <div class="eyebrow">Perche lo stai pagando</div>
        <ul class="result-list">${topDriversMarkup}</ul>
        <div class="eyebrow" style="margin-top:1rem">Possibili criticita</div>
        ${possibleIssuesMarkup}
      </article>
      ${buildOfferMatchBlock(offerMatch)}
      <article class="result-card">
        <div class="eyebrow">Prossimo passo</div>
        <p>${escapeHtml(explanation.cta_recommendation || '')}</p>
        <div style="display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1rem">
          <a class="secondary-link" href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20ho%20appena%20analizzato%20la%20bolletta%20e%20vorrei%20una%20verifica%20gratuita." target="_blank" rel="noopener" data-whatsapp-link>WhatsApp</a>
          <a class="secondary-link" href="../contatti.html">Richiedi richiamata</a>
        </div>
      </article>
    </div>
    <div class="result-note">
      <strong>${fallback ? 'Dati di esempio attivi.' : 'Analisi reale completata.'}</strong>
      <span>${escapeHtml(explanation.confidence_note || '')}</span>
    </div>
  `;
}
