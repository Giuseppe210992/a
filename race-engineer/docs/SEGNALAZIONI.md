# Segnalazione errori per e-mail

Quando succede un bug o un errore serio, Race Engineer mostra un banner rosso con un **codice errore**
(`RE-…`) e, se hai configurato l'invio, ti manda un'e-mail con quel codice.

## Cosa viene inviato
Solo: codice errore, messaggio (senza nomi utente né cartelle), versione, sistema operativo, simulatore
scelto, un ID casuale dell'installazione e l'ID del codice di accesso. **Niente altro.**
Parte **solo se l'utente ha acconsentito** (casella nella schermata iniziale). Senza consenso non esce nulla
e non viene salvato nulla in coda.

## Cosa NON genera e-mail
Lo smartwatch non collegato, la sintesi vocale non disponibile, i comandi vocali non attivi, un codice di
accesso sbagliato: sono avvisi (banner giallo, solo nel log). Il resto del programma funziona sempre.

## Come attivare l'invio (una volta)
Il programma non contiene password. Crei tu un file `report.json` e lo metti in
`%LOCALAPPDATA%\RaceEngineer\` (oppure accanto a `re-gui.exe`, se lo distribuisci).
Due modi:

**1. SMTP (consigliato: l'e-mail arriva direttamente a te)** — esempio per Gmail, vedi `report.example.json`:
1. Account Google > Sicurezza > attiva la verifica in due passaggi.
2. Sempre in Sicurezza cerca «Password per le app», creane una (16 lettere).
3. Copia `report.example.json` in `report.json`, metti il tuo indirizzo in `to`, `username`, `from` e la
   password per le app in `password`.

**2. Webhook** (se non vuoi mettere una password in un file che distribuisci) — vedi
`report.example-webhook.json`. Funziona con servizi di inoltro come Web3Forms o Formspree (la loro chiave
è pensata per essere pubblica e invia solo al tuo indirizzo), con Zapier, o con un tuo server.

> Se distribuisci il programma ad altre persone usa il **webhook**: una password SMTP in un file sul PC di
> un cliente può essere letta da quel cliente.

`"default_consent": true` precompila la casella di consenso nella schermata iniziale (l'utente la vede,
vede l'indirizzo di destinazione e può togliere la spunta).

## Prova
Schermata iniziale > «Segnalazione errori» > **Invia messaggio di prova** (oppure
`re-cli --test-report`). Per simulare un errore: `re-cli --raise-test-error`.

## Se l'invio non è possibile
Gli errori restano in coda su disco (`pending-reports.jsonl`, max 50, 14 giorni) e vengono rinviati al
prossimo avvio. Lo stesso errore non viene inviato più di una volta all'ora (max 10 per sessione).
Nel banner rosso il pulsante **Invia per e-mail** apre il tuo programma di posta con il messaggio già
scritto.

## Codici
| Codice | Significato |
|---|---|
| RE-PANIC | errore interno imprevisto (bug) |
| RE-SRC-01 | errore interno nel lettore del simulatore |
| RE-AUD-01 / 02 | errore dell'audio di Windows durante / all'avvio |
| RE-GUI-01 | impossibile aprire la finestra grafica (OpenGL) |
| RE-TEST-xx | messaggi di prova |
Avvisi (non inviati): RE-BLE-01 smartwatch non collegato, RE-AUD-03/04 audio, RE-STT-01/02 comandi vocali.
Accesso: RE-ACC-01 codice non valido, 02 firma non riconosciuta, 03 scaduto, 04 orologio indietro.
