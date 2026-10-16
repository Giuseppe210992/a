# Gestione Immobiliare

Gestionale **offline** per un'agenzia immobiliare: pratiche di compravendita, compensi con IVA, incassi, provvigioni dei collaboratori a scaglioni mensili, liquidazioni, statistiche e backup. Nessun server, nessun abbonamento, nessuna connessione a Internet: i dati stanno in un file sul tuo computer.

> **Stato in breve** (dettagli nella tabella «Stato delle verifiche»): calcoli, schermate e salvataggio dei dati sono provati in automatico. Il programma per Windows viene costruito e avviato da un Windows vero nei test automatici di GitHub, ma **non è ancora stato provato da una persona su un PC Windows**: la lista da seguire è in [docs/PROVA-SU-WINDOWS.md](docs/PROVA-SU-WINDOWS.md).

---

## 1. Come averlo sul PC Windows

1. Su GitHub apri il repository `Giuseppe210992/a` → **Actions** → l'esecuzione **Gestione Immobiliare** più recente con la spunta verde.
2. In fondo, sezione **Artifacts**: scarica **Gestione-Immobiliare-per-Windows** (uno ZIP) ed estrailo.
3. Due file:
   - `Gestione-Immobiliare-1.0.0-Installazione.exe`: installa il programma (icona sul desktop e nel menu Start);
   - `Gestione-Immobiliare-1.0.0-Portatile.exe`: si apre senza installare ed è quello da mettere su una chiavetta USB (istruzioni nel paragrafo «Uso su chiavetta USB» più sotto).
4. Alla prima apertura Windows può dire **«Windows ha protetto il PC»**: il programma non ha la firma digitale a pagamento. Premi **Ulteriori informazioni → Esegui comunque**.

Per le versioni con etichetta `v…` (ad esempio `v1.0.0`) i file compaiono anche nella pagina **Releases** del repository.

**Versione solo browser** (senza installare nulla): artifact **Gestione-Immobiliare-versione-browser** → apri `index.html` con Chrome o Edge. ⚠️ In questo caso i dati restano **dentro il browser** (se cancelli i dati di navigazione, spariscono): usa spesso *Backup e archivio storico → Esporta l'archivio completo*.

## 2. Dove sono i dati

