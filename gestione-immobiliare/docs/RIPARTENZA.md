# Ripartenza: cosa c'è, cosa è stato deciso, cosa manca

Documento per riprendere il lavoro (da parte di chiunque, anche in una nuova conversazione) senza rileggere tutto.

## 1. Cosa è

«Gestione Immobiliare»: gestionale **offline** per compravendite, compensi (con IVA), incassi, provvigioni dei collaboratori a scaglioni mensili, liquidazioni, statistiche e backup. Richiesta originale: barra laterale fissa e riducibile con **8 voci** (Dashboard, Nuova pratica, Archivio pratiche, Provvigioni e liquidazioni, Cumulo mensile per zona, Statistiche e grafici, Backup e archivio storico, Impostazioni) e **dashboard centrale** che si aggiorna da sola (intestazione con ricerca e «+ Nuova pratica», 6 riquadri, filtri, 6 grafici, 8 operazioni rapide, ultime pratiche, avvisi). Priorità richiesta: prima la struttura grafica completa e navigabile, poi il collegamento a database e calcoli; alla fine verificare che ogni pulsante faccia davvero ciò che dice e che i dati restino dopo la chiusura e la riapertura.

Dove: cartella `gestione-immobiliare/` del repository `Giuseppe210992/a`, ramo `ccr-dbc9b9b0-cjwcqx`. Le altre cartelle del repository (client, server, archivi ZIP…) sono di altri progetti e non vanno toccate.

## 2. Decisioni prese (e perché)

