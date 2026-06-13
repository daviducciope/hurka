import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { applyTempCredentials } from './temp-credentials.mjs';

applyTempCredentials();
// Data-correctness pass: do NOT send real emails
delete process.env.SENDGRID_API_KEY;
process.env.BILL_ANALYSIS_DAILY_FREE_LIMIT = '100';

const base = resolve(process.cwd());
const { handler } = await import(`${base}/lambda/index.mjs?run=${Date.now()}`);
const { rankHurkaOffersForBill } = await import(`${base}/check-bolletta-beta/offer-matcher.mjs`);
const { computeLeadScore } = await import(`${base}/check-bolletta-beta/lead-scoring.mjs`);
const { buildCustomerEmail, buildInternalLeadEmail } = await import(`${base}/check-bolletta-beta/email-templates.mjs`);

const outDir = '/tmp/hurka-bill-tests';
mkdirSync(outDir, { recursive: true });
const dir = `${base}/check-bolletta-beta/docs/bollette test ai`;
const files = [
  '20260212_2026G000027615.pdf',
  '412604893781.pdf',
  '822600288765.pdf',
  '922601460947.pdf',
  'EE266115225_04_05_2026_SEIL0208508_VALENTINO_FALCO.pdf..pdf',
  'Fattura Cliente 685673509 del 2026-01-11.pdf',
  'Luce - aprile 2026.pdf',
];

function buildEvent(filePath, email) {
  const boundary = '----hurka-run';
  const buffer = readFileSync(filePath);
  const fields = {
    nome: 'Test Cliente', telefono: '+393331234567', email,
    comune: 'Pescara', commodityHint: '', preferenza: 'risparmio',
    consentAnalysis: 'true', consentMarketing: 'false',
  };
  const seg = [];
  for (const [n, v] of Object.entries(fields)) {
    seg.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  seg.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="billFile"; filename="${basename(filePath)}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'));
  seg.push(buffer);
  seg.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return {
    rawPath: '/api/bill-analysis/upload', path: '/api/bill-analysis/upload',
    requestContext: { http: { method: 'POST', path: '/api/bill-analysis/upload' } },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(seg).toString('base64'), isBase64Encoded: true,
  };
}

const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const fp = resolve(dir, f);
  const t0 = Date.now();
  let payload, status;
  try {
    const r = await handler(buildEvent(fp, `test${i}@example.com`));
    status = r.statusCode;
    payload = JSON.parse(r.body);
  } catch (e) {
    console.log(`\n### ${f}\nERROR: ${e.message}`);
    continue;
  }
  const a = payload.analysis;
  if (!a) {
    console.log(`\n### ${f}\nstatus=${status} error=${payload.error || ''} code=${payload.code || ''}`);
    continue;
  }
  const ex = a.extraction || {};
  const offerMatch = rankHurkaOffersForBill(a, { preferenceType: 'risparmio' });
  a.offerMatch = offerMatch;
  const leadScore = computeLeadScore(a, { phoneValid: true, emailProvided: true, answeredQuestions: false, consentMarketing: false });
  const customer = buildCustomerEmail({ nome: 'Test Cliente', commodity: ex.commodity, salesOpportunity: a.salesOpportunity, offerMatch, consentMarketing: false });
  const internal = buildInternalLeadEmail({ fields: { nome: 'Test Cliente', telefono: '+393331234567', email: `test${i}@example.com`, comune: 'Pescara', preferenza: 'risparmio', commodityHint: '', consentMarketing: false }, file: { name: f, type: 'application/pdf' }, analysis: a, leadScore, offerMatch });

  const slug = f.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  writeFileSync(`${outDir}/${slug}.json`, JSON.stringify({ status, meta: payload.meta, analysis: a, offerMatch, leadScore }, null, 2));
  writeFileSync(`${outDir}/${slug}.customer.html`, customer.html);
  writeFileSync(`${outDir}/${slug}.internal.html`, internal.html);

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n### ${f}  (${sec}s, status ${status}, ${payload.meta?.provider}, conf ${Math.round((ex.extraction_confidence || 0) * 100)}%)`);
  console.log(`commodity=${ex.commodity}  fornitore=${ex.provider_name}  offerta=${ex.offer_code || '-'}`);
  console.log(`cliente=${ex.customer_name || '-'}  POD/PDR=${ex.pod_or_pdr || '-'}  indirizzo=${ex.supply_address || '-'}`);
  console.log(`periodo=${ex.billing_period_start}..${ex.billing_period_end}  consumo=${ex.consumption_total} ${ex.consumption_unit}`);
  console.log(`totale=${eur(ex.total_amount_eur)}  spesa_materia=${eur(ex.spesa_materia_eur)}  trasp/oneri=${eur(ex.trasporto_e_oneri_eur)}  imposte=${eur(ex.imposte_iva_eur)}`);
  console.log(`mensile_stim=${eur(ex.estimated_monthly_cost)}  annuo_stim=${eur(ex.estimated_annual_cost)}`);
  console.log(`summary: ${a.explanation?.summary}`);
  console.log(`salesOpportunity: status=${a.salesOpportunity?.status} hasSaving=${a.salesOpportunity?.hasSavingOpportunity} range=${eur(a.salesOpportunity?.savingsRange?.min)}-${eur(a.salesOpportunity?.savingsRange?.max)}`);
  if (offerMatch.hasMatch) {
    console.log(`offerMatch: ${offerMatch.topOffer.name} | risparmio ${eur(offerMatch.topOffer.savings.annual)}/anno (${offerMatch.topOffer.savings.percent}%) | base ${offerMatch.topOffer.priceBasis} | annualKwh=${offerMatch.topOffer.calculationBasis.annualConsumptionKwh}`);
  } else {
    console.log(`offerMatch: NO -> ${offerMatch.noMatchReason}`);
  }
  console.log(`leadScore: ${leadScore.total}/100 (${leadScore.class})  [opp ${leadScore.scoreA}/60, intent ${leadScore.scoreB}/40]`);
}
console.log('\n--- DONE. Dump in /tmp/hurka-bill-tests/ ---');
