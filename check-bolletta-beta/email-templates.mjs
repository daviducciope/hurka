function escapeHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eur(amount) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(amount || 0));
}

const BRAND_COLOR = '#203863';
const YELLOW = '#fae04a';

function headerBlock(title) {
  return `<div style="background:${BRAND_COLOR};padding:24px 32px;">
    <h1 style="margin:0;color:${YELLOW};font-size:22px;font-family:sans-serif;letter-spacing:1px;">${escapeHtml(title)}</h1>
  </div>`;
}

function footerBlock() {
  return `<div style="background:${BRAND_COLOR};padding:14px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:rgba(255,255,255,.45);font-family:sans-serif;">
      HURKA! — Consulenza Energetica Integrata — <a href="https://hurka.it" style="color:${YELLOW};text-decoration:none;">hurka.it</a>
    </p>
  </div>`;
}

function tableRow(label, value) {
  return `<tr>
    <td style="padding:9px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;width:160px;font-size:13px;">${escapeHtml(label)}</td>
    <td style="padding:9px 12px;border:1px solid #e0e0e0;font-size:13px;">${escapeHtml(String(value ?? '—'))}</td>
  </tr>`;
}

/**
 * Builds the confirmation email sent to the customer.
 * Only sent when the customer provides an email address.
 *
 * @param {{ nome: string, email: string, commodity: string, salesOpportunity?: object|null, offerMatch?: object|null, consentMarketing: boolean }} data
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildCustomerEmail({ nome, commodity, salesOpportunity, offerMatch, consentMarketing }) {
  const firstName = String(nome || 'Cliente').split(' ')[0];
  const commodityLabel = commodity === 'gas' ? 'gas' : commodity === 'dual' ? 'luce e gas' : 'luce';
  const opportunity = salesOpportunity || (
    offerMatch?.hasMatch && offerMatch.topOffer
      ? {
          hasSavingOpportunity: true,
          savingsRange: {
            min: Math.max(30, Math.floor((offerMatch.topOffer.savings.annual || 0) * 0.72 / 10) * 10),
            max: Math.ceil((offerMatch.topOffer.savings.annual || 0) / 10) * 10,
          },
        }
      : null
  );

  const matchSection = opportunity?.hasSavingOpportunity && opportunity.savingsRange
    ? `<div style="margin:20px 0;padding:18px 20px;background:#f0f4f9;border-left:4px solid ${YELLOW};border-radius:6px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:${BRAND_COLOR};font-family:sans-serif;">Abbiamo trovato qualcosa di interessante</p>
        <p style="margin:0;font-size:13px;color:#444;font-family:sans-serif;">
          La bolletta analizzata suggerisce un possibile risparmio prudente tra
          <strong>${eur(opportunity.savingsRange.min)} e ${eur(opportunity.savingsRange.max)}/anno</strong>.
          Ti ricontatteremo per confermare i dettagli prima di proporti qualsiasi soluzione.
        </p>
      </div>`
    : `<div style="margin:20px 0;padding:18px 20px;background:#f8f7f4;border-radius:6px;">
        <p style="margin:0;font-size:13px;color:#555;font-family:sans-serif;">
          Stiamo analizzando il profilo della tua fornitura ${commodityLabel}.
          Se emerge un'opportunita concreta, ti contatteremo direttamente.
        </p>
      </div>`;

  const marketingNote = consentMarketing
    ? `<p style="font-size:12px;color:#888;font-family:sans-serif;">Hai dato il consenso per ricevere aggiornamenti sulle offerte HURKA. Puoi revocare questo consenso in qualsiasi momento rispondendo a questa email.</p>`
    : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;">
  <div style="max-width:600px;margin:24px auto;background:white;border-radius:8px;overflow:hidden;font-family:sans-serif;">
    ${headerBlock('HURKA! — La tua bolletta è in analisi')}
    <div style="padding:28px 32px;">
      <p style="font-size:15px;color:#333;">Ciao <strong>${escapeHtml(firstName)}</strong>,</p>
      <p style="font-size:14px;color:#444;line-height:1.65;">
        abbiamo ricevuto la bolletta ${commodityLabel} che ci hai inviato.
        Il nostro sistema ha completato la lettura iniziale e un consulente HURKA sta verificando i dati.
      </p>
      ${matchSection}
      <p style="font-size:14px;color:#444;line-height:1.65;">
        Se non emergono opportunita reali, non ti disturberemo con proposte generiche.
        Il nostro principio: <strong>ti contattiamo solo se ha senso per te</strong>.
      </p>
      <p style="font-size:14px;color:#444;">
        Nel frattempo, puoi scriverci su WhatsApp per qualsiasi domanda:<br/>
        <a href="https://wa.me/393888668837" style="color:${BRAND_COLOR};font-weight:bold;">wa.me/393888668837</a>
      </p>
      <p style="font-size:14px;color:#444;margin-top:24px;">
        A presto,<br/><strong style="color:${BRAND_COLOR};">Il team HURKA!</strong>
      </p>
      ${marketingNote}
    </div>
    ${footerBlock()}
  </div>
</body></html>`;

  const text = [
    `Ciao ${firstName},`,
    '',
    `abbiamo ricevuto la bolletta ${commodityLabel}.`,
    opportunity?.hasSavingOpportunity && opportunity.savingsRange
      ? `Risparmio stimato: tra ${eur(opportunity.savingsRange.min)} e ${eur(opportunity.savingsRange.max)}/anno. Ti ricontatteremo per confermare i dettagli.`
      : `Stiamo verificando il profilo. Ti contatteremo se emerge un'opportunita concreta.`,
    '',
    'WhatsApp: wa.me/393888668837',
    '',
    'A presto,',
    'Il team HURKA! — hurka.it',
  ].join('\n');

  return {
    subject: `La tua bolletta è in analisi – HURKA!`,
    text,
    html,
  };
}

/**
 * Builds the internal notification email sent to HURKA.
 *
 * @param {{
 *   fields: object, file: object|null, analysis: object,
 *   leadScore: object, offerMatch: object
 * }} data
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildInternalLeadEmail({ fields, file, analysis, leadScore, offerMatch }) {
  const nome = fields?.nome || '—';
  const telefono = fields?.telefono || '—';
  const email = fields?.email || '—';
  const comune = fields?.comune || '—';
  const preferenza = fields?.preferenza || '—';
  const commodityHint = fields?.commodityHint || '—';
  const consentMarketing = fields?.consentMarketing ? 'SI' : 'NO';
  const extraction = analysis?.extraction || {};
  const scoreClass = leadScore?.class || '—';
  const scoreTotal = leadScore?.total ?? '—';
  const fileName = file?.name || analysis?.meta?.fileName || '—';

  const priorityColor = {
    caldo: '#c0392b',
    buono: '#e67e22',
    nurture: '#2980b9',
    freddo: '#7f8c8d',
  }[scoreClass] || '#333';

  const priorityBadge = `<span style="display:inline-block;padding:4px 12px;border-radius:20px;background:${priorityColor};color:white;font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(scoreClass)} — ${scoreTotal}/100</span>`;

  const offerSection = offerMatch?.hasMatch && offerMatch.topOffer
    ? `<h3 style="margin:20px 0 8px;font-size:14px;color:${BRAND_COLOR};font-family:sans-serif;">Offerta HURKA suggerita</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;">
        ${tableRow('Offerta', offerMatch.topOffer.name)}
        ${tableRow('Fornitore', offerMatch.topOffer.provider)}
        ${tableRow('Risparmio annuo', eur(offerMatch.topOffer.savings.annual))}
        ${tableRow('Risparmio mensile', eur(offerMatch.topOffer.savings.monthly))}
        ${tableRow('Risparmio %', `${offerMatch.topOffer.savings.percent}%`)}
        ${tableRow('Costo attuale materia', eur(offerMatch.topOffer.savings.currentAnnualVendorCost) + '/anno')}
        ${tableRow('Costo HURKA stimato', eur(offerMatch.topOffer.savings.hurkaAnnualCost) + '/anno')}
        ${tableRow('Base calcolo', offerMatch.topOffer.priceBasis === 'fixed' ? 'Prezzo fisso CTE' : `PUN ref ${offerMatch.topOffer.calculationBasis.punReferenceUsed} €/kWh + spread`)}
        ${tableRow('Consumi annui', `${offerMatch.topOffer.calculationBasis.annualConsumptionKwh} kWh`)}
        ${tableRow('Fonte spesa materia', offerMatch.topOffer.calculationBasis.spesaMateriaSource)}
      </table>`
    : `<p style="font-family:sans-serif;font-size:13px;color:#666;">${escapeHtml(offerMatch?.noMatchReason || 'Nessun match trovato.')}</p>`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;">
  <div style="max-width:700px;margin:24px auto;background:white;border-radius:8px;overflow:hidden;font-family:sans-serif;">
    ${headerBlock(`[HURKA Lead] ${nome} — check bolletta beta`)}
    <div style="padding:24px 32px;">
      <div style="margin-bottom:16px;">${priorityBadge}</div>

      <h3 style="margin:0 0 8px;font-size:14px;color:${BRAND_COLOR};">Dati contatto</h3>
      <table style="border-collapse:collapse;width:100%;">
        ${tableRow('Nome', nome)}
        ${tableRow('Telefono', telefono)}
        ${tableRow('Email', email)}
        ${tableRow('Comune', comune)}
        ${tableRow('Commodity', commodityHint)}
        ${tableRow('Preferenza', preferenza)}
        ${tableRow('Consenso marketing', consentMarketing)}
      </table>

      <h3 style="margin:20px 0 8px;font-size:14px;color:${BRAND_COLOR};">Bolletta analizzata</h3>
      <table style="border-collapse:collapse;width:100%;">
        ${tableRow('File', fileName)}
        ${tableRow('Fornitore attuale', extraction.provider_name || '—')}
        ${tableRow('Offerta attuale', extraction.offer_code || '—')}
        ${tableRow('Commodity', extraction.commodity || '—')}
        ${tableRow('Totale bolletta', eur(extraction.total_amount_eur))}
        ${tableRow('Spesa materia', eur(extraction.spesa_materia_eur || (extraction.quota_consumi_eur + extraction.quota_fissa_eur + extraction.quota_potenza_eur)))}
        ${tableRow('Consumo', `${extraction.consumption_total || 0} ${extraction.consumption_unit || 'kWh'}`)}
        ${tableRow('Periodo', `${extraction.billing_period_start || '—'} → ${extraction.billing_period_end || '—'}`)}
        ${tableRow('Costo annuo stimato', eur(extraction.estimated_annual_cost))}
        ${tableRow('Confidenza AI', `${Math.round((extraction.extraction_confidence || 0) * 100)}%`)}
      </table>

      ${offerSection}

      <h3 style="margin:20px 0 8px;font-size:14px;color:${BRAND_COLOR};">Score lead</h3>
      <table style="border-collapse:collapse;width:100%;">
        ${tableRow('Score totale', `${leadScore?.total ?? '—'}/100`)}
        ${tableRow('Score opportunita', `${leadScore?.scoreA ?? '—'}/60`)}
        ${tableRow('Score intento', `${leadScore?.scoreB ?? '—'}/40`)}
        ${tableRow('Classe', scoreClass.toUpperCase())}
      </table>

      <h3 style="margin:20px 0 8px;font-size:14px;color:${BRAND_COLOR};">Sintesi AI</h3>
      <p style="font-size:13px;color:#444;font-family:sans-serif;background:#f8f7f4;padding:14px;border-radius:6px;">
        ${escapeHtml(analysis?.explanation?.summary || '—')}
      </p>
    </div>
    ${footerBlock()}
  </div>
</body></html>`;

  const text = [
    `[HURKA Lead] ${nome} — Score ${scoreTotal}/100 — ${String(scoreClass).toUpperCase()}`,
    '',
    `Nome: ${nome}`,
    `Telefono: ${telefono}`,
    `Email: ${email}`,
    `Comune: ${comune}`,
    `Commodity: ${commodityHint}`,
    `Preferenza: ${preferenza}`,
    `Marketing: ${consentMarketing}`,
    '',
    `File: ${fileName}`,
    `Fornitore: ${extraction.provider_name || '—'}`,
    `Totale bolletta: ${eur(extraction.total_amount_eur)}`,
    `Consumi: ${extraction.consumption_total || 0} ${extraction.consumption_unit || 'kWh'}`,
    `Spesa annua stimata: ${eur(extraction.estimated_annual_cost)}`,
    '',
    offerMatch?.hasMatch && offerMatch.topOffer
      ? [
          `Offerta HURKA: ${offerMatch.topOffer.name} (${offerMatch.topOffer.provider})`,
          `Risparmio stimato: ${eur(offerMatch.topOffer.savings.annual)}/anno`,
          `Base calcolo: ${offerMatch.topOffer.priceBasis}`,
        ].join('\n')
      : `Nessun match offerta: ${offerMatch?.noMatchReason || ''}`,
    '',
    `Summary AI: ${analysis?.explanation?.summary || '—'}`,
  ].join('\n');

  const scoreClassLabel = String(scoreClass).toUpperCase();
  return {
    subject: `[HURKA Lead] ${nome} — ${scoreClassLabel} ${scoreTotal}/100 — check bolletta`,
    text,
    html,
  };
}
