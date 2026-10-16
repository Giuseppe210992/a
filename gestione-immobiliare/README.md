# Gestione Immobiliare

Gestionale **offline** per un'agenzia immobiliare: pratiche di compravendita, compensi con IVA, incassi, provvigioni dei collaboratori a scaglioni mensili, liquidazioni, statistiche e backup. Nessun server, nessun abbonamento, nessuna connessione a Internet: i dati stanno in un file sul tuo computer.

> **Stato in breve** (dettagli nella tabella «Stato delle verifiche»): calcoli, schermate e salvataggio dei dati sono provati in automatico. Il programma per Windows viene costruito e avviato da un Windows vero nei test automatici di GitHub, ma **non è ancora stato provato da una persona su un PC Windows**: la lista da seguire è in [docs/PROVA-SU-WINDOWS.md](docs/PROVA-SU-WINDOWS.md).

---

## 1. Come averlo sul PC Windows

1. Su GitHub apri il repository `Giuseppe210992/a` → **Actions** → l'esecuzione **Gestione Immobiliare** più recente con la spunta verde.
2. In fondo, sezione **Artifacts**: scarica **Gestione-Immobiliare-per-Windows** (uno ZIP) ed estrailo.
3. Due file:
   - `Gestione-Immobiliare-1.0.0-Installazione.exe`: installa il programma (icona sul desktop e nel menu Start);
   - `Gestione-Immobiliare-1.0.0-Portatile.exe`: si apre senza installare (anche da chiavetta USB).
4. Alla prima apertura Windows può dire **«Windows ha protetto il PC»**: il programma non ha la firma digitale a pagamento. Premi **Ulteriori informazioni → Esegui comunque**.

Per le versioni con etichetta `v…` (ad esempio `v1.0.0`) i file compaiono anche nella pagina **Releases** del repository.

**Versione solo browser** (senza installare nulla): artifact **Gestione-Immobiliare-versione-browser** → apri `index.html` con Chrome o Edge. ⚠️ In questo caso i dati restano **dentro il browser** (se cancelli i dati di navigazione, spariscono): usa spesso *Backup e archivio storico → Esporta l'archivio completo*.

## 2. Dove sono i dati

