# Prova su un PC Windows: lista passo-passo

Tutto il resto è stato provato in automatico (calcoli, schermate, salvataggio dei dati), ma **non su un PC Windows vero**, con il tuo schermo, il tuo antivirus e le tue mani. Questa lista serve a quello: circa 20 minuti. Per ogni punto scrivi **OK** oppure **NO** (e cosa hai visto).

Ti serve: un PC con Windows 10 o 11 e un account GitHub con accesso al repository `Giuseppe210992/a`.

---

## 1. Scarica e installa

1. Apri il repository su GitHub → scheda **Actions** → clicca sull'esecuzione **Gestione Immobiliare** più recente con la spunta verde sul ramo `ccr-dbc9b9b0-cjwcqx`.
2. In fondo alla pagina, sezione **Artifacts**, scarica **Gestione-Immobiliare-per-Windows** (è uno ZIP) ed estrailo (tasto destro → *Estrai tutto*).
3. Dentro trovi due file:
   - `Gestione-Immobiliare-1.0.0-Installazione.exe` → installa il programma, con icona sul desktop e nel menu Start;
   - `Gestione-Immobiliare-1.0.0-Portatile.exe` → si apre senza installare; è quello per la chiavetta USB (prova facoltativa al punto 8).
4. Apri l'**Installazione**. Windows può mostrare **«Windows ha protetto il PC»**: succede perché il programma non ha la firma digitale a pagamento. Premi **Ulteriori informazioni** → **Esegui comunque**. Non è un virus: il codice è tutto nel repository.

| # | Cosa controllare | Esito |
|---|---|---|
| 1.1 | L'installazione finisce senza errori e compare l'icona «Gestione Immobiliare» | |
| 1.2 | Il programma si apre in una finestra, in italiano, senza messaggi di errore | |

## 2. Primo avvio

Si apre un archivio **senza pratiche né zone**: nessun dato dimostrativo. Ci sono i due collaboratori, **Luca** e **Giuseppe**, e gli **scaglioni che hai indicato** (5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre i 13.000 €).

| # | Cosa controllare | Esito |
|---|---|---|
| 2.1 | A sinistra c'è la barra con 8 voci: Dashboard, Nuova pratica, Archivio pratiche, Provvigioni e liquidazioni, Cumulo mensile per zona, Statistiche e grafici, Backup e archivio storico, Impostazioni | |
| 2.2 | In alto: «Gestione Immobiliare», la data di oggi, il periodo, la ricerca e il pulsante **+ Nuova pratica** | |
| 2.3 | La dashboard mostra 6 riquadri a zero e un invito a inserire la prima pratica | |
| 2.4 | **Riduci barra** nasconde i nomi e lascia le icone; passando il mouse su un'icona compare il nome; la scelta resta dopo aver chiuso e riaperto | |

## 3. Imposta i tuoi numeri (Impostazioni)

Gli scaglioni sono già impostati con quelli che mi hai indicato. Vai in **Impostazioni**, controllali e completa il resto:

1. **Zone** → aggiungi le tue zone di lavoro (ad esempio i comuni o i quartieri in cui operi).
2. **Scaglioni e percentuali** → controlla le cinque righe: da 0,00 € il 5%, da 2.600,01 € l'8%, da 5.200,01 € l'11%, da 7.800,01 € il 15%, da 13.000,01 € il 20%. Le soglie partono da un centesimo in più perché «fino a 2.600 €» comprende 2.600,00 €: con quella cifra precisa si è ancora al 5%. Se sono sbagliate le cambi tu; con **Ripristina gli scaglioni dell'agenzia** torni a questi.
3. **Metodo di calcolo** → scegli le tre cose che incidono sugli importi (ognuna ha una spiegazione e un esempio con i tuoi numeri):
   - *Scaglione raggiunto* oppure *Progressivo (a fasce)*;
   - cumulo *per collaboratore e per zona* / *per zona* / *per collaboratore*;
   - provvigione maturata *alla conclusione* oppure *in proporzione agli incassi*.
4. **Aliquote IVA** → controlla le aliquote (22%, 10%, 4%, 0% e quella proposta).

| # | Cosa controllare | Esito |
|---|---|---|
| 3.1 | Dopo aver cambiato il metodo compare «Impostazione salvata» | |
| 3.2 | L'esempio in *Metodo di calcolo* coincide con il tuo conto a mano per lo stesso cumulo | |
| 3.3 | In *Scaglioni e percentuali* le cinque righe sono quelle che hai indicato (5%, 8%, 11%, 15%, 20%) e sotto, in «Come vengono lette le soglie», si legge «da 0,00 € a 2.600,00 € → 5%», … «da 13.000,01 € in su → 20%» | |
| 3.4 | Scrivendo 10.000 in «Prova con un cumulo mensile di» il programma dà **1.500,00 €** con *scaglione raggiunto* e **954,00 €** con *progressivo* (se il tuo conto a mano è diverso, dimmi qual è) | |

## 4. Inserisci una pratica (vera o di prova)

**+ Nuova pratica** → compila almeno: data, zona, indirizzo dell'immobile, prezzo di vendita, compensi, ripartizione tra Luca e Giuseppe (la somma deve fare 100%) → **Salva**.

