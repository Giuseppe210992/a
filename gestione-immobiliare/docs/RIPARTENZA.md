# Ripartenza: cosa c'è, cosa è stato deciso, cosa manca

Documento per riprendere il lavoro (da parte di chiunque, anche in una nuova conversazione) senza rileggere tutto.

## 1. Cosa è

«Gestione Immobiliare»: gestionale **offline** per compravendite, compensi (con IVA), incassi, provvigioni dei collaboratori a scaglioni mensili, liquidazioni, statistiche e backup. Richiesta originale: barra laterale fissa e riducibile con **8 voci** (Dashboard, Nuova pratica, Archivio pratiche, Provvigioni e liquidazioni, Cumulo mensile per zona, Statistiche e grafici, Backup e archivio storico, Impostazioni) e **dashboard centrale** che si aggiorna da sola (intestazione con ricerca e «+ Nuova pratica», 6 riquadri, filtri, 6 grafici, 8 operazioni rapide, ultime pratiche, avvisi). **Poi l'utente ha chiesto «il più semplice possibile, che anche un bimbo lo possa usare, e non troppi grafici»**: la dashboard attuale ha 4 riquadri, 4 operazioni rapide e 1 solo grafico (vedi «Semplicità» nelle decisioni). Priorità richiesta: prima la struttura grafica completa e navigabile, poi il collegamento a database e calcoli; alla fine verificare che ogni pulsante faccia davvero ciò che dice e che i dati restino dopo la chiusura e la riapertura.

Dove: cartella `gestione-immobiliare/` del repository `Giuseppe210992/a`, ramo `ccr-dbc9b9b0-cjwcqx`. Le altre cartelle del repository (client, server, archivi ZIP…) sono di altri progetti e non vanno toccate.

## 2. Decisioni prese (e perché)

