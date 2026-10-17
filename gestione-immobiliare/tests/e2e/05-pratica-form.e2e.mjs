// Nuova pratica e modifica: il modulo ha tre passi (zona; mese della proposta e prezzo; chi ha pagato e quanto, con contanti,
// bonifico e assegno: tutti con IVA compresa; i nominativi sono obbligatori). Numero, stato, data e ripartizione tra i collaboratori sono automatici; le informazioni
// facoltative stanno in una sezione chiusa. Totali in tempo reale, stima delle provvigioni, salvataggio sul database,
// avviso per le modifiche non salvate.
// I numeri attesi sono calcolati a mano.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto } from './lib.mjs';

const E = 100;

describe('Nuova pratica e modifica', () => {
  let app;
  before(async () => {
    app = await avvia();
    // zone di prova con le loro ripartizioni (si impostano una volta sola, poi valgono per ogni pratica della zona)
    await app.pagina.evaluate(async () => {
      const { api, app: a } = window.__gi;
      const [luca, giuseppe] = api.elencoCollaboratori(a.archivio);
      const zona = async (nome, quote) => { const id = await api.creaZona(a.archivio, { nome }); if (quote) await api.salvaRipartizioneZona(a.archivio, id, quote); return id; };
      await zona('Centro', [{ collaboratore_id: luca.id, percentuale: 100 }]);
      await zona('Collina', [{ collaboratore_id: luca.id, percentuale: 60 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]);
      await zona('Lungomare', [{ collaboratore_id: giuseppe.id, percentuale: 100 }]);
      await zona('Porto', null); // senza ripartizione
      await zona('Scalo', null); // senza ripartizione (resta così)
    });
  });
  after(async () => { await app.chiudi(); });

  /** Apre un modulo di nuova pratica pulito, uscendo senza salvare da un'eventuale schermata sporca. */
  async function apriNuova() {
    const p = app.pagina;
    await p.evaluate(() => { location.hash = '#/pratiche'; });
    // o compare la domanda "uscire senza salvare?" (modulo sporco) oppure si apre l'archivio
    await p.waitForFunction(() => document.querySelector('dialog.modale[open]') || document.querySelector('#contenuto h1')?.textContent === 'Archivio pratiche');
    if (await finestra(p).count()) await bottoneFinestra(p, 'Esci senza salvare').click();
    await vai(p, '#/nuova');
    await p.waitForSelector('#form-pratica');
  }
  beforeEach(async () => { await apriNuova(); });

  // i campi del modulo (la barra dei filtri, nascosta, ha etichette con lo stesso nome)
  const L = (etichetta, opzioni = {}) => app.pagina.locator('#form-pratica').getByLabel(etichetta, opzioni);
  const ZONA = /^Zona\*?$/;
  /** Importo pagato da una parte: parte = 'venditore' | 'acquirente', modo = 'Contanti' | 'Bonifico' | 'Assegno'. */
  const P = (parte, modo) => app.pagina.locator(`#pagamenti-${parte}`).getByLabel(modo);
  const errori = (p) => p.locator('#form-pratica .campo.ha-errore');
  const riepilogo = async () => rimuoviSpazi(await app.pagina.locator('.form-riepilogo .riepilogo-calcolo').innerText());
  const stima = async () => rimuoviSpazi(await app.pagina.locator('.stima-provvigione').innerText());
  const ripartizione = async () => rimuoviSpazi(await app.pagina.locator('#ripartizione-automatica').innerText());
  const scegliZona = async (nome) => { await L(ZONA).selectOption({ label: nome }); };
  /** Nominativi di venditore e acquirente (obbligatori). */
  const nomi = async (venditore = 'Mario Rossi', acquirente = 'Anna Bianchi') => {
    await L('Nominativo del venditore').fill(venditore);
    await L('Nominativo dell\'acquirente').fill(acquirente);
  };
  const testoDi = async (selettore) => rimuoviSpazi(await app.pagina.locator(selettore).innerText());
  /** Apre la sezione «Altre informazioni (facoltative)» se è chiusa. */
  const apriAltre = async () => { if (!(await app.pagina.locator('#altre-info').evaluate((d) => d.open))) await app.pagina.click('#altre-info summary'); };

  test('il modulo si apre con pochi campi: niente codice, stato, date e via; il resto è automatico', async () => {
    const p = app.pagina;
    assert.equal(rimuoviSpazi(await p.locator('#contenuto h1').innerText()), 'Nuova pratica');
    // quello che non si chiede più
    for (const etichetta of ['Codice pratica', /^Stato/, 'Data di apertura', 'Data del rogito', 'Indirizzo dell\'immobile', 'Comune']) {
      assert.equal(await L(etichetta).count(), 0, `non deve esserci il campo ${etichetta}`);
    }
    assert.equal(await p.locator('#form-pratica input[type="text"]').evaluateAll((a) => a.filter((i) => /gg\/mm\/aaaa/.test(i.placeholder)).length), 0, 'nessun campo data');
    assert.match(await testoDi('#data-pratica'), /^Data della pratica: 16\/10\/2026 \(oggi\)\.$/);
    // tre passi e una sezione chiusa per il resto
    assert.deepEqual((await p.locator('#form-pratica .form-colonna > section > h2').allInnerTexts()).map(rimuoviSpazi), ['1. In che zona?', '2. Quando e a che prezzo?', '3. Chi ha pagato e quanto?']);
    assert.equal(await p.locator('#altre-info').evaluate((d) => d.open), false, 'le informazioni facoltative sono chiuse');
    assert.equal(await testoDi('#altre-info summary'), 'Altre informazioni (facoltative)');
    // zona, prezzo, pagamenti
    assert.deepEqual((await L(ZONA).locator('option').allInnerTexts()).map((x) => x.trim()), ['Scegli la zona', 'Centro', 'Collina', 'Lungomare', 'Porto', 'Scalo']);
    assert.equal(await L('Prezzo di vendita').inputValue(), '');
    // mese della proposta: di default quello di oggi; da novembre 2026 (il prossimo) fino a ventiquattro mesi fa
    assert.equal(await L('Mese della proposta').locator('option:checked').innerText(), 'Ottobre 2026');
    const mesi = (await L('Mese della proposta').locator('option').allInnerTexts()).map((x) => x.trim());
    assert.deepEqual([mesi[0], mesi[1], mesi[mesi.length - 1], mesi.length], ['Novembre 2026', 'Ottobre 2026', 'Ottobre 2024', 26]);
    // i sei importi pagati (due parti × tre modi), tutti vuoti, con la dicitura sull'IVA
    for (const parte of ['venditore', 'acquirente']) {
      assert.match(await testoDi(`#pagamenti-${parte} legend`), parte === 'venditore' ? /^Il venditore$/i : /^L'acquirente$/i);
      assert.deepEqual((await p.locator(`#pagamenti-${parte} label`).allInnerTexts()).map((x) => rimuoviSpazi(x).replace('*', '')), [parte === 'venditore' ? 'Nominativo del venditore' : 'Nominativo dell\'acquirente', 'Contanti', 'Bonifico', 'Assegno']);
      assert.equal(await L(parte === 'venditore' ? 'Nominativo del venditore' : 'Nominativo dell\'acquirente').inputValue(), '');
      for (const modo of ['Contanti', 'Bonifico', 'Assegno']) assert.equal(await P(parte, modo).inputValue(), '');
    }
    // la ripartizione non si sceglie: niente righe, niente scorciatoie
    assert.equal(await p.locator('.quote-righe').count(), 0);
    assert.equal(await p.locator('#form-pratica').getByRole('button', { name: /^Tutto a / }).count(), 0);
    assert.equal(await p.locator('#form-pratica').getByRole('button', { name: 'Aggiungi collaboratore' }).count(), 0);
    assert.match(await ripartizione(), /Scegli la zona: i compensi si dividono da soli tra i collaboratori/);
    assert.match(await riepilogo(), /Totale pagato dai clienti 0,00 €/);
    assert.match(await stima(), /Scegli una zona con la sua divisione per vedere quanto spetta a ciascuno/);
    // il cursore è già sulla zona
    assert.equal(await p.evaluate(() => document.activeElement.labels?.[0]?.textContent.replace('*', '').trim()), 'Zona');
    // pulsanti
    assert.ok(await p.locator('#salva-pratica').isVisible());
    assert.ok(await p.locator('#salva-e-nuova').isVisible());
    assert.ok(await p.locator('#annulla-pratica').isVisible());
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Compila i tre passi/);
    // l'aliquota sta tra le informazioni facoltative
    assert.match(await testoDi('#form-pratica .form-colonna'), /contanti, bonifico e assegno comprendono l'IVA, la toglie il programma/);
    await apriAltre();
    assert.equal(await L('Aliquota IVA').inputValue(), '22');
    const iva = await L('Aliquota IVA').locator('option').allInnerTexts();
    assert.deepEqual(iva.map((x) => x.replace(/ /g, ' ')), ['22%', '10%', '4%', '0% (esente / non imponibile)']);
  });

  test('la zona è obbligatoria e gli importi non validi vengono segnalati, senza salvare', async () => {
    const p = app.pagina;
    await p.click('#salva-pratica');
    await errori(p).first().waitFor();
    const elenco = await p.$$eval('#form-pratica .campo.ha-errore .errore', (a) => a.map((x) => x.textContent.trim()));
    assert.ok(elenco.some((e) => /Scegli la zona/.test(e)), `errore sulla zona: ${elenco}`);
    assert.ok(elenco.some((e) => /Scrivi il nominativo del venditore/.test(e)), `nominativo del venditore obbligatorio: ${elenco}`);
    assert.ok(elenco.some((e) => /Scrivi il nominativo dell'acquirente/.test(e)), `nominativo dell'acquirente obbligatorio: ${elenco}`);
    await attendiNotifica(p, /Controlla i campi evidenziati/);
    assert.equal(await p.evaluate(() => location.hash), '#/nuova', 'si resta sul modulo');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    // il cursore va sul primo campo sbagliato
    assert.equal(await p.evaluate(() => document.activeElement.labels?.[0]?.textContent.replace('*', '').trim()), 'Zona');
    // importi scritti male (con i nominativi già scritti, che sono obbligatori)
    await scegliZona('Centro');
    await nomi();
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .campo.ha-errore').length === 0);
    await L('Prezzo di vendita').fill('abc');
    await P('venditore', 'Bonifico').fill('12x');
    await p.click('#salva-pratica');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .campo.ha-errore').length >= 2);
    const testi = (await p.$$eval('#form-pratica .campo.ha-errore .errore', (a) => a.map((x) => x.textContent.trim()))).join(' | ');
    assert.match(testi, /Scrivi un importo valido/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    // un errore in una sezione chiusa la riapre da solo
    await apriAltre();
    await L('Prezzo di acquisto').fill('zz');
    await p.click('#altre-info summary');
    assert.equal(await p.locator('#altre-info').evaluate((d) => d.open), false);
    await p.click('#salva-pratica');
    await p.waitForFunction(() => document.querySelector('#altre-info').open);
    await L('Prezzo di acquisto').fill('');
    // correggendo, l'errore del campo sparisce non appena si scrive
    await L('Prezzo di vendita').fill('100000');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .campo.ha-errore').length === 1);
    await P('venditore', 'Bonifico').fill('100');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .campo.ha-errore').length === 0);
  });

  test('contanti, bonifico e assegno comprendono tutti l\'IVA: compenso, IVA e totale si calcolano mentre si scrive', async () => {
    const p = app.pagina;
    const attesa = (re) => p.waitForFunction((x) => new RegExp(x).test(document.querySelector('.form-riepilogo').innerText.replace(/\s+/g, ' ')), re);
    await scegliZona('Centro');
    await L('Prezzo di vendita').fill('150.000,00');
    await P('venditore', 'Bonifico').fill('3.660');
    await P('acquirente', 'Contanti').fill('2.440');
    await attesa('Totale pagato dai clienti\\s+6\\.100,00');
    // venditore: 3.660,00 con IVA 22% = 3.000,00 + 660,00; acquirente: 2.440,00 in contanti, anche loro con IVA = 2.000,00 + 440,00
    assert.equal(await testoDi('#compenso-venditore'), 'Compenso senza IVA dal venditore: 3.000,00 € (IVA compresa: 660,00 €)');
    assert.equal(await testoDi('#compenso-acquirente'), 'Compenso senza IVA dall\'acquirente: 2.000,00 € (IVA compresa: 440,00 €)');
    assert.equal(await testoDi('#riep-imponibile'), '5.000,00 €');
    assert.equal(await testoDi('#riep-iva'), '1.100,00 €');
    assert.equal(await testoDi('#riep-pagato'), '6.100,00 €');
    assert.equal(await p.locator('#riep-venditore, #riep-acquirente').count(), 0, 'il conto ha solo tre righe');
    // la stessa parte può pagare in più modi: acquirente 2.440 contanti + 1.220 con assegno = 3.660 con IVA (3.000 + 660)
    await P('acquirente', 'Assegno').fill('1.220');
    await attesa('Totale pagato dai clienti\\s+7\\.320,00');
    assert.equal(await testoDi('#compenso-acquirente'), 'Compenso senza IVA dall\'acquirente: 3.000,00 € (IVA compresa: 660,00 €)');
    assert.equal(await testoDi('#riep-imponibile'), '6.000,00 €');
    assert.equal(await testoDi('#riep-iva'), '1.320,00 €');
    // cambiando l'aliquota cambia solo come i 7.320 pagati si dividono tra compenso e IVA
    // IVA 10%: per parte 3.660 / 1,10 = 3.327,27 (IVA 332,73); in tutto 6.654,54 + 665,46
    await apriAltre();
    await L('Aliquota IVA').selectOption('10');
    await attesa('IVA 10% \\(già dentro quanto pagato\\)\\s+665,46');
    assert.equal(await testoDi('#compenso-venditore'), 'Compenso senza IVA dal venditore: 3.327,27 € (IVA compresa: 332,73 €)');
    assert.equal(await testoDi('#riep-imponibile'), '6.654,54 €');
    assert.equal(await testoDi('#riep-pagato'), '7.320,00 €', 'quanto hanno pagato non cambia: cambia come si divide tra compenso e IVA');
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Modifiche non ancora salvate/);
    // contanti da soli: 1.000,00 con IVA 10% = 909,09 + 90,91
    for (const [parte, modo] of [['venditore', 'Bonifico'], ['acquirente', 'Contanti'], ['acquirente', 'Assegno']]) await P(parte, modo).fill('');
    await P('venditore', 'Contanti').fill('1.000');
    await attesa('Totale pagato dai clienti\\s+1\\.000,00');
    assert.equal(await testoDi('#compenso-venditore'), 'Compenso senza IVA dal venditore: 909,09 € (IVA compresa: 90,91 €)');
    // tutto vuoto di nuovo: zero
    await P('venditore', 'Contanti').fill('');
    await attesa('Totale pagato dai clienti\\s+0,00');
    assert.equal(await testoDi('#compenso-venditore'), '');
  });

  test('la ripartizione tra i collaboratori segue la zona, da sola; una zona senza ripartizione si sistema dal modulo', async () => {
    const p = app.pagina;
    const righe = async () => (await p.locator('#ripartizione-automatica .ripartizione-elenco li').allInnerTexts()).map(rimuoviSpazi);
    await scegliZona('Centro');
    assert.deepEqual(await righe(), ['Luca 100%']);
    assert.match(await ripartizione(), /Si divide come stabilito per la zona “Centro”/);
    await scegliZona('Collina');
    assert.deepEqual(await righe(), ['Luca 60%', 'Giuseppe 40%']);
    await scegliZona('Lungomare');
    assert.deepEqual(await righe(), ['Giuseppe 100%']);
    // una zona senza ripartizione: avviso e pulsante per impostarla (sono due collaboratori e non c'è una predefinita)
    await scegliZona('Porto');
    assert.equal(await p.locator('#ripartizione-mancante').count(), 1);
    assert.match(await ripartizione(), /Per la zona “Porto” non è ancora stabilito come dividere/);
    assert.match(await stima(), /Scegli una zona con la sua divisione per vedere quanto spetta a ciascuno/);
    await p.click('#imposta-ripartizione-zona');
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Ripartizione della zona Porto/);
    await f.getByRole('button', { name: 'Parti uguali' }).click();
    assert.match(rimuoviSpazi(await f.innerText()), /Totale quote: 100%/);
    await bottoneFinestra(p, 'Salva la ripartizione').click();
    await attendiNotifica(p, /Ripartizione della zona “Porto” salvata/);
    assert.deepEqual(await righe(), ['Luca 50%', 'Giuseppe 50%']);
    assert.equal(await p.locator('#ripartizione-mancante').count(), 0);
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM zone_quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN zone z ON z.id = q.zona_id WHERE z.nome = 'Porto' ORDER BY c.id"), [{ nome: 'Luca', percentuale: 50 }, { nome: 'Giuseppe', percentuale: 50 }]);
    // la finestra rifiuta quote che non fanno 100%
    await p.click('#imposta-ripartizione-zona');
    await f.getByLabel('Quota di Luca').fill('70');
    await f.getByLabel('Quota di Giuseppe').fill('20');
    await bottoneFinestra(p, 'Salva la ripartizione').click();
    await f.locator('.errore').getByText(/Le quote sommano 90%: devono fare 100%/).waitFor();
    await bottoneFinestra(p, 'Annulla').click();
    assert.deepEqual(await righe(), ['Luca 50%', 'Giuseppe 50%'], 'annullando resta quella di prima');
    // senza zona non si divide niente
    await L(ZONA).selectOption('');
    assert.match(await ripartizione(), /Scegli la zona/);
  });

  test('stima delle provvigioni: senza scaglioni lo dice; con gli scaglioni si aggiorna mentre si scrive, per ciascun collaboratore', async () => {
    const p = app.pagina;
    // il programma parte con gli scaglioni dell'agenzia: per provare il caso «senza scaglioni» si svuota la tabella e si riapre il modulo
    await p.evaluate(async () => { const { api, app: a } = window.__gi; await api.salvaTabellaScaglioni(a.archivio, null, []); });
    await apriNuova();
    await scegliZona('Centro');
    await P('acquirente', 'Contanti').fill('1.000');
    await p.waitForFunction(() => /scaglioni non sono ancora impostati/.test(document.querySelector('.stima-provvigione').textContent));
    // scaglioni dell'agenzia: 5% fino a 2.600, 8% fino a 5.200, 11% fino a 7.800, 15% fino a 13.000, 20% oltre
    await p.evaluate(async () => {
      const { api, app: a } = window.__gi;
      await api.salvaTabellaScaglioni(a.archivio, null, [{ da_cent: 0, percentuale: 5 }, { da_cent: 260001, percentuale: 8 }, { da_cent: 520001, percentuale: 11 }, { da_cent: 780001, percentuale: 15 }, { da_cent: 1300001, percentuale: 20 }]);
    });
    await apriNuova();
    await scegliZona('Centro');
    // venditore 3.050 con bonifico (= 2.500 + 550 di IVA) + acquirente 3.050 in contanti (= 2.500 + 550) = 5.000 senza IVA → 2° scaglione (8%) = 400
    await P('venditore', 'Bonifico').fill('3.050');
    await P('acquirente', 'Contanti').fill('3.050');
    await p.waitForFunction(() => /Quota 100% dei compensi: 5\.000,00/.test(document.querySelector('.stima-provvigione').textContent));
    let s = await stima();
    assert.match(s, /Luca\s*400,00 €/);
    assert.match(s, /Cumulo di ottobre 2026 in Centro: 5\.000,00 € → scaglione 2 \(8%\)/);
    assert.match(s, /Mancano 200,01 € allo scaglione 3 \(11%\)/);
    // 7.320 con bonifico (= 6.000 + 1.320 di IVA) + 7.320 in contanti (= 6.000 + 1.320) = 12.000 → 4° scaglione (15%) = 1.800
    await P('venditore', 'Bonifico').fill('7.320');
    await P('acquirente', 'Contanti').fill('7.320');
    await p.waitForFunction(() => /Quota 100% dei compensi: 12\.000,00/.test(document.querySelector('.stima-provvigione').textContent));
    s = await stima();
    assert.match(s, /Luca\s*1\.800,00 €/);
    assert.match(s, /→ scaglione 4 \(15%\)/);
    assert.match(s, /Mancano 1\.000,01 € allo scaglione 5 \(20%\)/);
    // in una zona divisa 60/40 ognuno ha il suo cumulo: Luca 7.200 → 3° scaglione (11%) = 792; Giuseppe 4.800 → 2° scaglione (8%) = 384
    await scegliZona('Collina');
    await p.waitForFunction(() => /Giuseppe/.test(document.querySelector('.stima-provvigione').textContent));
    s = await stima();
    assert.match(s, /Luca\s*792,00 €\s*Quota 60% dei compensi: 7\.200,00 €/);
    assert.match(s, /Giuseppe\s*384,00 €\s*Quota 40% dei compensi: 4\.800,00 €/);
  });

  test('"Nuova zona" dal modulo crea la zona con la sua ripartizione e la sceglie; un nome già usato viene rifiutato', async () => {
    const p = app.pagina;
    await p.click('#nuova-zona');
    const f = finestra(p);
    await f.getByLabel('Nome della zona').fill('Spiaggia');
    // quote che non fanno 100%: la finestra non si chiude
    await f.getByLabel('Quota di Luca').fill('60');
    await bottoneFinestra(p, 'Crea zona').click();
    await f.locator('.errore').getByText(/Le quote sommano 60%/).waitFor();
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone WHERE nome = 'Spiaggia'"), 0);
    await f.getByRole('button', { name: 'Tutto a Giuseppe' }).click();
    await bottoneFinestra(p, 'Crea zona').click();
    await attendiNotifica(p, /Zona “Spiaggia” creata con la sua ripartizione/);
    assert.equal(await L(ZONA).locator('option:checked').innerText(), 'Spiaggia');
    assert.deepEqual((await p.locator('#ripartizione-automatica .ripartizione-elenco li').allInnerTexts()).map(rimuoviSpazi), ['Giuseppe 100%']);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone_quote WHERE zona_id = (SELECT id FROM zone WHERE nome = 'Spiaggia')"), 1);
    // un nome già usato (anche in minuscolo) viene rifiutato
    await p.click('#nuova-zona');
    await f.getByLabel('Nome della zona').fill('spiaggia');
    await bottoneFinestra(p, 'Crea zona').click();
    await f.locator('.ha-errore').waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /esiste già/i);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone WHERE nome = 'Spiaggia'"), 1);
    // una zona creata senza ripartizione si segnala e si sistema da lì
    await p.click('#nuova-zona');
    await f.getByLabel('Nome della zona').fill('Darsena');
    await bottoneFinestra(p, 'Crea zona').click();
    await attendiNotifica(p, /Zona “Darsena” creata\. Ricorda di impostarne la ripartizione/);
    assert.equal(await p.locator('#ripartizione-mancante').count(), 1);
  });

  test('salvataggio completo: numero, stato e data automatici, i dati arrivano nel database e la scheda li mostra', async () => {
    const p = app.pagina;
    await scegliZona('Centro');
    await L('Prezzo di vendita').fill('185.000,00');
    await L('Mese della proposta').selectOption({ label: 'Settembre 2026' });
    await nomi();
    await apriAltre();
    await L('Tipo di immobile').selectOption({ label: 'Appartamento' });
    await L('Prezzo di acquisto').fill('150.000,00');
    // 4.514,00 con IVA 22% = 3.700,00 + 814,00 (venditore con bonifico, acquirente con assegno)
    await P('venditore', 'Bonifico').fill('4.514,00');
    await P('acquirente', 'Assegno').fill('4.514,00');
    await L('Note', { exact: true }).fill('Atto presso il notaio\nsecondo piano');
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 salvata/);
    await p.waitForSelector('#contenuto h1:has-text("Zona Centro")');
    assert.match(await p.evaluate(() => location.hash), /^#\/pratiche\/\d+$/);
    const riga = (await sql(p, 'SELECT * FROM pratiche'))[0];
    assert.deepEqual(
      [riga.codice, riga.stato, riga.data_pratica, riga.data_rogito, riga.mese_proposta, riga.immobile_indirizzo, riga.immobile_comune, riga.immobile_tipo, riga.prezzo_vendita_cent, riga.prezzo_acquisto_cent, riga.venditore, riga.acquirente, riga.aliquota_iva, riga.note],
      ['2026/001', 'conclusa', '2026-10-16', '2026-10-16', '2026-09', null, null, 'Appartamento', 18500000, 15000000, 'Mario Rossi', 'Anna Bianchi', 22, 'Atto presso il notaio\nsecondo piano']);
    assert.deepEqual(
      [riga.compensi_da_pagamenti, riga.venditore_contanti_cent, riga.venditore_bonifico_cent, riga.venditore_assegno_cent, riga.acquirente_contanti_cent, riga.acquirente_bonifico_cent, riga.acquirente_assegno_cent, riga.compenso_venditore_cent, riga.compenso_acquirente_cent],
      [1, 0, 451400, 0, 0, 0, 451400, 370000, 370000]);
    assert.equal(await valoreSql(p, 'SELECT nome FROM zone WHERE id = ?', [riga.zona_id]), 'Centro');
    const quote = await sql(p, 'SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id ORDER BY c.id');
    assert.deepEqual(quote, [{ nome: 'Luca', percentuale: 100 }], 'ripartizione presa dalla zona Centro');
    // la scheda
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Conclusa/);
    assert.match(t, /Pratica 2026\/001 · Appartamento · Zona Centro/);
    assert.match(t, /Prezzo di vendita 185\.000,00 €/);
    assert.match(t, /Differenza \+35\.000,00 € \(\+23,3%\)/);
    assert.match(t, /Mese della proposta settembre 2026 Inserita il 16\/10\/2026/);
    assert.doesNotMatch(t, /Tempo di lavorazione|Rogito|Indirizzo/);
    assert.match(t, /Totale compenso senza IVA 7\.400,00 €/);
    assert.match(t, /IVA 22% compresa in quanto pagato 1\.628,00 €/);
    assert.match(t, /Totale pagato dalle parti 9\.028,00 €/);
    assert.match(t, /Incassato 9\.028,00 € Saldata/);
    assert.match(t, /Atto presso il notaio secondo piano/);
    const pagamenti = (await p.locator('#tabella-pagamenti tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent)))).map((r) => r.map(rimuoviSpazi));
    assert.deepEqual(pagamenti, [['Venditore', 'Bonifico', '4.514,00 €', 'compresa'], ['Acquirente', 'Assegno', '4.514,00 €', 'compresa']]);
    // 7.400 € di Luca nel Centro a ottobre → 3° scaglione (11%) = 814,00 €
    const righe = (await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent)))).map((r) => r.map(rimuoviSpazi));
    assert.deepEqual(righe.map((r) => [r[0], r[1], r[2], r[4]]), [['Luca', '100%', '7.400,00 €', '814,00 €']]);
    // con "Come è stata calcolata" i passaggi spiegano anche i pagamenti
    await p.locator('#come-calcolato summary').click();
    assert.match(rimuoviSpazi(await p.locator('#come-calcolato').innerText()), /Compenso della pratica: 3\.700,00 € dal venditore \+ 3\.700,00 € dall'acquirente = 7\.400,00 € \(senza IVA: l'IVA è stata tolta da quanto hanno pagato\)/);
  });

  test('"Salva e inserisci un\'altra" salva e riapre un modulo vuoto con il numero successivo', async () => {
    const p = app.pagina;
    await scegliZona('Lungomare');
    await nomi();
    await P('venditore', 'Contanti').fill('1.000');
    await p.click('#salva-e-nuova');
    await attendiNotifica(p, /Pratica 2026\/002 salvata/);
    await p.waitForFunction(() => document.querySelector('#form-pratica select')?.value === '');
    assert.equal(await p.evaluate(() => location.hash), '#/nuova');
    assert.equal(await L(ZONA).inputValue(), '');
    assert.equal(await P('venditore', 'Contanti').inputValue(), '');
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Compila i tre passi/);
    assert.equal(await p.evaluate(() => document.activeElement.labels?.[0]?.textContent.replace('*', '').trim()), 'Zona');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 2);
    assert.deepEqual(await sql(p, "SELECT codice, stato, data_pratica, data_rogito FROM pratiche WHERE codice = '2026/002'"), [{ codice: '2026/002', stato: 'conclusa', data_pratica: '2026-10-16', data_rogito: '2026-10-16' }]);
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN pratiche pr ON pr.id = q.pratica_id WHERE pr.codice = '2026/002'"), [{ nome: 'Giuseppe', percentuale: 100 }], 'Lungomare è di Giuseppe');
    // uscendo subito non compare nessun avviso (non ci sono modifiche)
    await p.click('.sidebar .nav-voce[data-id="pratiche"]');
    await p.waitForSelector('#contenuto h1:has-text("Archivio pratiche")');
    assert.equal(await finestra(p).count(), 0);
  });

  test('uscire con modifiche non salvate chiede conferma ("Resta qui" le conserva)', async () => {
    const p = app.pagina;
    await scegliZona('Collina');
    await P('acquirente', 'Contanti').fill('777');
    await p.click('.sidebar .nav-voce[data-id="cumulo"]');
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Uscire senza salvare\?/);
    assert.match(rimuoviSpazi(await f.innerText()), /modifiche non salvate/);
    await bottoneFinestra(p, 'Resta qui').click();
    assert.equal(await p.evaluate(() => location.hash), '#/nuova');
    assert.equal(await P('acquirente', 'Contanti').inputValue(), '777,00');
    // anche il pulsante Annulla è protetto
    await p.click('#annulla-pratica');
    await f.waitFor();
    await bottoneFinestra(p, 'Resta qui').click();
    assert.equal(await P('acquirente', 'Contanti').inputValue(), '777,00');
    // poi si esce davvero
    await p.click('.sidebar .nav-voce[data-id="cumulo"]');
    await f.waitFor();
    await bottoneFinestra(p, 'Esci senza salvare').click();
    await p.waitForSelector('#contenuto h1:has-text("Cumulo mensile per zona")');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 2, 'nulla è stato salvato');
  });

  test('una zona senza ripartizione: si può salvare lo stesso dopo conferma, e la pratica viene segnalata', async () => {
    const p = app.pagina;
    await scegliZona('Scalo');
    await nomi();
    await P('venditore', 'Contanti').fill('500');
    await p.click('#salva-pratica');
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /La zona non ha una ripartizione/);
    // "Annulla" non salva niente
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 2);
    await p.click('#salva-pratica');
    await bottoneFinestra(p, 'Salva comunque').click();
    await attendiNotifica(p, /Pratica 2026\/003 salvata/);
    await p.waitForSelector('#contenuto h1:has-text("Zona Scalo")');
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Dati da completare:/);
    assert.match(t, /Prezzo di vendita mancante/);
    assert.match(t, /Ripartizione tra collaboratori mancante/);
    assert.match(t, /Completa i dati/);
    // il collegamento porta al modulo di modifica
    await p.getByRole('link', { name: 'Completa i dati' }).click();
    await p.waitForSelector('#contenuto h1:has-text("Modifica pratica 2026/003")');
  });

  test('modifica: il modulo riporta i dati, salva le differenze e aggiorna la scheda; cambiando zona cambia la ripartizione', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}/modifica`);
    assert.equal(rimuoviSpazi(await p.locator('#contenuto h1').innerText()), 'Modifica pratica 2026/001');
    assert.equal(await L('Codice pratica').count(), 0);
    assert.equal(await L(/^Stato/).count(), 0);
    assert.match(await testoDi('#data-pratica'), /^Data della pratica: 16\/10\/2026\.$/);
    assert.equal(await L('Prezzo di vendita').inputValue(), '185.000,00');
    assert.equal(await P('venditore', 'Bonifico').inputValue(), '4.514,00');
    assert.equal(await P('acquirente', 'Assegno').inputValue(), '4.514,00');
    assert.equal(await P('venditore', 'Contanti').inputValue(), '');
    assert.equal(await L(ZONA).locator('option:checked').innerText(), 'Centro');
    assert.match(await ripartizione(), /Luca 100%.*Divisione già registrata per questa pratica/);
    assert.match(await riepilogo(), /Già incassato \(con eventuali incassi successivi\) 9\.028,00 €/);
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Nessuna modifica/);
    assert.equal(await p.locator('#salva-e-nuova').count(), 0);
    // il venditore ora ha pagato 5.124,00 con bonifico (= 4.200 + 924 di IVA)
    await P('venditore', 'Bonifico').fill('5.124');
    assert.match(rimuoviSpazi(await p.locator('.stato-mod').innerText()), /Modifiche non ancora salvate/);
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 aggiornata/);
    await p.waitForSelector('#contenuto h1:has-text("Zona Centro")');
    const dopo = (await sql(p, "SELECT * FROM pratiche WHERE codice = '2026/001'"))[0];
    assert.deepEqual([dopo.venditore_bonifico_cent, dopo.compenso_venditore_cent, dopo.data_pratica, dopo.data_rogito, dopo.stato], [512400, 420000, '2026-10-16', '2026-10-16', 'conclusa'], 'cambiano solo gli importi: numero, data e stato restano');
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN pratiche pr ON pr.id = q.pratica_id WHERE pr.codice = '2026/001'"), [{ nome: 'Luca', percentuale: 100 }]);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Totale compenso senza IVA 7\.900,00 €/);
    // 7.900 € di Luca a ottobre nel Centro → 4° scaglione (15%) = 1.185,00 €
    const righe = (await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent)))).map((r) => r.map(rimuoviSpazi));
    assert.deepEqual(righe.map((r) => [r[0], r[1], r[2], r[4]]), [['Luca', '100%', '7.900,00 €', '1.185,00 €']]);
    // cambiando la zona la ripartizione cambia da sola (Lungomare è di Giuseppe); tornando alla zona di prima torna quella registrata
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}/modifica`);
    await scegliZona('Lungomare');
    assert.deepEqual((await p.locator('#ripartizione-automatica .ripartizione-elenco li').allInnerTexts()).map(rimuoviSpazi), ['Giuseppe 100%']);
    await scegliZona('Centro');
    assert.match(await ripartizione(), /Luca 100%.*Divisione già registrata/);
    await scegliZona('Lungomare');
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 aggiornata/);
    await p.waitForSelector('#contenuto h1:has-text("Zona Lungomare")');
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN pratiche pr ON pr.id = q.pratica_id WHERE pr.codice = '2026/001'"), [{ nome: 'Giuseppe', percentuale: 100 }]);
    // l'annullamento della modifica non salva niente
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}/modifica`);
    await P('venditore', 'Contanti').fill('1');
    await p.click('#annulla-pratica');
    await bottoneFinestra(p, 'Esci senza salvare').click();
    await p.waitForSelector('#contenuto h1:has-text("Zona Lungomare")');
    assert.equal(await valoreSql(p, "SELECT venditore_contanti_cent FROM pratiche WHERE codice = '2026/001'"), 0);
  });

  test('una pratica vecchia (solo compenso senza IVA) si apre nel nuovo modulo e si salva senza cambiare i numeri', async () => {
    const p = app.pagina;
    const id = await p.evaluate(async () => {
      const { api, app: a } = window.__gi;
      const zona = api.elencoZone(a.archivio).find((z) => z.nome === 'Collina').id;
      const [luca, giuseppe] = api.elencoCollaboratori(a.archivio);
      return api.salvaPratica(a.archivio, {
        codice: 'V/1', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-09-10', zona_id: zona, immobile_indirizzo: 'Via Vecchia 5',
        prezzo_vendita_cent: 9000000, compenso_venditore_cent: 300000, compenso_acquirente_cent: 200000, aliquota_iva: 22,
      }, [{ collaboratore_id: luca.id, percentuale: 70 }, { collaboratore_id: giuseppe.id, percentuale: 30 }]);
    });
    await vai(p, `#/pratiche/${id}/modifica`);
    assert.equal(await p.locator('#nota-pratica-vecchia').count(), 1);
    assert.match(await testoDi('#data-pratica'), /^Data della pratica: 10\/09\/2026\.$/);
    // compenso riportato come bonifico con IVA compresa: 3.000 × 1,22 = 3.660; 2.000 × 1,22 = 2.440
    assert.equal(await P('venditore', 'Bonifico').inputValue(), '3.660,00');
    assert.equal(await P('acquirente', 'Bonifico').inputValue(), '2.440,00');
    assert.equal(await testoDi('#riep-imponibile'), '5.000,00 €');
    assert.equal(await testoDi('#riep-iva'), '1.100,00 €');
    assert.match(await ripartizione(), /Luca 70%.*Giuseppe 30%.*Divisione già registrata/, 'la ripartizione di allora resta');
    // la pratica vecchia non ha i nominativi: ora sono obbligatori, il modulo li chiede prima di salvare
    assert.equal(await L('Mese della proposta').locator('option:checked').innerText(), 'Settembre 2026', 'proposto il mese del rogito di allora');
    await p.click('#salva-pratica');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .campo.ha-errore').length === 2);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM pratiche WHERE codice = 'V/1' AND venditore IS NOT NULL"), 0, 'non è stato salvato niente');
    await nomi('Giulia Verdi', 'Paolo Neri');
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica V\/1 aggiornata/);
    await p.waitForSelector('#contenuto h1:has-text("Via Vecchia 5")');
    const r = (await sql(p, "SELECT * FROM pratiche WHERE codice = 'V/1'"))[0];
    assert.deepEqual([r.compensi_da_pagamenti, r.compenso_venditore_cent, r.compenso_acquirente_cent, r.data_pratica, r.data_rogito, r.immobile_indirizzo, r.venditore, r.acquirente, r.mese_proposta], [1, 300000, 200000, '2026-09-01', '2026-09-10', 'Via Vecchia 5', 'Giulia Verdi', 'Paolo Neri', '2026-09'], 'importi, date e indirizzo di allora restano');
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id WHERE q.pratica_id = ? ORDER BY c.id", [id]), [{ nome: 'Luca', percentuale: 70 }, { nome: 'Giuseppe', percentuale: 30 }]);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Totale compenso senza IVA 5\.000,00 €/);
    assert.match(t, /Mese della proposta settembre 2026 Inserita il 01\/09\/2026/);
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
