# Check Bolletta Beta

## Stato

- [x] Analisi repo completata: sito statico HTML + Lambda condivisa confermati.
- [x] Pagina privata `/check-bolletta-beta/` mantenuta non linkata e `noindex`.
- [x] Validazione upload mantenuta per PDF/JPG/PNG con limite 10 MB e consensi separati.
- [x] Refactor backend completato: route `POST /api/bill-analysis/upload` ora `xAI-first`.
- [x] Upload documento verso xAI Files API implementato.
- [x] Analisi reale via xAI Responses API implementata con modello `grok-4.20-reasoning`.
- [x] Structured output strict con JSON schema condiviso implementato.
- [x] `store: false` impostato nelle richieste xAI.
- [x] Cleanup remoto xAI tentato via `DELETE /files/{file_id}` e tracciato nel payload.
- [x] Fallback mock relegato a emergenza: assenza config xAI o errore provider.
- [x] Frontend beta aggiornato per payload reale, fallback pulito e tracking invariato.
- [x] Landing beta compattata in due sole sezioni e stato di attesa AI reso esplicito durante l'analisi.
- [x] Email lead mantenuta con riepilogo analisi, tier lead e stato consenso marketing.
- [x] Test automatici ampliati: validazione input, multipart upload, fallback mock, pipeline reale mockata, errore xAI, parsing structured JSON, rendering frontend, separazione consenso marketing.
- [x] Suite test locale eseguita con successo (`node --test`, integrazione mockata, Playwright mockato).
- [x] Verifica live xAI API eseguita su upload, Responses, `store: false`, modello, schema strict e `DELETE /files/{file_id}`.
- [x] Verifica live file-per-file eseguita su PDF luce reale, PDF luce multi-pagina reale, PNG reale, JPG reale, immagine sfocata/parziale reale e CTE reale.
- [x] Verifica live browser eseguita su `/check-bolletta-beta/` con payload reale completo.
- [ ] Verifica live PDF gas reale: non eseguita (assente `docs/gas-sample.pdf`).

## Deploy AWS (completato 2026-04-23)

- [x] Ruolo IAM `hurka-lambda-exec` creato in eu-central-1 con permessi CloudWatch Logs.
- [x] Funzione Lambda `hurka-backend` deployata in eu-central-1 (Node 22.x, 256 MB, timeout 180s).
- [x] Variabili d'ambiente configurate in Lambda: `XAI_API_KEY`, `SENDGRID_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `FROM_NAME`, `INBOUND_WEBHOOK_TOKEN`.
- [x] API Gateway HTTP API `hurka-api` creata (ID: `dewas95a1m`), CORS limitato a hurka.it e wearehurka.it.
- [x] Route `POST /api/bill-analysis/upload` e `POST /contact` collegate alla Lambda.
- [x] Meta tag `bill-analysis-api-base` aggiornato in `check-bolletta-beta/index.html` con endpoint reale.
- [x] File aggiornati caricati su S3 `wearehurka.it` e cache CloudFront invalidata.
- [x] Verifica live: endpoint risponde correttamente da `https://hurka.it/check-bolletta-beta/`.

## Fase 2 — Motore confronto credibile + UX chat guidata (completata 2026-04-23)

### Moduli backend

- [x] `offers-catalog.mjs`: catalogo strutturato delle 4 offerte HURKA dai PDF CTE reali.
- [x] `offer-matcher.mjs`: `rankHurkaOffersForBill()` — calcolo risparmio deterministico su dati CTE + bolletta estratta.
- [x] `lead-scoring.mjs`: scoring 0-100 con componente opportunita (0-60) + intento (0-40); classi freddo/nurture/buono/caldo.
- [x] `email-templates.mjs`: template separati email cliente (conferma analisi) e email interna HURKA (lead + score + offerta).
- [x] `bill-analysis-core.mjs`: campo `spesa_materia_eur` nello schema; prompt migliorato per estrazione diretta voce materia.
- [x] `lambda/index.mjs`: integrazione offer-matcher + lead-scoring + nuovi template email; risposta include `offerMatch` e `leadScore`.

### Test fase 2

- [x] `tests/offer-matcher.test.mjs`: scenario risparmio alto (Edison vs Sinergas), nessun risparmio (Duferco), dual, bassa confidenza.
- [x] `tests/lead-scoring.test.mjs`: test ogni componente score, tutte e 4 le classi, edge cases.
- [x] `tests/email-templates.test.mjs`: email cliente con/senza marketing, email interna con offerta e senza.
- [x] `tests/bill-analysis.test.mjs`: fixture con `spesa_materia_eur`; regressione completa.
- [x] Suite completa `node --test` — 34 test passati senza errori.

