// Nuova pratica e modifica: compilazione, controlli, totali in tempo reale, ripartizione, stima delle provvigioni,
// salvataggio sul database, avviso per le modifiche non salvate.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto } from './lib.mjs';

const E = 100;

describe('Nuova pratica e modifica', () => {
  let app;
  before(async () => { app = await avvia(); });
  after(async () => { await app.chiudi(); });

  /** Apre un modulo di nuova pratica pulito, uscendo senza salvare da un'eventuale schermata sporca. */
  async function apriNuova() {
    const p = app.pagina;
    await p.evaluate(() => { location.hash = '#/pratiche'; });
    await p.waitForTimeout(120);
    if (await finestra(p).count()) await bottoneFinestra(p, 'Esci senza salvare').click();
    await vai(p, '#/nuova');
    await p.waitForSelector('#form-pratica');
  }
  beforeEach(async () => { await apriNuova(); });

  // i campi del modulo (la barra dei filtri, nascosta, ha etichette con lo stesso nome)
  const L = (etichetta, opzioni = {}) => app.pagina.locator('#form-pratica').getByLabel(etichetta, opzioni);
  const STATO = /^Stato/;
  const ZONA = /^Zona$/;
  const errori = (p) => p.locator('#form-pratica .griglia-campi .campo.ha-errore');
  const riepilogo = async () => rimuoviSpazi(await app.pagina.locator('.form-riepilogo .riepilogo-calcolo').innerText());
  const stima = async () => rimuoviSpazi(await app.pagina.locator('.stima-provvigione').innerText());

  test('il modulo si apre con valori proposti e senza dati inventati', async () => {
    const p = app.pagina;
    assert.equal(rimuoviSpazi(await p.locator('#contenuto h1').innerText()), 'Nuova pratica');
    assert.equal(await L('Codice pratica').inputValue(), '2026/001');
    assert.equal(await L(STATO).inputValue(), 'in_corso');
    assert.equal(await L('Data di apertura').inputValue(), '16/10/2026');
    assert.equal(await L('Aliquota IVA').inputValue(), '22');
    assert.equal(await L('Prezzo di vendita').inputValue(), '');
    assert.equal(await p.locator('.quote-righe .quota-riga').count(), 0);
    assert.match(rimuoviSpazi(await p.locator('.form-colonna').innerText()), /Nessun collaboratore assegnato/);
    assert.match(await riepilogo(), /Totale con IVA 0,00 €/);
    assert.match(await stima(), /Assegna la pratica ad almeno un collaboratore per vedere la stima delle provvigioni/);
    // il cursore è già nel primo campo da compilare
    assert.equal(await p.evaluate(() => document.activeElement.labels?.[0]?.textContent.replace('*', '').trim()), 'Indirizzo dell\'immobile');
    // pulsanti
    assert.ok(await p.locator('#salva-pratica').isVisible());
    assert.ok(await p.locator('#salva-e-nuova').isVisible());
    assert.ok(await p.locator('#annulla-pratica').isVisible());
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Compila i dati della pratica/);
    // tutte le opzioni di tipo, stato, IVA
    const stati = await L(STATO).locator('option').allInnerTexts();
    assert.deepEqual(stati, ['In corso', 'Conclusa', 'Annullata']);
    const iva = await L('Aliquota IVA').locator('option').allInnerTexts();
    assert.deepEqual(iva.map((x) => x.replace(/ /g, ' ')), ['22%', '10%', '4%', '0% (esente / non imponibile)']);
  });

  test('i campi obbligatori e gli importi o le date non validi vengono segnalati, senza salvare', async () => {
    const p = app.pagina;
    await p.click('#salva-pratica');
    await errori(p).first().waitFor();
    const elenco = await p.$$eval('#form-pratica .griglia-campi .campo.ha-errore .errore', (a) => a.map((x) => x.textContent.trim()));
    assert.ok(elenco.some((e) => /indirizzo dell'immobile/i.test(e)), `errore sull'indirizzo: ${elenco}`);
    await attendiNotifica(p, /Controlla i campi evidenziati/);
    assert.equal(await p.evaluate(() => location.hash), '#/nuova', 'si resta sul modulo');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    // il cursore va sul primo campo sbagliato
    assert.equal(await p.evaluate(() => document.activeElement.labels?.[0]?.textContent.replace('*', '').trim()), 'Indirizzo dell\'immobile');
    // importo e data scritti male
    await L('Indirizzo dell\'immobile').fill('Via di prova 1');
    await L('Prezzo di vendita').fill('abc');
    await L('Data di apertura').fill('31/02/2026');
    await p.click('#salva-pratica');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .griglia-campi .campo.ha-errore').length >= 2);
    const testi = (await p.$$eval('#form-pratica .griglia-campi .campo.ha-errore .errore', (a) => a.map((x) => x.textContent.trim()))).join(' | ');
    assert.match(testi, /Scrivi un importo valido/);
    assert.match(testi, /Scrivi la data come gg\/mm\/aaaa/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    // correggendo, l'errore del campo sparisce non appena si scrive
    await L('Prezzo di vendita').fill('100000');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .griglia-campi .campo.ha-errore').length === 1);
    // il rogito non può precedere l'apertura (controllo del database)
    await L('Data di apertura').fill('10/10/2026');
    await L('Data del rogito').fill('01/10/2026');
    await p.click('#salva-pratica');
    await p.waitForFunction(() => /precedente all'apertura/.test(document.querySelector('.form-colonna').textContent));
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
  });

  test('importi e totali si aggiornano mentre si scrive; la percentuale sul prezzo calcola l\'importo e viceversa', async () => {
    const p = app.pagina;
    await L('Prezzo di vendita').fill('150.000,00');
    await p.getByLabel('% sul prezzo').nth(0).fill('3');
    assert.equal(await L('Compenso dal venditore').inputValue(), '4.500,00');
    await L('Compenso dall\'acquirente').fill('1.500,00');
    assert.equal(await p.getByLabel('% sul prezzo').nth(1).inputValue(), '1');
    await p.waitForFunction(() => /Totale con IVA\s+7\.320,00/.test(document.querySelector('.form-riepilogo').innerText.replace(/\s+/g, ' ')));
    const r = await riepilogo();
    assert.match(r, /Compenso dal venditore 4\.500,00 €/);
    assert.match(r, /Compenso dall'acquirente 1\.500,00 €/);
    assert.match(r, /Totale imponibile 6\.000,00 €/);
    assert.match(r, /IVA 22% 1\.320,00 €/);
    assert.match(r, /Totale con IVA 7\.320,00 €/);
    // cambiando l'aliquota cambia l'IVA
    await L('Aliquota IVA').selectOption('10');
    await p.waitForFunction(() => /IVA 10%\s+600,00/.test(document.querySelector('.form-riepilogo').innerText.replace(/\s+/g, ' ')));
    assert.match(await riepilogo(), /Totale con IVA 6\.600,00 €/);
    // scrivendo l'importo si ricalcola la percentuale
    await L('Compenso dal venditore').fill('3000');
    assert.equal(await p.getByLabel('% sul prezzo').nth(0).inputValue(), '2');
    // cambiando il prezzo la percentuale segue l'importo
    await L('Prezzo di vendita').fill('120.000');
    await p.waitForFunction(() => document.querySelectorAll('input[aria-describedby]')[0] !== undefined);
    assert.equal(await p.getByLabel('% sul prezzo').nth(0).inputValue(), '2,5');
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Modifiche non ancora salvate/);
  });

  test('ripartizione tra collaboratori: scorciatoie, righe, totale e avviso se non fa 100%', async () => {
    const p = app.pagina;
    const righe = () => p.locator('.quote-righe .quota-riga');
    const totale = async () => rimuoviSpazi(await p.locator('.quote-righe').locator('xpath=following-sibling::div').first().innerText());
    await p.getByRole('button', { name: 'Tutto a Luca' }).click();
    assert.equal(await righe().count(), 1);
    assert.equal(await p.getByLabel('Collaboratore 1').locator('option:checked').innerText(), 'Luca');
    assert.equal(await p.getByLabel('Quota del collaboratore 1').inputValue(), '100');
    assert.match(rimuoviSpazi(await p.locator('.form-colonna').innerText()), /Totale quote: 100%/);
    await p.getByRole('button', { name: 'Parti uguali' }).click();
    assert.equal(await righe().count(), 2);
    assert.equal(await p.getByLabel('Quota del collaboratore 1').inputValue(), '50');
    assert.equal(await p.getByLabel('Quota del collaboratore 2').inputValue(), '50');
    assert.equal(await p.getByLabel('Collaboratore 2').locator('option:checked').innerText(), 'Giuseppe');
    // tutti i collaboratori sono già nella pratica
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    await attendiNotifica(p, /Hai già aggiunto tutti i collaboratori/);
    // togliere una riga
    await p.getByRole('button', { name: 'Togli il collaboratore 2' }).click();
    assert.equal(await righe().count(), 1);
    // aggiungere di nuovo: propone il collaboratore libero con la quota rimanente
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    assert.equal(await righe().count(), 2);
    assert.equal(await p.getByLabel('Collaboratore 2').locator('option:checked').innerText(), 'Giuseppe');
    assert.equal(await p.getByLabel('Quota del collaboratore 2').inputValue(), '50', 'propone la quota che manca per arrivare a 100%');
    // 60 + 30 = 90%: il totale diventa rosso e il salvataggio chiede conferma
    await p.getByLabel('Quota del collaboratore 1').fill('60');
    await p.getByLabel('Quota del collaboratore 2').fill('30');
    assert.match(rimuoviSpazi(await p.locator('.form-colonna').innerText()), /Totale quote: 90%/);
    await L('Indirizzo dell\'immobile').fill('Via Quote 1');
    await p.click('#salva-pratica');
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /La ripartizione non fa 100%/);
    assert.match(rimuoviSpazi(await f.innerText()), /sommano 90%/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0, 'Annulla: non viene salvato nulla');
    // sopra il 100% il database rifiuta
    await p.getByLabel('Quota del collaboratore 1').fill('80');
    await p.getByLabel('Quota del collaboratore 2').fill('40');
    await p.click('#salva-pratica');
    await bottoneFinestra(p, 'Salva comunque').click();
    await p.waitForFunction(() => /supera il 100%/.test(document.querySelector('.form-colonna').textContent));
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
  });

  test('stima delle provvigioni: senza scaglioni lo dice, con gli scaglioni si aggiorna mentre si scrive', async () => {
    const p = app.pagina;
    await p.getByRole('button', { name: 'Tutto a Luca' }).click();
    await p.waitForFunction(() => /scaglioni non sono ancora impostati/.test(document.querySelector('.stima-provvigione').textContent));
    // imposto zona e scaglioni (0 € → 30%, 10.000 € → 35%, 20.000 € → 40%) e riapro il modulo
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      await api.creaZona(app.archivio, { nome: 'Centro' });
      await api.salvaTabellaScaglioni(app.archivio, null, [{ da_cent: 0, percentuale: 30 }, { da_cent: 1000000, percentuale: 35 }, { da_cent: 2000000, percentuale: 40 }]);
    });
    await apriNuova();
    await p.getByRole('button', { name: 'Tutto a Luca' }).click();
    await L(STATO).selectOption('conclusa'); // il rogito si compila con la data di oggi
    assert.equal(await L('Data del rogito').inputValue(), '16/10/2026');
    await L('Data del rogito').fill('14/10/2026');
    await L(ZONA).selectOption({ label: 'Centro' });
    await L('Compenso dal venditore').fill('2.500,00');
    await L('Compenso dall\'acquirente').fill('2.500,00');
    await p.waitForFunction(() => /Quota 100% dei compensi: 5\.000,00/.test(document.querySelector('.stima-provvigione').textContent));
    let s = await stima();
    assert.match(s, /Luca\s*1\.500,00 €/);
    assert.match(s, /Quota 100% dei compensi: 5\.000,00 €/);
    assert.match(s, /Cumulo di ottobre 2026 in Centro: 5\.000,00 € → scaglione 1 \(30%\)/);
    assert.match(s, /Mancano 5\.000,00 € allo scaglione 2 \(35%\)/);
    await L('Compenso dal venditore').fill('6.000,00');
    await L('Compenso dall\'acquirente').fill('6.000,00');
    await p.waitForFunction(() => /Quota 100% dei compensi: 12\.000,00/.test(document.querySelector('.stima-provvigione').textContent));
    s = await stima();
    assert.match(s, /Luca\s*4\.200,00 €/); // 12.000 × 35%
    assert.match(s, /Mancano 8\.000,00 € allo scaglione 3 \(40%\)/);
    // una quota del 50% dimezza il fatturato attribuito e la provvigione
    await p.getByLabel('Quota del collaboratore 1').fill('50');
    await p.waitForFunction(() => /Quota 50% dei compensi: 6\.000,00/.test(document.querySelector('.stima-provvigione').textContent));
    assert.match(await stima(), /Luca\s*1\.800,00 €/); // 6.000 × 30%
  });

  test('"Nuova zona" dal modulo crea la zona e la sceglie; un nome già usato viene rifiutato', async () => {
    const p = app.pagina;
    await p.getByRole('button', { name: 'Nuova zona' }).click();
    const f = finestra(p);
    await f.getByLabel('Nome della zona').fill('Collina');
    await bottoneFinestra(p, 'Crea zona').click();
    await attendiNotifica(p, /Zona “Collina” creata/);
    assert.equal(await L(ZONA).locator('option:checked').innerText(), 'Collina');
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone WHERE nome = 'Collina'"), 1);
    await p.getByRole('button', { name: 'Nuova zona' }).click();
    await f.getByLabel('Nome della zona').fill('collina'); // stesso nome in minuscolo
    await bottoneFinestra(p, 'Crea zona').click();
    await f.locator('.ha-errore').waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /esiste già/i);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM zone'), 2);
  });

  test('salvataggio completo: i dati arrivano nel database e la scheda li mostra', async () => {
    const p = app.pagina;
    await L('Indirizzo dell\'immobile').fill('Via del Test 7');
    await L('Comune').fill('Minturno');
    await L('Tipo di immobile').selectOption({ label: 'Appartamento' });
    await L(ZONA).selectOption({ label: 'Centro' });
    await L(STATO).selectOption('conclusa');
    await L('Data di apertura').fill('01/09/2026');
    await L('Data del rogito').fill('14/10/2026');
    await L('Prezzo di vendita').fill('185.000,00');
    await L('Prezzo di acquisto').fill('150.000,00');
    await L('Venditore', { exact: true }).fill('Mario Rossi');
    await L('Acquirente', { exact: true }).fill('Anna Bianchi');
    await L('Compenso dal venditore').fill('3.700,00');
    await L('Compenso dall\'acquirente').fill('3.700,00');
    await L('Note', { exact: true }).fill('Atto presso il notaio\nsecondo piano');
    await p.getByRole('button', { name: 'Parti uguali' }).click();
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 salvata/);
    await p.waitForSelector('#contenuto h1:has-text("Via del Test 7")');
    assert.match(await p.evaluate(() => location.hash), /^#\/pratiche\/\d+$/);
    const riga = (await sql(p, 'SELECT * FROM pratiche'))[0];
    assert.deepEqual(
      [riga.codice, riga.stato, riga.data_pratica, riga.data_rogito, riga.immobile_indirizzo, riga.immobile_comune, riga.immobile_tipo, riga.prezzo_vendita_cent, riga.prezzo_acquisto_cent, riga.venditore, riga.acquirente, riga.compenso_venditore_cent, riga.compenso_acquirente_cent, riga.aliquota_iva, riga.note],
      ['2026/001', 'conclusa', '2026-09-01', '2026-10-14', 'Via del Test 7', 'Minturno', 'Appartamento', 18500000, 15000000, 'Mario Rossi', 'Anna Bianchi', 370000, 370000, 22, 'Atto presso il notaio\nsecondo piano']);
    assert.equal(await valoreSql(p, 'SELECT nome FROM zone WHERE id = ?', [riga.zona_id]), 'Centro');
    const quote = await sql(p, 'SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id ORDER BY c.id');
    assert.deepEqual(quote, [{ nome: 'Luca', percentuale: 50 }, { nome: 'Giuseppe', percentuale: 50 }]);
    // la scheda
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Conclusa/);
    assert.match(t, /Pratica 2026\/001 · Minturno · Appartamento · Zona Centro/);
    assert.match(t, /Prezzo di vendita 185\.000,00 €/);
    assert.match(t, /Differenza \+35\.000,00 € \(\+23,3%\)/);
    assert.match(t, /Rogito 14\/10\/2026/);
    assert.match(t, /Tempo di lavorazione 43 giorni/);
    assert.match(t, /Totale imponibile 7\.400,00 €/);
    assert.match(t, /Totale con IVA 9\.028,00 €/);
    assert.match(t, /Atto presso il notaio secondo piano/);
    // 7.400 € nel Centro a ottobre, 50% ciascuno = 3.700 € ciascuno → scaglione 1 (30%) = 1.110 €
    const righe = await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    assert.deepEqual(righe.map((r) => [r[0], r[1], r[2], r[4]]), [['Luca', '50%', '3.700,00 €', '1.110,00 €'], ['Giuseppe', '50%', '3.700,00 €', '1.110,00 €']]);
  });

  test('un codice già usato viene rifiutato e non si perde nulla di quanto scritto', async () => {
    const p = app.pagina;
    assert.equal(await L('Codice pratica').inputValue(), '2026/002', 'il codice proposto è il successivo');
    await L('Codice pratica').fill('2026/001');
    await L('Indirizzo dell\'immobile').fill('Via Doppia 3');
    await p.click('#salva-pratica');
    await p.waitForFunction(() => /Esiste già una pratica con questo codice/.test(document.querySelector('.form-colonna').textContent));
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 1);
    assert.equal(await L('Indirizzo dell\'immobile').inputValue(), 'Via Doppia 3');
    // anche in minuscolo/con altre lettere maiuscole è lo stesso codice
    await L('Codice pratica').fill('2026/001 ');
    await p.click('#salva-pratica');
    await p.waitForFunction(() => /Esiste già una pratica con questo codice/.test(document.querySelector('.form-colonna').textContent));
  });

  test('"Salva e inserisci un\'altra" salva e riapre un modulo vuoto con il codice successivo', async () => {
    const p = app.pagina;
    await L('Indirizzo dell\'immobile').fill('Via Serie 1');
    await L('Compenso dal venditore').fill('1.000');
    await p.click('#salva-e-nuova');
    await attendiNotifica(p, /Pratica 2026\/002 salvata/);
    await p.waitForFunction(() => document.querySelector('#form-pratica input[placeholder="Via, numero civico"]')?.value === '');
    assert.equal(await p.evaluate(() => location.hash), '#/nuova');
    assert.equal(await L('Codice pratica').inputValue(), '2026/003');
    assert.equal(await L('Compenso dal venditore').inputValue(), '');
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Compila i dati della pratica/);
    assert.equal(await p.evaluate(() => document.activeElement.labels?.[0]?.textContent.replace('*', '').trim()), 'Indirizzo dell\'immobile');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 2);
    // uscendo subito non compare nessun avviso (non ci sono modifiche)
    await p.click('.sidebar .nav-voce[data-id="pratiche"]');
    await p.waitForSelector('#contenuto h1:has-text("Archivio pratiche")');
    assert.equal(await finestra(p).count(), 0);
  });

  test('uscire con modifiche non salvate chiede conferma ("Resta qui" le conserva)', async () => {
    const p = app.pagina;
    await L('Indirizzo dell\'immobile').fill('Via Sporca 9');
    await p.click('.sidebar .nav-voce[data-id="cumulo"]');
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Uscire senza salvare\?/);
    assert.match(rimuoviSpazi(await f.innerText()), /modifiche non salvate/);
    await bottoneFinestra(p, 'Resta qui').click();
    assert.equal(await p.evaluate(() => location.hash), '#/nuova');
    assert.equal(await L('Indirizzo dell\'immobile').inputValue(), 'Via Sporca 9');
    // anche il pulsante Annulla è protetto
    await p.click('#annulla-pratica');
    await f.waitFor();
    await bottoneFinestra(p, 'Resta qui').click();
    assert.equal(await L('Indirizzo dell\'immobile').inputValue(), 'Via Sporca 9');
    // poi si esce davvero
    await p.click('.sidebar .nav-voce[data-id="cumulo"]');
    await f.waitFor();
    await bottoneFinestra(p, 'Esci senza salvare').click();
    await p.waitForSelector('#contenuto h1:has-text("Cumulo mensile per zona")');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 2, 'nulla è stato salvato');
  });

  test('una pratica incompleta si salva e viene segnalata con cosa manca', async () => {
    const p = app.pagina;
    await L('Indirizzo dell\'immobile').fill('Via Incompleta 2');
    await L(STATO).selectOption('conclusa');
    await L('Data del rogito').fill('');
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/003 salvata/);
    await p.waitForSelector('#contenuto h1:has-text("Via Incompleta 2")');
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Dati da completare:/);
    assert.match(t, /zona/i);
    assert.match(t, /Completa i dati/);
    // il collegamento porta al modulo di modifica
    await p.getByRole('link', { name: 'Completa i dati' }).click();
    await p.waitForSelector('#contenuto h1:has-text("Modifica pratica 2026/003")');
  });

  test('modifica: il modulo riporta i dati, salva le differenze e aggiorna la scheda', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}/modifica`);
    assert.equal(rimuoviSpazi(await p.locator('#contenuto h1').innerText()), 'Modifica pratica 2026/001');
    assert.equal(await L('Codice pratica').inputValue(), '2026/001');
    assert.equal(await L('Indirizzo dell\'immobile').inputValue(), 'Via del Test 7');
    assert.equal(await L(STATO).inputValue(), 'conclusa');
    assert.equal(await L('Data del rogito').inputValue(), '14/10/2026');
    assert.equal(await L('Prezzo di vendita').inputValue(), '185.000,00');
    assert.equal(await L('Compenso dal venditore').inputValue(), '3.700,00');
    assert.equal(await L(ZONA).locator('option:checked').innerText(), 'Centro');
    assert.equal(await p.getByLabel('Quota del collaboratore 1').inputValue(), '50');
    assert.match(await riepilogo(), /Già incassato 0,00 €/);
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Nessuna modifica/);
    assert.equal(await p.locator('#salva-e-nuova').count(), 0);
    // cambio il compenso del venditore e la ripartizione
    await L('Compenso dal venditore').fill('4.300,00');
    await p.getByRole('button', { name: 'Tutto a Luca' }).click();
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Modifiche non ancora salvate/);
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 aggiornata/);
    await p.waitForSelector('#contenuto h1:has-text("Via del Test 7")');
    const riga = (await sql(p, "SELECT compenso_venditore_cent FROM pratiche WHERE codice = '2026/001'"))[0];
    assert.equal(riga.compenso_venditore_cent, 430000);
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN pratiche p ON p.id = q.pratica_id WHERE p.codice = '2026/001'"), [{ nome: 'Luca', percentuale: 100 }]);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Totale imponibile 8\.000,00 €/);
    // 8.000 € di Luca a ottobre nel Centro → scaglione 1 (30%) = 2.400 €
    const righe = await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    assert.deepEqual(righe.map((r) => [r[0], r[1], r[2], r[4]]), [['Luca', '100%', '8.000,00 €', '2.400,00 €']]);
    // l'annullamento della modifica non salva niente
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}/modifica`);
    await L('Compenso dal venditore').fill('1');
    await p.click('#annulla-pratica');
    await bottoneFinestra(p, 'Esci senza salvare').click();
    await p.waitForSelector('#contenuto h1:has-text("Via del Test 7")');
    assert.equal((await sql(p, "SELECT compenso_venditore_cent FROM pratiche WHERE codice = '2026/001'"))[0].compenso_venditore_cent, 430000);
  });

  test('una pratica che non esiste più viene spiegata, senza errori', async () => {
    const p = app.pagina;
    await vai(p, '#/pratiche/9999');
    assert.match(rimuoviSpazi(await p.locator('#contenuto').innerText()), /Pratica non trovata/);
    await vai(p, '#/pratiche/9999/modifica');
    assert.match(rimuoviSpazi(await p.locator('#contenuto').innerText()), /Pratica non trovata/);
    await vai(p, '#/indirizzo-che-non-esiste');
    assert.match(rimuoviSpazi(await p.locator('#contenuto h1').innerText()), /Dashboard/);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
