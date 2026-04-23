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

export function buildAnalysisMarkup(analysis, { fallback = false } = {}) {
  const extraction = analysis?.extraction || {};
  const explanation = analysis?.explanation || {};
  const narrative = analysis?.narrative || {};
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
        <div class="eyebrow">Perche stai pagando questa cifra</div>
        <h3>${escapeHtml(explanation.summary || 'Analisi completata')}</h3>
        <p>${escapeHtml(narrative.whyYouPayThis || explanation.summary || '')}</p>
        <div class="inline-metrics">
          <div>
            <span>Totale bolletta</span>
            <strong>${formatCurrency(extraction.total_amount_eur)}</strong>
          </div>
          <div>
            <span>Confidenza estrazione</span>
            <strong>${Math.round(Number(extraction.extraction_confidence || 0) * 100)}%</strong>
          </div>
        </div>
      </article>
      <article class="result-card">
        <div class="eyebrow">Le voci che incidono di piu</div>
        <ul class="result-list">${topDriversMarkup}</ul>
      </article>
      <article class="result-card">
        <div class="eyebrow">Quanto potresti risparmiare</div>
        <h3>${formatCurrency(explanation.estimated_savings_range?.min)} - ${formatCurrency(explanation.estimated_savings_range?.max)} / anno</h3>
        <p>${escapeHtml(narrative.savingsLabel || '')}</p>
      </article>
      <article class="result-card">
        <div class="eyebrow">Possibili criticita</div>
        ${possibleIssuesMarkup}
      </article>
      <article class="result-card">
        <div class="eyebrow">Prossimo passo</div>
        <p>${escapeHtml(explanation.cta_recommendation || '')}</p>
        <a class="secondary-link" href="https://wa.me/393888668837?text=Ciao%20HURKA!%2C%20ho%20appena%20usato%20la%20beta%20check%20bolletta%20e%20vorrei%20una%20verifica%20gratuita." target="_blank" rel="noopener" data-whatsapp-link>Parla con un consulente</a>
      </article>
    </div>
    <div class="result-note">
      <strong>${fallback ? 'Fallback beta attivo.' : 'Analisi reale completata.'}</strong>
      <span>${escapeHtml(explanation.confidence_note || '')}</span>
    </div>
  `;
}