| Cosa | Dove (Windows) |
|---|---|
| Archivio | `Documenti\Gestione Immobiliare\Dati\archivio.sqlite` |
| Versione precedente (a ogni salvataggio) | `…\Dati\archivio.sqlite.bak` |
| Copie di sicurezza | `Documenti\Gestione Immobiliare\Backup\` |

Per fare una copia a mano basta copiare la cartella `Gestione Immobiliare`. Per cambiare PC: installa il programma e metti la cartella nei Documenti del nuovo PC (oppure usa *Esporta* e *Importa*). Disinstallare il programma **non cancella i dati**. Se i Documenti sono sincronizzati con OneDrive va bene, ma non aprire lo stesso archivio da due PC nello stesso momento.

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
5. **Scaglione raggiunto** = l'ultimo scaglione la cui soglia è raggiunta dal cumulo (raggiungere esattamente la soglia significa essere già nello scaglione superiore).
6. **Provvigione**, due metodi (scegli in *Impostazioni → Metodo di calcolo*):
   - **Scaglione raggiunto** (predefinito): la percentuale dello scaglione raggiunto si applica a **tutto** il cumulo del mese;
   - **Progressivo (a fasce)**: ogni percentuale si applica solo alla parte di cumulo che cade nel suo scaglione.
7. **Maturata** = dovuta al collaboratore: alla conclusione della pratica (predefinito) oppure in proporzione agli incassi. **Da liquidare** = maturata − già liquidata.

**Esempio** (scaglioni di esempio: da 0 € il 30%, da 10.000 € il 35%, da 20.000 € il 40%). Luca, zona Centro, ottobre: due pratiche concluse con quote di fatturato 8.000 € e 6.000 € → cumulo **14.000 €** → secondo scaglione (35%):

| Metodo | Calcolo | Provvigione |
|---|---|---|
| Scaglione raggiunto | 35% × 14.000 € | **4.900 €** |
| Progressivo | 30% × 10.000 € + 35% × 4.000 € = 3.000 € + 1.400 € | **4.400 €** |

La differenza (500 €) è il motivo per cui il metodo va scelto con attenzione, in base al tuo accordo di collaborazione.

## 5. Scelte fatte al posto tuo (da confermare)

| Tema | Scelta attuale | Dove si cambia |
|---|---|---|
| Scaglioni e percentuali | **Nessuno inserito**: finché non li scrivi le provvigioni sono a zero. «Aggiungi scaglione» propone 0 € → 30%, 10.000 € → 35%, 20.000 € → 40% solo come punto di partenza | Impostazioni → Scaglioni e percentuali |
| Come si applicano | Scaglione raggiunto sul totale del mese | Impostazioni → Metodo di calcolo |
| Cumulo | Per collaboratore e per zona | Impostazioni → Metodo di calcolo |
| Quando matura | Alla conclusione della pratica (rogito) | Impostazioni → Metodo di calcolo |
| Importi | Lordi, senza ritenute né contributi | non previsto |
| Primo avvio | Archivio vuoto con solo Luca e Giuseppe | Impostazioni → Collaboratori |
| IVA | 22% proposta; aliquote 22, 10, 4, 0 | Impostazioni → Aliquote IVA |

## 6. Stato delle verifiche

«Verificato» vuol dire controllato da prove automatiche **che sono state eseguite** (l'esito è scritto); «non verificato» vuol dire che nessuno l'ha ancora provato.

| Componente | Stato | Come |
|---|---|---|
| Calcoli (scaglioni, cumulo, provvigioni, ripartizioni, date, formati) e archivio | ✅ Verificato | 85 prove automatiche; i numeri della dashboard sono confrontati con un calcolo fatto a mano, indipendente dal programma |
| Tutte le schermate e ogni pulsante nel browser (Chromium) | ✅ Verificato | 168 prove nel browser su 15 pratiche di prova: 168 su 168 superate in locale (anche con il computer rallentato 4 volte) e **sul server di GitHub** (Chromium su Linux) |
| Dati salvati dopo chiusura e riapertura | ✅ Verificato | Browser (profilo persistente, 3 sessioni di fila, archivio danneggiato e recupero) e programma Electron su file vero |
| Programma Electron con file reali | ✅ Verificato su **Linux** | 5 prove: si avvia usando il file su disco; inserimento di pratica, incasso, esportazione e backup; chiusura e riapertura con i dati ancora presenti; importazione e ripristino sul file vero; una seconda copia del programma non si apre |
| Costruzione di installatore e portatile + avvio del programma impacchettato su **Windows** | ✅ Verificato su Windows Server (GitHub) | A ogni modifica GitHub costruisce i due file `.exe` e **avvia il programma impacchettato** su un Windows vero: 5 prove su 5 superate (dati su file, chiusura e riapertura, importazione e ripristino, seconda copia rifiutata). L'esecuzione di installatore e versione portatile *veri* è ⏳ in verifica nell'esecuzione successiva |
| Aspetto e contrasto: 5 larghezze (390, 768, 1024, 1366, 1920 px), tema chiaro e scuro, uso da tastiera | ✅ Verificato in Chromium | Prove di layout, contrasto (≥ 4,5:1) e tastiera |
| Funzionamento senza Internet | ✅ Verificato | Nessuna richiesta di rete; la pagina vieta per regola ogni connessione esterna |
| Installazione su un **PC Windows vero** (SmartScreen, antivirus, scala dello schermo) | ❌ **Non verificato** | Serve la tua prova: [docs/PROVA-SU-WINDOWS.md](docs/PROVA-SU-WINDOWS.md) |
| Lettore di schermo (NVDA/Narrator) | ❌ Non verificato | Etichette e ordine di lettura controllati in automatico, ma mai ascoltati con un lettore vero |
| Telefono o tablet reali | ❌ Non verificato | Solo simulazione di schermo stretto |
| Firefox e Safari | ❌ Non verificato | Provato solo con Chromium (Chrome/Edge) |
| Firma digitale dell'installatore | ❌ Non presente | Per questo Windows mostra l'avviso |

## 7. Per chi sviluppa

```
cd gestione-immobiliare
npm ci
npm test                          # prove sui calcoli e sull'archivio
npm run test:e2e                  # prove nel browser (serve: npx playwright-core install chromium)
GI_RALLENTA=4 npm run test:e2e    # idem con il browser 4 volte più lento
GI_RITARDO=150 npm run test:e2e   # idem con eventi e scritture su disco in ritardo (scova le letture troppo presto)
npm run programma                 # apre il programma (Electron) dai sorgenti
npm run test:programma            # prova il programma Electron
npm run pacchetto                 # installatore + portatile (su Windows)
node build.mjs                    # solo l'interfaccia, in dist/web (aggiungi --leggibile per non minimizzare)
```

Il flusso di lavoro `.github/workflows/gestione-immobiliare.yml` esegue le prove e costruisce il programma per Windows a ogni modifica della cartella. Per ripartire da zero in una nuova conversazione leggi [docs/RIPARTENZA.md](docs/RIPARTENZA.md).
