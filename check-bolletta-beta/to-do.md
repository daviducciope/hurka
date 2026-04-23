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
- [x] Verifica live SendGrid eseguita su singolo invio lead reale.
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

## Fase 2 — Motore confronto credibile + UX chat guidata (in corso 2026-04-23)

### Moduli backend

- [ ] `offers-catalog.mjs`: catalogo strutturato delle 4 offerte HURKA dai PDF CTE reali (Sinergas x2, EE x2).
- [ ] `offer-matcher.mjs`: `rankHurkaOffersForBill()` — calcolo risparmio deterministico su dati CTE + bolletta estratta.
- [ ] `lead-scoring.mjs`: scoring 0-100 con componente opportunita (0-60) + intento (0-40); classi freddo/nurture/buono/caldo.
- [ ] `email-templates.mjs`: template separati email cliente (conferma analisi) e email interna HURKA (lead + score + offerta).
- [ ] `bill-analysis-core.mjs`: aggiunta campo `spesa_materia_eur` allo schema; prompt migliorato per estrazione diretta voce materia.
- [ ] `lambda/index.mjs`: integrazione offer-matcher + lead-scoring + nuovi template email; risposta include `offerMatch` e `leadScore`.

### Frontend

- [ ] `chat-wizard.mjs`: wizard conversazionale multi-step (upload → 2 domande guidate → loading → risultati).
- [ ] `ui-core.mjs`: blocco risultati aggiornato con offerta HURKA suggerita, risparmio calcolato e base dati citata.
- [ ] `app.js`: orchestrazione wizard; invariato il codice di chiamata API.
- [ ] `index.html`: layout nuovo wizard; stili aggiuntivi; backward compatible.

### Test

- [ ] `tests/offer-matcher.test.mjs`: scenario risparmio alto (Edison vs Sinergas), nessun risparmio (Duferco), dual, bassa confidenza.
- [ ] `tests/lead-scoring.test.mjs`: test ogni componente score, tutte e 4 le classi, edge cases.
- [ ] `tests/email-templates.test.mjs`: email cliente con/senza marketing, email interna con offerta e senza.
- [ ] `tests/bill-analysis.test.mjs`: aggiornamento fixture con `spesa_materia_eur`; regressione completa.
- [ ] Esecuzione suite completa `node --test` senza errori.

### Deploy

- [ ] Aggiornare zip Lambda con nuovi moduli e fare update su AWS.
- [ ] Caricare file frontend aggiornati su S3.
- [ ] Invalidare CloudFront.
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