| # | Cosa controllare | Esito |
|---|---|---|
| 4.1 | Mentre scrivi, il riepilogo (compensi, IVA, totale, provvigioni stimate) si aggiorna da solo | |
| 4.2 | Se lasci fuori un dato, la pratica si salva lo stesso e viene segnalata come «incompleta» (non perdi mai quello che hai scritto) | |
| 4.3 | Dopo il salvataggio la pratica compare in **Archivio pratiche** e nella tabella «Ultime pratiche» della dashboard; cliccando la riga si apre la scheda | |
| 4.4 | I 6 riquadri della dashboard cambiano e coincidono con i tuoi conti | |
| 4.5 | Dalla scheda: **Registra incasso** (importo precompilato) e **Registra liquidazione** funzionano e i numeri si aggiornano | |
| 4.6 | **Cumulo mensile per zona** mostra lo scaglione raggiunto e la percentuale; coincide con il tuo conto | |
| 4.7 | Nelle finestre semplici (Registra incasso, Nuova zona, modifiche) scrivi il valore e premi **Invio**: fa quello che fa il pulsante principale. Nella liquidazione a più righe Invio **non** registra il pagamento (serve il pulsante) | |
| 4.8 | **Ricerca rapida** (in alto, oppure premi `/`): scrivi una parola, scorri con le frecce, Invio apre la pratica; Maiusc+Invio mostra tutte le corrispondenze nell'archivio | |

## 5. Chiudi e riapri (la prova più importante)

1. Chiudi il programma con la **X** della finestra.
2. Riaprilo dal desktop.

| # | Cosa controllare | Esito |
|---|---|---|
| 5.1 | Le pratiche, gli incassi, le liquidazioni e le impostazioni ci sono ancora, identici | |
| 5.2 | Esiste il file `Documenti\Gestione Immobiliare\Dati\archivio.sqlite` | |
| 5.3 | Provando ad aprire **una seconda copia** del programma, si porta in primo piano la prima (non se ne apre una seconda) | |

## 6. Backup

In **Backup e archivio storico**:

| # | Cosa controllare | Esito |
|---|---|---|
| 6.1 | **Crea un backup ora** → compare nell'elenco «archivio storico»; il file è in `Documenti\Gestione Immobiliare\Backup` | |
| 6.2 | **Esporta l'archivio completo** → ti chiede dove salvare un file `.sqlite` e lo crea | |
| 6.3 | **Esporta in CSV (Excel)** → il file si apre in Excel con lettere accentate e importi leggibili | |
| 6.4 | **Ripristina** una copia → prima chiede conferma, poi i dati tornano a quelli della copia; subito prima viene salvata una copia dei dati di adesso («Prima di un ripristino») | |
| 6.5 | **Importa un backup** scegliendo un file che non è un archivio (ad esempio un documento qualsiasi rinominato in `.sqlite`) → viene rifiutato con un messaggio chiaro e i dati restano intatti | |
| 6.6 | **Verifica l'integrità** → «nessun problema» | |
| 6.7 | In *Backup e archivio storico* i pulsanti **Apri la cartella dei dati** e **Apri la cartella dei backup** aprono Esplora file sulla cartella giusta (nelle prove automatiche questo passaggio è solo simulato) | |

## 7. Schermo

| # | Cosa controllare | Esito |
|---|---|---|
| 7.1 | Allarga e restringi la finestra: la barra laterale si adatta, nessun testo viene tagliato, i grafici restano leggibili | |
| 7.2 | Con la scala di Windows al 125% o 150% (Impostazioni di Windows → Schermo → Scala) niente si sovrappone | |
| 7.3 | Il tema scuro (Preferenze) è leggibile | |

---

## 8. Chiavetta USB (facoltativo)

Solo se vuoi usare il programma da una chiavetta. **Prima** estrai lo ZIP (non aprire il programma da dentro lo ZIP) e copia sulla chiavetta solo il file `…Portatile.exe`.

| # | Cosa controllare | Esito |
|---|---|---|
| 8.1 | Aprendo il `.exe` **dalla chiavetta** il programma parte (anche dopo l'avviso di Windows) e mostra l'archivio vuoto | |
| 8.2 | Accanto al `.exe`, sulla chiavetta, è nata la cartella `Gestione Immobiliare - Dati` con dentro `Dati\archivio.sqlite` | |
| 8.3 | In *Backup e archivio storico*, sotto «Dove sono i dati», c'è l'avviso azzurro «Versione portatile (chiavetta)» e **non** c'è l'avviso giallo sulla cartella temporanea | |
| 8.4 | Inserisci una pratica di prova, chiudi con la **X**, riapri dalla chiavetta: la pratica c'è ancora | |
| 8.5 | In `Documenti` **non** è comparsa la cartella `Gestione Immobiliare` (se prima non c'era) | |
| 8.6 | Togli la chiavetta (dopo aver chiuso il programma), mettila in **un altro PC** e aprilo da lì: la pratica di prova c'è | |
| 8.7 | Prova da non fare mai: apri il `.exe` direttamente dentro lo ZIP. Il programma deve avvisarti («aperto da una cartella temporanea») prima di partire | |

---

## Se qualcosa non va

Mandami:

1. il numero del punto (ad esempio **4.4**);
2. una **foto o schermata** di quello che vedi;
3. cosa ti aspettavi.

Non servono altre informazioni: non scrivere mai nomi di clienti o importi reali nei messaggi, basta la foto con i dati coperti.

## Disinstallare

Impostazioni di Windows → App → *Gestione Immobiliare* → Disinstalla. **I tuoi dati non vengono cancellati**: restano in `Documenti\Gestione Immobiliare`. (La versione portatile non si installa, quindi non si disinstalla: basta cancellare il file `.exe`; i suoi dati sono nella cartella `Gestione Immobiliare - Dati` accanto a lui.)