## Fase 3 — Chiusura flow finale + UX wow (in corso 2026-04-23)

### Obiettivo
Flow che porta a uno di 3 esiti chiari: match forte / nessuna convenienza / bassa confidenza.

### Backend (nessuna modifica necessaria — già completo)

- [x] Lambda restituisce già `offerMatch`, `leadScore`, entrambe le email.
- [x] Lead score usato in email interna con priorità colorata e breakdown.
- [x] Offer matcher distingue già i 3 esiti tramite `hasMatch` + `noMatchReason` + `extraction_confidence`.

### Frontend — `ui-core.mjs`

- [x] Aggiungere `getEsitoOutcome(analysis)` esportata — restituisce `'match'|'no-match'|'low-confidence'`.
- [x] Riscrivere `buildAnalysisMarkup` con esito-card prominente in testa + card di dettaglio secondarie.
- [x] Esito A (match): big number risparmio, offerta, provider, base calcolo, caveat, CTA forte (WhatsApp + richiamata + consulente).
- [x] Esito B (no-match): messaggio onesto, nessuna pressione vendita, CTA soft (verifica gratuita, richiamata, WhatsApp).
- [x] Esito C (low-confidence): verifica assistita, confidenza mostrata, CTA: richiamata + WhatsApp + analisi con consulente.
- [x] "Cosa stai pagando" e "Perché lo stai pagando" come card secondarie sotto l'esito.
- [x] "Prossimo passo" con `cta_recommendation` sempre visibile nelle card secondarie.
- [x] Nota footer: `'Analisi reale completata.'` / `'Fallback beta attivo.'` (allineato al test E2E).

### Frontend — `app.js`

- [x] Import di `getEsitoOutcome` da `ui-core.mjs`.
- [x] `updateStep3Header(analysis)` — aggiorna il testo `<h2>` del passo 3 in base all'esito.

### Frontend — `index.html`

- [x] Aggiungere CSS per `.esito-card` e sue varianti (`.esito-match`, `.esito-no-match`, `.esito-low-conf`).
- [x] CSS per `.esito-headline`, `.esito-saving-big`, `.esito-meta-grid`, `.esito-cta-row`, `.esito-cta-primary`, `.esito-cta-soft`.
- [x] CSS per eyebrow varianti (`.eyebrow-match`, `.eyebrow-no-match`, `.eyebrow-low-conf`).

### Test fase 3

- [x] `tests/bill-analysis.test.mjs`: test `buildAnalysisMarkup` per i 3 esiti (match, no-match, low-confidence).
- [x] Regressione completa `node --test` — tutti i test passati.

### Deploy (completato 2026-04-23)

- [x] Aggiornare zip Lambda con nuovi moduli (nessuna modifica backend in questa fase → non necessario).
- [x] Caricare `ui-core.mjs`, `app.js`, `index.html` aggiornati su S3.
- [x] Invalidare CloudFront (invalidation ID: `IEVM3O0MCUD0NBCV6KXHZ43K3W`).
- [ ] Verifica live end-to-end su `https://hurka.it/check-bolletta-beta/`.

## Note operative

- Env Lambda: `XAI_API_KEY`, `SENDGRID_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `FROM_NAME`, `INBOUND_WEBHOOK_TOKEN`.
- Il mock non e piu il percorso principale: se `XAI_API_KEY` e presente, la Lambda tenta sempre la pipeline reale.
- Il file remoto xAI viene eliminato a fine pipeline; l'esito e riportato in `meta.xaiFileDeleted`.
- API endpoint produzione: `https://dewas95a1m.execute-api.eu-central-1.amazonaws.com`
- PUN reference usato nel matcher: 0.135 €/kWh monorario (prudente, sotto il max 0.1434 di marzo 2026 da CTE Sinergas).
- La stima risparmio e ora basata su dati strutturati CTE + bolletta estratta, non su previsioni del modello AI.
- CTE presenti: Sinergas BIENNALE LUCE CASA, Sinergas ENERGIA PIU' VICINA LUCE BIO, EE FIX FAMILY RAP, EE FLEX FAMILY SEMPRE ZERO S.
- Score lead non viene mostrato all'utente, solo a HURKA via email interna.
- Consensi analisi e marketing restano separati e obbligatoriamente distinti in tutto il flusso.
- I 3 esiti si distinguono in `ui-core.mjs` con `getEsitoOutcome()` basata su `offerMatch.hasMatch`, `extraction_confidence` e pattern nel `noMatchReason`.
