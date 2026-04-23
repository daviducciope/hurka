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
- [ ] Verifica live PDF gas reale: non eseguita, perche al momento non esiste un file gas reale nella repo (`check-bolletta-beta/docs/gas-sample.pdf` assente).

## Note operative

- Env richieste lato Lambda: `XAI_API_KEY`, `SENDGRID_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `FROM_NAME`, `INBOUND_WEBHOOK_TOKEN`.
- Il mock non e piu il percorso principale: se `XAI_API_KEY` e presente, la Lambda tenta sempre la pipeline reale.
- Il file remoto xAI viene eliminato a fine pipeline quando la `DELETE` e disponibile; l'esito e riportato in `meta.xaiFileDeleted`.
- I test live possono caricare credenziali temporanee da `check-bolletta-beta/aws_credential.md` solo negli script di verifica locale, non nel runtime applicativo normale.
- Il timeout operativo xAI e stato portato a 180 secondi dopo verifica reale su PDF multi-pagina.
- `extraction_confidence` viene normalizzato anche se il modello restituisce una percentuale intera (es. `75` -> `0.75`).
- Nessuna chiave e hardcodata nel codice finale.
