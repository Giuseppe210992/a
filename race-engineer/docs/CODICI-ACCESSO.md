# Codici di accesso con scadenza

## Per te (titolare)
1. Apri `tools/generatore-codici.html` con Chrome, Edge, Firefox o Safari recenti (doppio clic sul file).
2. **Chiave**: carica `race-engineer-chiave-privata.json` (te l'ho consegnato a parte, NON è nel repository).
   Spunta «Ricorda su questo browser» per non ricaricarla ogni volta.
3. **Nuovo codice**: scrivi per chi è (facoltativo), scegli la durata (1 giorno, 7, 30, 90, 1 anno, nessuna
   scadenza) o una data e ora precise, premi **Genera codice** e **Copia codice**.
4. Mandi il codice alla persona. Lei lo incolla nella schermata di accesso di Race Engineer.
5. **Verifica un codice** controlla autenticità e scadenza; l'elenco in fondo tiene traccia dei codici
   creati (solo in quel browser) con stato e scadenza; puoi esportarlo in CSV.

La pagina lavora tutta sul tuo computer: nessun dato viene inviato in rete.

## Come funziona
Ogni codice è firmato (Ed25519) con la tua **chiave privata**; il programma contiene solo la **chiave
pubblica** e quindi può controllare i codici ma non crearne: nessuno può falsificarli dall'`.exe`.
Il codice contiene: data di creazione, scadenza, etichetta e un ID. Alla scadenza il programma si ferma e
chiede un nuovo codice. Se qualcuno riporta indietro l'orologio del PC (più di un giorno) viene rilevato.
Il programma mostra in alto «accesso valido fino al …» e avvisa 3 giorni prima.

## Limiti (inevitabili senza un server)
* Un codice **non si può revocare** prima della scadenza: per un controllo stretto usa scadenze brevi.
* Un codice vale su tutti i PC su cui viene incollato (non è legato a un computer).
* Chi ha il controllo del PC e competenze tecniche può modificare il programma; il sistema serve a
  regolare l'uso normale, non a essere a prova di pirata.
* Conserva bene la chiave privata: se la perdi non puoi più creare codici validi per questa versione;
  se la diffondi, chiunque può crearne. In quel caso: pagina > Avanzate > «Crea nuova coppia di chiavi»,
  poi metti la nuova chiave pubblica in `license/pubkey.txt` e ricompila (workflow `windows-build`).
* Per **disattivare** il controllo: svuota `license/pubkey.txt` e ricompila.

## Riga di comando
`re-cli --code CODICE ...`, oppure variabile `RE_ACCESS_CODE`; `re-cli --check-code CODICE` mostra se un
codice è valido, chi è e quando scade.
