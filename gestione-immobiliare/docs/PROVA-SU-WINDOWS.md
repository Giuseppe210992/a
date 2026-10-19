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

Si apre un archivio **senza pratiche né zone**: nessun dato dimostrativo. Ci sono **Luca** e **Giuseppe**, il **capo** (15%) e la **segretaria** (4%) con la loro percentuale fissa, e gli **scaglioni che hai indicato** (5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre i 13.000 €).

| # | Cosa controllare | Esito |
|---|---|---|
| 2.1 | A sinistra c'è la barra con 8 voci: Dashboard, Nuova pratica, Archivio pratiche, Provvigioni, Cumulo mensile per zona, Statistiche e grafici, Backup e archivio storico, Impostazioni | |
| 2.2 | In alto: «Gestione Immobiliare», la data di oggi, il periodo, la ricerca e il pulsante **+ Nuova pratica** | |
| 2.3 | La dashboard mostra 3 riquadri a zero, 2 pulsanti grandi (Nuova pratica, Crea un backup) e un invito a inserire la prima pratica; nessun grafico | |
| 2.4 | **Riduci barra** nasconde i nomi e lascia le icone; passando il mouse su un'icona compare il nome; la scelta resta dopo aver chiuso e riaperto | |

## 3. Imposta i tuoi numeri (Impostazioni)

Gli scaglioni sono già impostati con quelli che mi hai indicato. Vai in **Impostazioni**, controllali e completa il resto:

1. **Zone** → aggiungi le tue zone di lavoro (ad esempio i quartieri o le aree in cui operi) e, per ognuna, premi **Ripartizione**: scrivi quanta parte delle pratiche di quella zona va a Luca e quanta a Giuseppe (la somma deve fare 100%, ad esempio 60 + 40 oppure 100 a uno solo). Da quel momento ogni nuova pratica di quella zona si divide **da sola**.
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
| 3.5 | In *Zone*, accanto a ogni zona si legge la ripartizione («Luca 60% · Giuseppe 40%»); una zona senza ripartizione è segnalata come «NON IMPOSTATA» (o «predefinita» se hai impostato quella generale) | |
| 3.4 | Scrivendo 10.000 in «Prova con un cumulo mensile di» il programma dà **1.500,00 €** con *scaglione raggiunto* e **954,00 €** con *progressivo* (se il tuo conto a mano è diverso, dimmi qual è) | |

## 4. Inserisci una pratica (vera o di prova)

**+ Nuova pratica** → il modulo ha tre passi: **1)** scegli la **zona**, **2)** scegli il **mese della proposta** (da lì si decide in quale cumulo mensile entra la pratica) e scrivi il **prezzo di vendita**, **3)** scrivi il **nominativo** (obbligatorio) del venditore e dell'acquirente e **quanto ha pagato** ciascuno, in contanti, bonifico e assegno. Non ci sono codice, stato, date né via dell'immobile: il codice lo dà il programma (`AAAA/001`, `AAAA/002`…), la pratica è sempre «conclusa» e la data è quella di oggi. La divisione tra Luca e Giuseppe compare da sola, secondo la zona. Le cose facoltative (tipo di immobile, nomi, note…) stanno in «Altre informazioni». → **Salva pratica**.

Come si leggono gli importi: **contanti, bonifico e assegno comprendono tutti l'IVA** (il programma la toglie). Esempio con IVA 22%: venditore 3.660 € di bonifico + acquirente 2.440 € in contanti → compenso senza IVA **5.000 €**, IVA **1.100 €**, pagato **6.100 €**.