| Cosa | Dove (Windows) |
|---|---|
| Archivio | `Documenti\Gestione Immobiliare\Dati\archivio.sqlite` |
| Versione precedente (a ogni salvataggio) | `…\Dati\archivio.sqlite.bak` |
| Copie di sicurezza | `Documenti\Gestione Immobiliare\Backup\` |

Questo vale per il programma **installato**. La versione **portatile** tiene i dati sulla chiavetta, accanto a sé (vedi sotto).

Per fare una copia a mano basta copiare la cartella `Gestione Immobiliare`. Per cambiare PC: installa il programma e metti la cartella nei Documenti del nuovo PC (oppure usa *Esporta* e *Importa*). Disinstallare il programma **non cancella i dati**. Se i Documenti sono sincronizzati con OneDrive va bene, ma non aprire lo stesso archivio da due PC nello stesso momento.

### Uso su chiavetta USB (versione portatile)

1. **Estrai lo ZIP** (tasto destro → *Estrai tutto*). Non aprire il programma direttamente da dentro lo ZIP: Windows lo farebbe girare da una cartella temporanea e i dati andrebbero persi (il programma se ne accorge e te lo dice prima di partire).
2. Copia **solo** il file `Gestione-Immobiliare-1.0.0-Portatile.exe` sulla chiavetta, meglio in una cartella tutta sua (ad esempio `Gestione Immobiliare`). Pesa circa 115 MB.
3. Aprilo **dalla chiavetta**. Alla prima apertura su un PC Windows può dire «Windows ha protetto il PC»: *Ulteriori informazioni → Esegui comunque*. Windows prepara il programma in una cartella temporanea del PC, quindi l'avvio richiede qualche secondo in più di un programma normale (sul computer di prova di GitHub meno di 10 secondi; con chiavette o PC lenti di più).
4. I dati nascono nella cartella **`Gestione Immobiliare - Dati`**, accanto al file `.exe` sulla chiavetta (l'archivio in `Dati`, le copie di sicurezza in `Backup`). Portando via la chiavetta porti via anche i dati: non finisce nulla nella cartella Documenti del PC. La schermata *Backup e archivio storico* lo scrive chiaramente.
5. Per finire: **chiudi il programma con la X prima di togliere la chiavetta** (in basso a sinistra deve esserci «Dati salvati», non «Salvataggio…»; meglio ancora usare «Rimozione sicura dell'hardware»). Se la togli per errore mentre il programma è aperto compare «Errore di salvataggio»: quello che era già salvato resta integro, ma l'ultima modifica potrebbe mancare. Chiudi il programma, rimetti la chiavetta e riaprilo.

Da sapere:

- **Una chiavetta si perde o si rompe.** Ogni tanto fai una copia anche sul computer: *Backup e archivio storico → Esporta l'archivio completo*.
- **Mai la stessa chiavetta su due PC nello stesso momento**, e non copiare la cartella dei dati mentre il programma è aperto.
- La chiavetta non deve essere piena né protetta da scrittura (a volte c'è un interruttore sul bordo): in quel caso il programma lo dice e non parte.
- Se hai già dati nella versione installata: lì *Esporta l'archivio completo*, poi nella versione portatile *Importa un backup*. Le due versioni non condividono i dati da sole.
- Tema chiaro/scuro, barra ridotta e filtri della dashboard sono preferenze **del singolo PC**: su un altro computer ricompaiono quelli predefiniti. I dati veri (pratiche, incassi, impostazioni) viaggiano con la chiavetta.
- Per partire, il file portatile copia il programma in una cartella temporanea del PC (qualche centinaio di MB), che di solito resta lì: si può cancellare a mano o la ripulisce Windows. I dati non sono lì.
- Alcuni PC aziendali o di scuola bloccano i programmi che partono da una chiavetta: in quel caso serve l'amministratore.
- La versione nel browser (`index.html`) **non** è adatta alla chiavetta: i dati resterebbero nel browser di quel PC.

## 3. Le otto sezioni

| Voce della barra laterale | A cosa serve |
|---|---|
| **Dashboard** | Panoramica che si aggiorna da sola: 6 riquadri (compravendite concluse, totale compensi registrati, provvigioni maturate, provvigioni ancora da liquidare, valore complessivo degli immobili venduti, pratiche in corso), filtri per mese/anno/intervallo/zona/collaboratore, 6 grafici con i numeri scritti (mensile ↔ annuale), 8 operazioni rapide, ultime pratiche, avvisi discreti. In alto: ricerca veloce di pratiche, clienti e immobili e il pulsante **+ Nuova pratica** |
| **Nuova pratica** | Inserimento di una compravendita: immobile, prezzi, venditore e acquirente, compensi, IVA, ripartizione tra collaboratori. Il riepilogo e la stima delle provvigioni si aggiornano mentre scrivi. Se manca qualcosa la pratica si salva comunque e resta segnalata come incompleta |
| **Archivio pratiche** | Elenco con ricerca, filtri, ordinamento e pagine; la scheda di ogni pratica con incassi, provvigioni per collaboratore, modifica ed eliminazione (con conferma) |
| **Provvigioni e liquidazioni** | Per ogni collaboratore: maturato, già liquidato, ancora da liquidare; registrazione dei pagamenti (liquidazioni) e dello storico |
| **Cumulo mensile per zona** | Fatturato cumulato del mese di Luca e Giuseppe per zona, scaglione raggiunto, percentuale applicata e quanto manca al successivo |
| **Statistiche e grafici** | Compensi e incassi nel tempo, compravendite concluse, valore venduto, provvigioni e margine dell'agenzia, compensi per zona e per collaboratore, tipi di immobile, prezzi di acquisto e di vendita; tutto con i numeri scritti e una tabella equivalente |
| **Backup e archivio storico** | Crea un backup, esporta l'archivio completo o in CSV (Excel), importa, ripristina, verifica l'integrità, azzera (solo scrivendo CANCELLA). Ogni operazione che sostituisce o cancella dati chiede conferma e salva prima una copia di sicurezza |
| **Impostazioni** | Collaboratori, zone, scaglioni e percentuali (anche diversi per zona), metodo di calcolo, ripartizione predefinita, aliquote IVA, preferenze (tema chiaro/scuro, soglie degli avvisi, backup automatico), informazioni |

La barra laterale è fissa; **Riduci barra** lascia solo le icone (il nome compare passandoci il mouse). Su schermi stretti diventa un menu a scomparsa.

## 4. Come si calcolano le provvigioni

Tutti gli importi sono in **euro lordi** (nessuna ritenuta o contributo) e calcolati in centesimi interi.

1. **Compensi della pratica** = compenso dal venditore + compenso dall'acquirente (imponibile). L'**IVA** si aggiunge a parte; il *totale dovuto* è compensi + IVA.
2. **Quota di ciascun collaboratore** = compensi × percentuale di ripartizione (la somma deve fare 100%; gli eventuali centesimi di resto si assegnano con il metodo del «resto maggiore», così la somma torna sempre esatta).
3. **Mese di competenza** = mese della data del rogito (se manca, della data della pratica). Contano solo le pratiche **concluse**.
4. **Cumulo mensile** = somma delle quote di fatturato dello stesso mese, per collaboratore e per zona (cambiabile: solo per zona, solo per collaboratore).
5. **Scaglione raggiunto** = l'ultimo scaglione la cui soglia è raggiunta dal cumulo (raggiungere esattamente la soglia significa essere già nello scaglione superiore). Per questo «5% **fino a** 2.600 €» è scritto con un secondo scaglione che parte da **2.600,01 €**: con 2.600,00 € precisi si è ancora al 5%.
6. **Provvigione**, due metodi (scegli in *Impostazioni → Metodo di calcolo*):
   - **Scaglione raggiunto** (predefinito): la percentuale dello scaglione raggiunto si applica a **tutto** il cumulo del mese;
   - **Progressivo (a fasce)**: ogni percentuale si applica solo alla parte di cumulo che cade nel suo scaglione.
7. **Maturata** = dovuta al collaboratore: alla conclusione della pratica (predefinito) oppure in proporzione agli incassi. **Da liquidare** = maturata − già liquidata.

**Esempio** (con gli scaglioni dell'agenzia: 5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre). Luca, zona Centro, ottobre: due pratiche concluse con quote di fatturato 8.000 € e 6.000 € → cumulo **14.000 €** → quinto scaglione (20%):

| Metodo | Calcolo | Provvigione |
|---|---|---|
| Scaglione raggiunto | 20% × 14.000 € | **2.800 €** |
| Progressivo | 5% × 2.600 € + 8% × 2.600 € + 11% × 2.600 € + 15% × 5.200 € + 20% × 1.000 € = 130 + 208 + 286 + 780 + 200 | **1.604 €** |

La differenza (1.196 €) è il motivo per cui il metodo va scelto con attenzione, in base al tuo accordo di collaborazione.

## 5. Scelte fatte al posto tuo (da confermare)

| Tema | Scelta attuale | Dove si cambia |
|---|---|---|
| Scaglioni e percentuali | **Quelli che hai indicato**, preimpostati al primo avvio e uguali per Luca, Giuseppe e tutte le zone: 5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre i 13.000 €. «Fino a» comprende l'estremo (2.600,00 € precisi = 5%; da 2.600,01 € = 8%). Si cambiano e si ripristinano con un pulsante; una zona può avere una tabella propria. Se Luca e Giuseppe dovessero avere percentuali diverse tra loro, oggi non è previsto | Impostazioni → Scaglioni e percentuali |
| Come si applicano | Scaglione raggiunto sul totale del mese | Impostazioni → Metodo di calcolo |
| Cumulo | Per collaboratore e per zona | Impostazioni → Metodo di calcolo |
| Quando matura | Alla conclusione della pratica (rogito) | Impostazioni → Metodo di calcolo |
| Importi | Lordi, senza ritenute né contributi | non previsto |
| Primo avvio | Nessuna pratica né zona; ci sono Luca e Giuseppe e gli scaglioni di sopra | Impostazioni → Collaboratori, Scaglioni |
| IVA | 22% proposta; aliquote 22, 10, 4, 0 | Impostazioni → Aliquote IVA |

## 6. Stato delle verifiche

«Verificato» vuol dire controllato da prove automatiche **che sono state eseguite** (l'esito è scritto); «non verificato» vuol dire che nessuno l'ha ancora provato.

| Componente | Stato | Come |
|---|---|---|
| Calcoli (scaglioni, cumulo, provvigioni, ripartizioni, date, formati) e archivio | ✅ Verificato | 91 prove automatiche; i numeri della dashboard sono confrontati con un calcolo fatto a mano, indipendente dal programma |
| Tutte le schermate e i pulsanti nel browser (Chromium; eccezioni elencate sotto) | ✅ Verificato (in locale e su GitHub) | 218 prove nel browser su 15 pratiche di prova: **218 su 218 superate** sia in locale (anche con il browser rallentato 4 volte e con ritardi simulati di 150 ms) sia sul server di GitHub (Chromium su Linux). Le prove eseguono circa il **90%** delle righe del programma (misurato: vedi sotto) |
| Dati salvati dopo chiusura e riapertura | ✅ Verificato | Browser (profilo persistente, 3 sessioni di fila, archivio danneggiato e recupero) e programma Electron su file vero |
| Programma Electron con file reali | ✅ Verificato su **Linux** | 6 prove: si avvia usando il file su disco; inserimento di pratica, incasso, esportazione e backup; chiusura e riapertura con i dati ancora presenti; importazione e ripristino sul file vero; una seconda copia del programma non si apre; **modalità chiavetta**: i dati e le copie nascono accanto al programma, nulla nella cartella personale, la cartella copiata altrove ritrova i dati, avviso se il programma gira da una cartella temporanea |
| Programma per **Windows**: costruzione, installazione, avvio, disinstallazione | ✅ Verificato su Windows Server (GitHub) | A ogni modifica GitHub costruisce i due file `.exe`, **esegue l'installatore vero** in modalità silenziosa, **avvia il programma installato** e lo prova (6 prove su 6: dati su file, chiusura e riapertura, importazione e ripristino, seconda copia rifiutata, modalità chiavetta), poi lo disinstalla. Lo stesso controllo è fatto anche sul programma non installato (cartella). In più il **vero file `…Portatile.exe`** viene copiato in una cartella «chiavetta», avviato e chiuso: l'archivio nasce accanto a lui (`Gestione Immobiliare - Dati\Dati\archivio.sqlite`, 98 KB, in meno di 10 secondi sul computer di prova di GitHub) e nei Documenti non compare nulla. Le prove con le schermate (inserire dati, chiudere, riaprire, spostare la cartella) usano invece il programma non impacchettato lanciato con la stessa variabile che il file portatile imposta, non il file portatile vero |
| Aspetto e contrasto: 5 larghezze (390, 768, 1024, 1366, 1920 px), tema chiaro e scuro, uso da tastiera | ✅ Verificato in Chromium | Prove di layout, contrasto (≥ 4,5:1) e tastiera |
| Funzionamento senza Internet | ✅ Verificato | Nessuna richiesta di rete; la pagina vieta per regola ogni connessione esterna |
| Installazione su un **PC Windows vero** (SmartScreen, antivirus, scala dello schermo) | ❌ **Non verificato** | Serve la tua prova: [docs/PROVA-SU-WINDOWS.md](docs/PROVA-SU-WINDOWS.md) |
| **Chiavetta USB fisica** (velocità, rimozione, un altro PC, antivirus che blocca i programmi su chiavetta) | ❌ **Non verificato** | Provata solo una cartella di un disco: serve la tua prova, punto 8 di [docs/PROVA-SU-WINDOWS.md](docs/PROVA-SU-WINDOWS.md) |
| Lettore di schermo (NVDA/Narrator) | ❌ Non verificato | Etichette e ordine di lettura controllati in automatico, ma mai ascoltati con un lettore vero |
| Telefono o tablet reali | ❌ Non verificato | Solo simulazione di schermo stretto |
| Firefox e Safari | ❌ Non verificato | Provato solo con Chromium (Chrome/Edge) |
| Firma digitale dell'installatore | ❌ Non presente | Per questo Windows mostra l'avviso |

### Controllo pulsante per pulsante

Per essere sicuro che ogni pulsante faccia davvero ciò che dice, ho **misurato quali righe del programma le prove eseguono** (`npm run copertura`): all'inizio l'87%, dopo aver scritto le prove mancanti il 90%. Fuori restano soprattutto i percorsi d'errore rarissimi (ad esempio un disco che non risponde), la schermata di recupero da un archivio danneggiato (provata a parte, ma non misurabile con questo metodo) e i due pulsanti che aprono le cartelle in Esplora file (provati fino alla chiamata, non fino alla finestra di Windows).

Questo controllo ha fatto emergere **difetti reali, ora corretti**:

1. Impostazioni: aggiungendo con il tasto Invio un collaboratore, una zona o un'aliquota IVA, la notifica diceva «aggiunto» ma l'elenco non si aggiornava finché non si cliccava altrove.
2. Ricerca rapida: Invio non faceva ciò che il suggerimento sotto l'elenco promette («Invio apre la prima pratica»).
3. Avvisi: se i dati cambiavano mentre gli avvisi si ricalcolavano, l'ultimo aggiornamento andava perso e il numero sulla campanella restava sbagliato; nascondere un avviso dalla dashboard non aggiornava la campanella.
4. Campo data: scrivendo le cifre una alla volta compariva solo la prima barra (20/102026).
5. Campi importo e percentuale: su un computer lento il testo selezionato poteva «rubare» il cursore a un altro campo appena scelto.
6. Ripartizione tra collaboratori: liberando un collaboratore in una riga, le altre righe non lo offrivano.
7. Finestre semplici (Registra incasso, Nuova zona, modifiche): Invio nel campo non confermava (ora conferma; nella liquidazione a più righe volutamente **no**).

## 7. Per chi sviluppa

```
cd gestione-immobiliare
npm ci
npm test                          # prove sui calcoli e sull'archivio
npm run test:e2e                  # prove nel browser (serve: npx playwright-core install chromium)
GI_RALLENTA=4 npm run test:e2e    # idem con il browser 4 volte più lento
GI_RITARDO=150 npm run test:e2e   # idem con eventi e scritture su disco in ritardo (scova le letture troppo presto)
npm run copertura                 # quali righe del programma le prove eseguono (aggiungi -- --dettagli per l'elenco)
npm run programma                 # apre il programma (Electron) dai sorgenti
npm run test:programma            # prova il programma Electron
npm run pacchetto                 # installatore + portatile (su Windows)
node build.mjs                    # solo l'interfaccia, in dist/web (aggiungi --leggibile per non minimizzare)
```

Il flusso di lavoro `.github/workflows/gestione-immobiliare.yml` esegue le prove e costruisce il programma per Windows a ogni modifica della cartella. Per ripartire da zero in una nuova conversazione leggi [docs/RIPARTENZA.md](docs/RIPARTENZA.md).
