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
const WHATSAPP_NUMBER = '393888668837';

function whatsappLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function phoneDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function ctaButton(href, label, { solid = true } = {}) {
  const bg = solid ? YELLOW : '#ffffff';
  const border = solid ? YELLOW : '#c9d3e0';
  return `<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;background:${bg};color:${BRAND_COLOR};font-weight:bold;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:6px;border:1px solid ${border};font-family:sans-serif;margin:4px 6px 4px 0;">${escapeHtml(label)}</a>`;
}

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

  const hasSaving = Boolean(opportunity?.hasSavingOpportunity && opportunity.savingsRange && opportunity.savingsRange.max > 0);
  const nextStep = opportunity?.nextStep ? String(opportunity.nextStep) : '';

  const waMessage = hasSaving
    ? "Ciao HURKA! Ho ricevuto l'analisi della mia bolletta e vorrei verificare il risparmio."
    : "Ciao HURKA! Ho inviato la mia bolletta per l'analisi e vorrei parlarne con un consulente.";
  const waHref = whatsappLink(waMessage);
  const ctaLabel = hasSaving ? 'Verifica il risparmio su WhatsApp' : 'Parla con un consulente';

  const resultSection = hasSaving
    ? `<div style="margin:20px 0;padding:18px 20px;background:#f0f4f9;border-left:4px solid ${YELLOW};border-radius:6px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:${BRAND_COLOR};font-family:sans-serif;">Abbiamo trovato un possibile risparmio</p>
        <p style="margin:0;font-size:13px;color:#444;font-family:sans-serif;line-height:1.6;">
          La bolletta analizzata suggerisce un risparmio prudente tra
          <strong>${eur(opportunity.savingsRange.min)} e ${eur(opportunity.savingsRange.max)}/anno</strong>.
          È una stima minima da confermare: un consulente verifica i numeri prima di proporti qualsiasi soluzione.
        </p>
        ${nextStep ? `<p style="margin:10px 0 0;font-size:13px;color:${BRAND_COLOR};font-family:sans-serif;"><strong>Prossimo passo:</strong> ${escapeHtml(nextStep)}</p>` : ''}
      </div>`
    : `<div style="margin:20px 0;padding:18px 20px;background:#f8f7f4;border-radius:6px;">
        <p style="margin:0;font-size:13px;color:#555;font-family:sans-serif;line-height:1.6;">
          Un consulente HURKA sta verificando il profilo della tua fornitura ${commodityLabel}.
          Ti contatteremo direttamente solo se emerge un'opportunità concreta.
        </p>
        ${nextStep ? `<p style="margin:10px 0 0;font-size:13px;color:${BRAND_COLOR};font-family:sans-serif;"><strong>Prossimo passo:</strong> ${escapeHtml(nextStep)}</p>` : ''}
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
        Il nostro sistema ha completato la lettura iniziale e un consulente HURKA ti ricontatta entro 1 giorno lavorativo.
      </p>
      ${resultSection}
      <div style="margin:22px 0;text-align:center;">
        ${ctaButton(waHref, ctaLabel)}
        <p style="margin:8px 0 0;font-size:12px;color:#999;font-family:sans-serif;">Oppure scrivici su WhatsApp: <a href="https://wa.me/${WHATSAPP_NUMBER}" style="color:${BRAND_COLOR};font-weight:bold;">wa.me/${WHATSAPP_NUMBER}</a></p>
      </div>
      <p style="font-size:14px;color:#444;line-height:1.65;">
        Se non emergono opportunità reali, non ti disturberemo con proposte generiche.
        Il nostro principio: <strong>ti contattiamo solo se ha senso per te</strong>.
      </p>
      <p style="font-size:12px;color:#999;font-family:sans-serif;line-height:1.6;">
        I tuoi dati sono trattati in modo riservato e usati solo per questa analisi.
      </p>
      <p style="font-size:14px;color:#444;margin-top:20px;">
        A presto,<br/><strong style="color:${BRAND_COLOR};">Il team HURKA!</strong>
      </p>
      ${marketingNote}
    </div>
    ${footerBlock()}
  </div>
</body></html>`;

  const textLines = [
    `Ciao ${firstName},`,
    '',
    `abbiamo ricevuto la bolletta ${commodityLabel}. Un consulente HURKA ti ricontatta entro 1 giorno lavorativo.`,
    hasSaving
      ? `Risparmio prudente stimato: tra ${eur(opportunity.savingsRange.min)} e ${eur(opportunity.savingsRange.max)}/anno (stima minima da confermare).`
      : `Stiamo verificando il profilo. Ti contatteremo solo se emerge un'opportunità concreta.`,
    nextStep ? `Prossimo passo: ${nextStep}` : '',
    '',
    `Vuoi accelerare? Scrivici su WhatsApp: ${waHref}`,
    `Numero diretto: wa.me/${WHATSAPP_NUMBER}`,
    '',
    'I tuoi dati sono trattati in modo riservato e usati solo per questa analisi.',
    '',
    'A presto,',
    'Il team HURKA! — hurka.it',
  ];
  const text = textLines.join('\n');

  return {
    subject: hasSaving
      ? 'La tua bolletta è in analisi – possibile risparmio individuato'
      : 'La tua bolletta è in analisi – HURKA!',
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
  const salesOpportunity = analysis?.salesOpportunity || null;
  const leadFirstName = String(nome).split(' ')[0];
  const leadPhoneDigits = phoneDigits(telefono);
  const waLeadMessage = `Ciao ${leadFirstName}, siamo HURKA: abbiamo analizzato la tua bolletta e vorremmo verificare insieme i numeri. Quando sei disponibile?`;

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

  const quickActions = (leadPhoneDigits || (email && email !== '—'))
    ? `<div style="margin:0 0 18px;">
        ${leadPhoneDigits ? ctaButton(`https://wa.me/${leadPhoneDigits}?text=${encodeURIComponent(waLeadMessage)}`, 'WhatsApp al cliente') : ''}
        ${leadPhoneDigits ? ctaButton(`tel:${escapeHtml(telefono)}`, 'Chiama', { solid: false }) : ''}
        ${(email && email !== '—') ? ctaButton(`mailto:${escapeHtml(email)}`, 'Email', { solid: false }) : ''}
      </div>`
    : '';

  const customerView = salesOpportunity
    ? `<h3 style="margin:20px 0 8px;font-size:14px;color:${BRAND_COLOR};font-family:sans-serif;">Cosa ha visto il cliente</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;">
        ${tableRow('Esito mostrato', salesOpportunity.headline || '—')}
        ${tableRow('Range comunicato', salesOpportunity.hasSavingOpportunity && salesOpportunity.savingsRange ? `${eur(salesOpportunity.savingsRange.min)}–${eur(salesOpportunity.savingsRange.max)}/anno` : 'Nessun risparmio mostrato')}
        ${tableRow('Prossimo passo', salesOpportunity.nextStep || '—')}
      </table>
      <p style="font-size:12px;color:#999;font-family:sans-serif;margin:6px 0 0;">Usa lo stesso range mostrato al cliente, per coerenza.</p>`
    : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;">
  <div style="max-width:700px;margin:24px auto;background:white;border-radius:8px;overflow:hidden;font-family:sans-serif;">
    ${headerBlock(`[HURKA Lead] ${nome} — check bolletta beta`)}
    <div style="padding:24px 32px;">
      <div style="margin-bottom:12px;">${priorityBadge}</div>
      ${quickActions}

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

      ${customerView}

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
    leadPhoneDigits ? `WhatsApp cliente: https://wa.me/${leadPhoneDigits}` : '',
    salesOpportunity ? `Range mostrato al cliente: ${salesOpportunity.hasSavingOpportunity && salesOpportunity.savingsRange ? `${eur(salesOpportunity.savingsRange.min)}–${eur(salesOpportunity.savingsRange.max)}/anno` : 'nessun risparmio mostrato'}` : '',
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