| # | Cosa controllare | Esito |
|---|---|---|
| 4.1 | Mentre scrivi, il riepilogo (compenso senza IVA, IVA, totale pagato, provvigioni stimate) si aggiorna da solo; con l'esempio sopra «Il conto» legge 5.000 € / 1.100 € / 6.100 € | |
| 4.2 | Scegliendo la zona compare la ripartizione automatica (ad esempio «Luca 60% · Giuseppe 40%»); se la zona non ne ha una, il modulo lo dice e al salvataggio chiede conferma | |
| 4.3 | Dopo il salvataggio la pratica compare in **Archivio pratiche** e nella tabella «Ultime pratiche» della dashboard; cliccando la riga si apre la scheda, che mostra zona, pagamenti, compenso senza IVA, IVA e provvigioni | |
| 4.4 | I 3 riquadri della dashboard cambiano e coincidono con i tuoi conti (ricorda: quanto scritto nel modulo è già contato come incassato) | |
| 4.5 | Dalla scheda: **Registra incasso** (la finestra mostra il residuo da incassare, che è 0 se le parti hanno già pagato tutto) funziona e i numeri si aggiornano; **non esiste più la liquidazione**: le provvigioni sono già pagate | |
| 4.6 | **Cumulo mensile per zona** mostra lo scaglione raggiunto e la percentuale; coincide con il tuo conto (compenso **senza IVA** di tutte le pratiche del mese nella stessa zona, per collaboratore secondo la ripartizione) | |
| 4.7 | Nelle finestre semplici (Registra incasso, Nuova zona, modifiche) scrivi il valore e premi **Invio**: fa quello che fa il pulsante principale. | |
| 4.8 | **Ricerca rapida** (in alto, oppure premi `/`): scrivi una parola (codice, zona, nome del venditore o dell'acquirente), scorri con le frecce, Invio apre la pratica; Maiusc+Invio mostra tutte le corrispondenze nell'archivio | |
| 4.9 | Provando a cambiare le percentuali della ripartizione di una zona, le pratiche **già inserite** restano come sono; valgono per quelle nuove | |
| 4.10 | Provando a salvare senza il nominativo del venditore o dell'acquirente il programma non salva e lo dice | |
| 4.11 | Con il mese della proposta diverso da quello di oggi, la stima dice «Cumulo di <mese scelto>» e la pratica compare in quel mese in Cumulo mensile e nelle Statistiche | |
| 4.12 | **Capo e segretaria**: nella stima e nella scheda compaiono anche loro. Esempio con 10.000 € di compenso nel Centro tutto a Luca: Luca 1.500 €, Capo 1.500 € (15% di 10.000), Segretaria 400 € (4% di 10.000). Controlla che sia questo che intendevi (in più rispetto a Luca e Giuseppe, sul compenso totale) | |
| 4.13 | In *Impostazioni → Collaboratori* si legge «Capo 15% del compenso totale» e «Segretaria 4%…»; con *Modifica* si cambia la percentuale. | |
| 4.14 | **Cumulo:** inserisci una pratica nello stesso mese e nella stessa zona di una già inserita, in modo che lo scaglione salga. Nel modulo compare un riquadro giallo e, premendo Salva, una finestra con per ogni collaboratore: **già pagato** sulle vecchie pratiche, **differenza da dare**, quanto spetta per la **nuova** e il **totale**. Controlla i numeri con il tuo foglio | |
| 4.15 | **Zona comune:** inserisci una pratica in una zona divisa tra Luca e Giuseppe (es. compenso 8.737 € senza IVA). La stima in alto a destra mostra in grande quanto va a ciascuno e il totale: controlla che sia (compenso × percentuale dello scaglione del mese) diviso secondo la quota, e non la percentuale calcolata sulla metà | |
| 4.16 | **Provvigioni** mostra il foglio del mese: frecce per cambiare mese, una riga per pratica, una colonna per persona, i totali in fondo. Confrontalo con il tuo foglio Excel | |

## 5. Chiudi e riapri (la prova più importante)

1. Chiudi il programma con la **X** della finestra.
2. Riaprilo dal desktop.

| # | Cosa controllare | Esito |
|---|---|---|
| 5.1 | Le pratiche, gli incassi e le impostazioni ci sono ancora, identici | |
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

## 9. Versione solo browser (Chrome o Edge): nessuna traccia

Queste prove vanno fatte sul computer vero: nelle prove automatiche il selettore di cartelle del browser è simulato.

| # | Cosa controllare | Esito |
|---|---|---|
| 9.1 | Aprendo `index.html` compare «Scegli la cartella dei dati». Crea una cartella vuota (es. «Dati Immobiliare» sulla chiavetta) e sceglila; consenti la modifica dei file | |
| 9.2 | Inserisci una pratica, chiudi la scheda, riapri `index.html`, scegli **la stessa** cartella: i dati ci sono. In quella cartella vedi `Dati\archivio.sqlite` e `Backup\` | |
| 9.3 | Un'esportazione CSV compare in `Esportazioni\` della cartella e **non** nell'elenco dei download del browser | |
| 9.4 | Nelle impostazioni del browser → Cookie e dati dei siti: non c'è nessun dato per questa pagina (e quindi non c'è nulla da cancellare) | |
| 9.5 | Se scegli direttamente Desktop, Documenti o un'intera chiavetta, Chrome rifiuta: scegli una sottocartella | |