| Tema | Scelta | Motivo |
|---|---|---|
| Tecnologia | HTML + JavaScript senza framework, un solo pacchetto (`dist/web`), database **SQLite** (sql.js, WebAssembly incorporato) | Funziona offline, niente server, un solo file di dati, nessuna risorsa esterna (la politica di sicurezza della pagina vieta ogni connessione) |
| Programma Windows | **Electron** che mostra lo stesso pacchetto e salva su file | L'utente usa un PC Windows normale; si costruisce su Windows in automatico (GitHub Actions) |
| Dove stanno i dati (Windows) | `Documenti\Gestione Immobiliare\Dati\archivio.sqlite` (+ `.bak`), copie in `…\Backup\` | Cartella che l'utente vede, copia e salva facilmente. Salvataggio atomico: mai un file a metà |
| Dove stanno i dati (versione portatile / chiavetta) | `<cartella del file .exe>\Gestione Immobiliare - Dati\Dati\archivio.sqlite` (+ `.bak`), copie in `…\Backup\` | La chiavetta porta con sé i dati. electron-builder imposta `PORTABLE_EXECUTABLE_DIR` (cartella dell'`.exe`); `cartellaBaseDati()` in `electron/host-archivio.cjs` sceglie la cartella (`GESTIONE_IMMOBILIARE_DATI` > portatile > Documenti). Se la cartella è temporanea (tipico: `.exe` aperto dentro lo ZIP scaricato) all'avvio compare un avviso e nel pannello Backup una nota gialla, perché Windows la svuota. Il portatile decomprime il programma in `%TEMP%` (di default cartella con l'id della compilazione, `portable.unpackDirName` di electron-builder) |
| Dove stanno i dati (browser) | IndexedDB del browser | Solo per la versione browser; per questo c'è «Esporta l'archivio completo» |
| Importi | Sempre **centesimi interi** | Nessun errore di arrotondamento; le ripartizioni usano il metodo del resto maggiore, quindi la somma torna sempre esatta |
| Scaglioni | **Quelli indicati dall'utente**, preimpostati al primo avvio (e dopo «Cancella tutti i dati») in `SCAGLIONI_INIZIALI` di `src/js/data/inizializza.js`: 5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre; stessa tabella per Luca, Giuseppe e tutte le zone. In centesimi le soglie sono 0, 260001, 520001, 780001, 1300001 | «Fino a X» comprende X, mentre il motore legge ogni soglia come «da» (inclusa): per questo il 2° scaglione parte da 2.600,01 € (a 2.600,00 € precisi si è ancora al 5%). Se l'utente preferisse che a 2.600,00 scatti già l'8% basta spostare le soglie di un centesimo indietro (e rieseguire le prove `scaglioni-agenzia`). Impostazioni → Scaglioni ha «Ripristina gli scaglioni dell'agenzia» (serve anche per gli archivi vecchi rimasti senza scaglioni) |
| Metodo di calcolo (predefinito) | **Scaglione raggiunto**: la percentuale dello scaglione raggiunto si applica a *tutto* il cumulo mensile. Alternativa: progressivo (a fasce) | Era l'interpretazione più vicina alla richiesta («percentuale raggiunta»). Cambiabile in Impostazioni → *Metodo di calcolo*, tutto si ricalcola subito |
| Base del cumulo (predefinita) | Per **collaboratore e zona** (alternative: per zona; per collaboratore) | Richiesta: «cumulo mensile per zona» con Luca e Giuseppe |
| Maturazione (predefinita) | **Alla conclusione** (rogito). Alternativa: in proporzione agli incassi | Le pratiche si contano per `data_rogito` (se manca, per `data_pratica`) |
| Importi lordi | Nessuna ritenuta, contributo o tassa sui compensi dei collaboratori | Non richiesto: da confermare |
| Capo e segretaria | **Collaboratori con `collaboratori.percentuale_fissa`** (Capo 15, Segretaria 4, creati al primo avvio e, dalla migrazione 3, anche negli archivi che hanno già collaboratori). Per ogni pratica conclusa con provvigioni, `modello.js` aggiunge a `p.voci` una voce `fissa: true` (quota 0, fatturato 0, `baseCent` = somma delle provvigioni dei collaboratori della pratica, provvigione = base × percentuale, arrotondata al centesimo). Così maturata/liquidata/da liquidare, liquidazioni, CSV e riquadri funzionano senza altro codice. Non entrano nelle quote delle pratiche, nelle ripartizioni delle zone, nella ripartizione predefinita né nel «collaboratore unico». **Ipotesi da confermare con l'utente:** base = totale delle provvigioni dei collaboratori (non il compenso) e importo **in più** (non tolto a Luca e Giuseppe); la percentuale si applica retroattivamente come gli scaglioni | Richiesta dell'utente: «il capo e la segretaria prenderanno il 15% e il 4% del totale delle provvigioni in qualsiasi zona» |
| Mese della proposta | `pratiche.mese_proposta` (AAAA-MM). Se c'è, `dataRif` = primo giorno di quel mese (cumulo, periodi, grafici); `dataEtichetta` mostra «settembre 2026»; `data_pratica` resta il giorno vero di inserimento (usato per i pagamenti). Per le pratiche vecchie è vuoto e conta il rogito | Richiesta dell'utente: «da lì verrà calcolato se è cumulativo o meno» |
| Nominativi | Obbligatori nel modulo (non a livello di database, per non rompere le pratiche vecchie) | Richiesta dell'utente |
| Dati incompleti | La pratica si salva comunque e viene segnalata come incompleta (la zona è l'unico dato obbligatorio del modulo) | Non perdere mai ciò che l'utente ha scritto |
| Modulo «Nuova pratica» | **Tre passi, a rogito concluso**: zona, prezzo di vendita, pagamenti per parte; tipo di immobile, prezzo di acquisto, nomi, aliquota IVA e note stanno in «Altre informazioni» (`<details>` chiuso, si apre da solo se c'è un errore). **Niente** codice, stato, date, via. Codice automatico `AAAA/NNN` (`prossimoCodice`), stato sempre `conclusa`, `data_pratica = data_rogito = oggi` | Richiesta dell'utente: «i dati li inseriamo sempre a conclusione», «interessa solo la zona» |
| Compensi dai pagamenti | Per ogni parte: **contanti, bonifico e assegno comprendono tutti l'IVA** (l'utente lo ha corretto: all'inizio i contanti erano senza IVA). Si sommano i tre importi e si scorpora **una sola volta** sul totale, arrotondato al centesimo (mezzi verso l'alto: `src/js/data/calc/compensi.js`). Compenso senza IVA = somma delle due parti. Flag `pratiche.compensi_da_pagamenti` = 1. Le colonne `compenso_venditore_cent` / `compenso_acquirente_cent` sono un valore derivato, ricalcolato dal modello a ogni lettura e riscritto a ogni salvataggio (nessuna migrazione dello schema per il cambio dei contanti) | Richiesta dell'utente |
| Pagato = incassato | Per le pratiche nuove `totaleLordo` = quanto pagato e `incassato` = pagato alla conclusione + incassi successivi | **Da confermare**: ipotesi che gli importi scritti siano già stati incassati |
| Pratiche vecchie | Con `compensi_da_pagamenti = 0` restano com'erano (compenso senza IVA + IVA in cima). Il flag **esplicito** vince sempre su quello dedotto: risalvare una pratica vecchia non la trasforma | La migrazione 2 non tocca i dati esistenti |
| Ripartizione | **Automatica per zona**: tabella `zone_quote`. Ordine: quella della zona (deve fare 100%) → predefinita delle Impostazioni (100%) → unico collaboratore attivo → nessuna (avviso e conferma al salvataggio). Le quote si **copiano sulla pratica al salvataggio**: cambiare la zona dopo non riscrive le pratiche già inserite | Richiesta dell'utente. **Le ripartizioni vere delle zone vanno ancora inserite dall'utente** |
| Primo avvio | Archivio vuoto, con i soli collaboratori **Luca** e **Giuseppe** (modificabili) | Nessun dato dimostrativo, come richiesto |
| Una sola finestra | Electron: blocco di istanza singola; browser: Web Locks | Due finestre aperte si sovrascriverebbero i dati |
| Conferme | Sempre prima di eliminare dati, importare, ripristinare o azzerare; prima di ogni operazione distruttiva viene salvata una copia di sicurezza | Richiesta esplicita |
| Semplicità | L'utente vuole «il più semplice possibile, che anche un bimbo lo possa usare, non troppi grafici»: dashboard con 4 riquadri, 4 pulsanti e **un solo grafico**; filtri della dashboard ridotti al periodo (zona, collaboratore e vista mensile/annuale restano nelle Statistiche); Statistiche con 3 indicatori e 3 grafici | Richiesta dell'utente. I moduli `dumbbell` e `sparkline` sono stati tolti perché non servono più |
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
src/js/data/schema.js, db.js          schema SQLite (user_version 3) e classe Archivio (transazioni, esporta, sostituisci)
src/js/data/calc/                     MOTORE DI CALCOLO: funzioni pure (scaglioni.js, compensi.js, modello.js, aggregati.js)
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
npm test                  # 141 prove su calcoli, compensi dai pagamenti, migrazione dello schema, scaglioni dell'agenzia, date, formati, archivio, host file, icone (circa 1 s)
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
- Dopo `reload()` il primo Tab può non arrivare a nessun elemento (il cursore resta su `<body>`): una volta su GitHub la prova di accessibilità ha fallito per questo, con lo stesso codice di un'esecuzione verde. Le prove usano `primoTab()` che riprova.
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
2. L'utente inserisce le zone, controlla gli scaglioni preimpostati e conferma le tre scelte di calcolo (metodo, base del cumulo, maturazione); da chiarire anche se Luca e Giuseppe devono avere la stessa tabella (oggi sì).
3. Con le risposte: correggere ciò che emerge, poi eventuale firma digitale dell'installatore e pubblicazione con un tag `v1.0.0` (il flusso di lavoro crea da solo la pagina «Releases»).
4. Facoltativo: palette verde/grigia, stampa PDF delle schede, esportazione verso il commercialista.

## 8. Come lavorare con l'utente

Scrive dal telefono e delega l'esecuzione: messaggi **in italiano, brevi, leggibili da telefono**; proporre sempre un valore predefinito e chiedere solo ciò che può dire solo lui; sui compensi e sulle provvigioni **massimo rigore** (mostrare i passaggi, dire che cosa è stimato); stato onesto con tabella «verificato / non verificato», mai un verde non guadagnato; chiudere con «Azione richiesta a te». Nel repository mai dati personali: niente password, codici fiscali, recapiti, nomi di clienti o familiari.