| Tema | Scelta | Motivo |
|---|---|---|
| Tecnologia | HTML + JavaScript senza framework, un solo pacchetto (`dist/web`), database **SQLite** (sql.js, WebAssembly incorporato) | Funziona offline, niente server, un solo file di dati, nessuna risorsa esterna (la politica di sicurezza della pagina vieta ogni connessione) |
| Programma Windows | **Electron** che mostra lo stesso pacchetto e salva su file | L'utente usa un PC Windows normale; si costruisce su Windows in automatico (GitHub Actions) |
| Dove stanno i dati (Windows) | `Documenti\Gestione Immobiliare\Dati\archivio.sqlite` (+ `.bak`), copie in `…\Backup\` | Cartella che l'utente vede, copia e salva facilmente. Salvataggio atomico: mai un file a metà |
| Dove stanno i dati (browser) | IndexedDB del browser | Solo per la versione browser; per questo c'è «Esporta l'archivio completo» |
| Importi | Sempre **centesimi interi** | Nessun errore di arrotondamento; le ripartizioni usano il metodo del resto maggiore, quindi la somma torna sempre esatta |
| Scaglioni | **Nessuno inventato**: l'archivio parte senza scaglioni e le provvigioni sono a zero finché non li inserisce lui. «Aggiungi scaglione» propone 0 € → 30%, 10.000 € → 35%, 20.000 € → 40% solo come valori di partenza | I numeri veri li conosce solo l'utente |
| Metodo di calcolo (predefinito) | **Scaglione raggiunto**: la percentuale dello scaglione raggiunto si applica a *tutto* il cumulo mensile. Alternativa: progressivo (a fasce) | Era l'interpretazione più vicina alla richiesta («percentuale raggiunta»). Cambiabile in Impostazioni → *Metodo di calcolo*, tutto si ricalcola subito |
| Base del cumulo (predefinita) | Per **collaboratore e zona** (alternative: per zona; per collaboratore) | Richiesta: «cumulo mensile per zona» con Luca e Giuseppe |
| Maturazione (predefinita) | **Alla conclusione** (rogito). Alternativa: in proporzione agli incassi | Le pratiche si contano per `data_rogito` (se manca, per `data_pratica`) |
| Importi lordi | Nessuna ritenuta, contributo o tassa sui compensi dei collaboratori | Non richiesto: da confermare |
| Dati incompleti | La pratica si salva comunque e viene segnalata come incompleta | Non perdere mai ciò che l'utente ha scritto |
| Primo avvio | Archivio vuoto, con i soli collaboratori **Luca** e **Giuseppe** (modificabili) | Nessun dato dimostrativo, come richiesto |
| Una sola finestra | Electron: blocco di istanza singola; browser: Web Locks | Due finestre aperte si sovrascriverebbero i dati |
| Conferme | Sempre prima di eliminare dati, importare, ripristinare o azzerare; prima di ogni operazione distruttiva viene salvata una copia di sicurezza | Richiesta esplicita |
| Aspetto | Blu (colore d'accento), chiaro/scuro/automatico, ≥ 4,5:1 di contrasto | Una palette verde/grigia in stile agenzia è possibile ma non richiesta |

## 3. Come è fatto il codice

```
src/index.html, src/styles/*.css      pagina e stili (token di colore in tokens.css)
src/js/main.js                        avvio, recupero da archivio danneggiato, blocco "una sola finestra"
src/js/shell.js                       barra laterale, intestazione, filtri, avvisi
src/js/core/                          router (#/percorso), DOM (h, monta), formati italiani, date, finestre e notifiche
src/js/components/                    campi, filtri, ricerca, finestre di registrazione incasso/liquidazione, avvisi
src/js/charts/                        grafici SVG scritti a mano (colonne, barre, linee, dumbbell, sparkline)
src/js/views/                         una schermata per file (8 + scheda pratica + recupero)
src/js/data/schema.js, db.js          schema SQLite (user_version 1) e classe Archivio (transazioni, esporta, sostituisci)
src/js/data/calc/                     MOTORE DI CALCOLO: funzioni pure (scaglioni.js, modello.js, aggregati.js)
src/js/data/repo/                     lettura e scrittura di pratiche, anagrafiche, impostazioni
src/js/data/drivers/                  dove finiscono i byte: IndexedDB (browser), file (Electron), memoria (test)
src/js/data/backup.js, integrity.js   copie di sicurezza, ripristino, importazione, verifica di coerenza
electron/                             processo principale, ponte sicuro (preload), archivio su file
build.mjs                             esbuild → dist/web/{index.html,app.js,app.css}  (--leggibile = senza minimizzare)
tests/unit, tests/e2e, tests/electron prove (vedi sotto)
```

Regole da non rompere:

- **Importi in centesimi interi**, mai numeri con la virgola.
- **Niente testo `null` nell'interfaccia**: `h()` e `monta()` scartano i valori nulli; `append/prepend/replaceChildren` non devono ricevere argomenti che possono essere nulli (lo controlla `tests/unit/dom-sicuro.test.mjs` e, a runtime, il rilevatore `__testoSospetto` nelle prove nel browser).
- **Nessuna risorsa esterna** (font, script, immagini): la CSP lo impedisce e una prova lo verifica.
- **Testi in italiano con gli accenti veri** (è, à, ù), date `gg/mm/aaaa`, euro «1.234,56 €», meno vero «−» (U+2212).
- Dopo ogni modifica ai dati si chiama `Archivio.transazione(...)`: salva sul driver e fa ridisegnare le schermate.

## 4. Come si verifica

```
cd gestione-immobiliare
npm ci
npm test                  # 85 prove su calcoli, date, formati, archivio, host file (circa 1 s)
npm run test:e2e          # costruisce e prova ogni schermata nel browser (Chromium + Playwright), circa 4 minuti
GI_RALLENTA=4 npm run test:e2e   # lo stesso con il browser 4 volte più lento
GI_RITARDO=150 npm run test:e2e  # lo stesso con eventi e scritture su disco in ritardo di 150 ms (scova le letture troppo presto)
npm run copertura        # quali righe del programma le prove nel browser eseguono (circa 5 minuti)
npm run programma         # apre il programma Electron dai sorgenti
npm run test:programma    # prova il programma Electron (su Linux: xvfb-run -a npm run test:programma)
npm run pacchetto         # crea installatore e versione portatile (da farsi su Windows)
```

Le prove usano un orologio fisso (16/10/2026) e un profilo persistente per simulare «chiudi e riapri». I numeri attesi sono calcolati **a mano e in modo indipendente** dal programma, a partire dalle 15 pratiche di `tests/e2e/dati-prova.mjs` e dagli scaglioni 0 € → 30%, 10.000 € → 35%, 20.000 € → 40% (questi sono dati di *prova*, non valori del programma). Anno 2026: 13 pratiche concluse, compensi 87.920 €, provvigioni maturate 28.236 €, liquidate 6.565 €, da liquidare 21.671 €, valore immobili venduti 2.178.000 €, 2 pratiche in corso. Esempio di cumulo: ottobre, Luca, zona Centro, 14.000 € → 2° scaglione (35%) → 4.900 € con «scaglione raggiunto», 4.400 € con «progressivo».

## 5. Trappole già incontrate

- Un test che legge lo schermo subito dopo un clic può vincere o perdere una gara con il ridisegno. Si usano `vai()` e `conNavigazione()` (aspettano il contatore `data-montaggi` che il router scrive su `#contenuto`), `attendiQuiete()` (aspetta che la pagina smetta di cambiare) e `attendiNotifica()` (considera solo notifiche comparse dopo l'ultimo clic). Niente pause fisse, salvo nei controlli «non deve succedere nulla».
- I tre test falliti nella prima esecuzione su GitHub (su 168; in locale passavano tutti) **non si riproducevano nemmeno rallentando la CPU** (`GI_RALLENTA=4`): la causa era l'ordine degli eventi, non la lentezza. Si riproducono invece con `GI_RITARDO=150`, che ritarda il cambio di schermata, i timer a zero e la conferma di scrittura su disco di 150 ms (per il terzo serve anche una notifica che resti visibile più a lungo): stessi messaggi di errore di GitHub. Dopo la correzione le prove passano anche così. Usare `GI_RITARDO` per verificare ogni nuova prova.
- Con lo stesso indirizzo (`#/pratiche/5` → `#/pratiche/5`) la schermata non si ricostruisce: `vai()` nei test passa da un indirizzo sconosciuto; nel programma c'è `rimonta()` (usato da «Salva e inserisci un'altra»).
- Pulsanti nativi dentro `<dialog>`: il focus deve restare nella finestra (c'è una trappola Tab in `apriModale`).
- Il browser cambia `Date` nei test: non confrontare date con l'orologio reale.
- Su Windows un antivirus può tenere occupato per un attimo il file dei dati: la scrittura riprova da sola (`conRiprove`).
- **Copertura (`npm run copertura`)**: V8 registra le righe eseguite solo finché la pagina non viene ricaricata o chiusa; il codice che gira soltanto *prima* di un `location.reload()` (la schermata di recupero, il banner di errore di salvataggio) risulta quindi «non eseguito» anche se le prove lo attraversano. Il rapporto va letto di conseguenza. Le righe davvero scoperte, fuori dai percorsi d'errore, sono state coperte con i file `13`–`16` delle prove nel browser.
- **Difetti trovati con la copertura** (tutti corretti, con una prova che li rileva): aggiunta con Invio nelle Impostazioni che non aggiornava l'elenco; Invio nella ricerca rapida diverso da quanto promesso; richieste di aggiornamento degli avvisi perse (`if (inAggiornamento) return`); seconda barra mancante nel campo data; `select()` posticipato che ruba il cursore; opzioni delle righe di ripartizione non aggiornate. Lezione: ogni modulo con un campo di testo va provato anche **con Invio**, non solo col clic sul pulsante.
- Non usare `pkill -f chromium` o simili: può chiudere anche la shell che lancia le prove.

## 6. Cosa NON è stato fatto o verificato

Vedi la tabella «Stato delle verifiche» nel `README.md`. In sintesi: nessuna prova su un PC Windows reale da parte dell'utente, nessun lettore di schermo (NVDA), nessun telefono reale, nessun Firefox/Safari, installatore non firmato (Windows mostra l'avviso SmartScreen). Non esistono: ritenute/contributi, più utenti contemporanei, sincronizzazione tra PC, stampa dedicata delle schede (la stampa del browser usa uno stile semplice ma non è stata verificata).

## 7. Prossimi passi proposti

1. L'utente prova il programma su Windows con `docs/PROVA-SU-WINDOWS.md` e riporta gli esiti.
2. L'utente inserisce zone, scaglioni e percentuali veri e conferma le tre scelte di calcolo (metodo, base del cumulo, maturazione).
3. Con le risposte: correggere ciò che emerge, poi eventuale firma digitale dell'installatore e pubblicazione con un tag `v1.0.0` (il flusso di lavoro crea da solo la pagina «Releases»).
4. Facoltativo: palette verde/grigia, stampa PDF delle schede, esportazione verso il commercialista.

## 8. Come lavorare con l'utente

Scrive dal telefono e delega l'esecuzione: messaggi **in italiano, brevi, leggibili da telefono**; proporre sempre un valore predefinito e chiedere solo ciò che può dire solo lui; sui compensi e sulle provvigioni **massimo rigore** (mostrare i passaggi, dire che cosa è stimato); stato onesto con tabella «verificato / non verificato», mai un verde non guadagnato; chiudere con «Azione richiesta a te». Nel repository mai dati personali: niente password, codici fiscali, recapiti, nomi di clienti o familiari.
