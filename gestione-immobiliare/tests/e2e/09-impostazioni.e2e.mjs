// Impostazioni: collaboratori, zone, scaglioni, metodo di calcolo, ripartizione, aliquote, preferenze, informazioni.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  avvia, vai, conNavigazione, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto, riquadri, totaliStatistiche, scegliZona, azzeraFiltri,
} from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const SEZIONI = ['Collaboratori', 'Zone', 'Scaglioni e percentuali', 'Metodo di calcolo', 'Ripartizione predefinita', 'Aliquote IVA', 'Preferenze', 'Informazioni'];

describe('Impostazioni', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await azzeraFiltri(p);
  });
  const apri = async (sezione, extra = '') => { await vai(app.pagina, `#/impostazioni?sezione=${sezione}${extra}`); await app.pagina.waitForSelector('.imp-corpo .card'); };
  const riga = (nome) => app.pagina.locator('.riga-elenco', { hasText: nome }).first();

  test('il menu ha le otto sezioni; ogni voce apre la sua e l\'indirizzo la ricorda', async () => {
    const p = app.pagina;
    await vai(p, '#/impostazioni');
    assert.deepEqual((await p.locator('.menu-imp button').allInnerTexts()).map((x) => x.trim()), SEZIONI);
    assert.equal(await p.locator('.menu-imp button[aria-current="true"]').innerText(), 'Collaboratori');
    const titoli = { collaboratori: 'Collaboratori', zone: 'Zone', scaglioni: 'Scaglioni e percentuali', calcolo: 'Metodo di calcolo', ripartizione: 'Ripartizione predefinita', iva: 'Aliquote IVA', preferenze: 'Aspetto', info: 'Informazioni' };
    for (const [id, titolo] of Object.entries(titoli)) {
      await p.click(`#imp-${id}`);
      await p.waitForFunction((t) => [...document.querySelectorAll('.imp-corpo h2')].some((h) => h.textContent.trim() === t), titolo);
      assert.equal(await p.evaluate(() => location.hash), `#/impostazioni?sezione=${id}`);
      assert.equal(await p.locator('.menu-imp button[aria-current="true"]').count(), 1);
    }
    await apri('zone');
    assert.equal(await p.locator('.menu-imp button[aria-current="true"]').innerText(), 'Zone');
  });

  test('collaboratori: elenco con utilizzi, aggiunta, controlli sul nome, modifica, attiva/disattiva', async () => {
    const p = app.pagina;
    await apri('collaboratori');
    assert.match(rimuoviSpazi(await riga('Luca').innerText()), /Luca 9 pratiche · 2 liquidazioni · nella ripartizione di 2 zone Attivo/);
    assert.match(rimuoviSpazi(await riga('Giuseppe').innerText()), /Giuseppe 7 pratiche · 1 liquidazioni · nella ripartizione di 2 zone Attivo/);
    // nome vuoto e doppione
    await p.click('#aggiungi-collaboratore');
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo .errore').first().innerText()), /Scrivi un nome/);
    await p.getByLabel('Nome del collaboratore').fill('luca');
    await p.click('#aggiungi-collaboratore');
    await p.waitForFunction(() => /Esiste già una voce con questo nome/.test(document.querySelector('.imp-corpo').textContent));
    // aggiunta
    await p.getByLabel('Nome del collaboratore').fill('Marco');
    await p.click('#aggiungi-collaboratore');
    await attendiNotifica(p, /Collaboratore “Marco” aggiunto/);
    await riga('Marco').waitFor();
    assert.match(rimuoviSpazi(await riga('Marco').innerText()), /Marco 0 pratiche · 0 liquidazioni Attivo/);
    assert.equal(await valoreSql(p, "SELECT colore FROM collaboratori WHERE nome = 'Marco'"), 3, 'riceve il primo colore libero');
    // compare nei filtri e nelle proposte
    assert.deepEqual((await p.locator('#filtro-collab option').allInnerTexts()).map((x) => x.trim()), ['Tutti i collaboratori', 'Luca', 'Giuseppe', 'Marco']);
    // modifica: nome, colore, attivo
    await riga('Marco').getByRole('button', { name: 'Modifica' }).click();
    const f = finestra(p);
    await f.getByLabel('Nome').fill('Marco R.');
    await f.getByLabel('Colore nei grafici').selectOption({ label: 'Rosa' });
    await f.getByLabel('Collaboratore attivo').uncheck();
    await bottoneFinestra(p, 'Salva').click();
    await attendiNotifica(p, /Modifiche salvate/);
    assert.deepEqual(await sql(p, "SELECT nome, colore, attivo FROM collaboratori WHERE nome = 'Marco R.'"), [{ nome: 'Marco R.', colore: 5, attivo: 0 }]);
    assert.match(rimuoviSpazi(await riga('Marco R.').innerText()), /Non attivo/);
    // un collaboratore non attivo non viene più proposto nel modulo della pratica, ma resta nei filtri come "(non attivo)"
    assert.match((await p.locator('#filtro-collab option').allInnerTexts()).join('|'), /Marco R\. \(non attivo\)/);
    await riga('Marco R.').getByRole('button', { name: 'Attiva' }).click();
    await attendiNotifica(p, /Marco R\.: attivato/);
    assert.equal(await valoreSql(p, "SELECT attivo FROM collaboratori WHERE nome = 'Marco R.'"), 1);
    await riga('Marco R.').getByRole('button', { name: 'Disattiva' }).waitFor();
  });

  test('collaboratori: uno in uso non si elimina (si disattiva); uno senza usi si elimina dopo conferma', async () => {
    const p = app.pagina;
    await apri('collaboratori');
    await riga('Luca').getByRole('button', { name: 'Elimina' }).click();
    const f = finestra(p);
    let t = rimuoviSpazi(await f.innerText());
    assert.match(t, /Collaboratore in uso: non si può eliminare/);
    assert.match(t, /Luca compare in 9 pratiche e ha 2 liquidazioni registrate/);
    assert.match(t, /Puoi disattivarlo/);
    await bottoneFinestra(p, 'Chiudi').click();
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM collaboratori WHERE nome = 'Luca'"), 1);
    // elimina "Marco R." (nessun uso)
    await riga('Marco R.').getByRole('button', { name: 'Elimina' }).click();
    t = rimuoviSpazi(await f.innerText());
    assert.match(t, /Eliminare “Marco R\.”\?/);
    assert.match(t, /Non è usato da nessuna pratica/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM collaboratori'), 3);
    await riga('Marco R.').getByRole('button', { name: 'Elimina' }).click();
    await bottoneFinestra(p, 'Elimina').click();
    await attendiNotifica(p, /Collaboratore eliminato/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM collaboratori'), 2);
    await p.waitForFunction(() => !document.querySelector('.imp-corpo').textContent.includes('Marco R.'));
    assert.deepEqual((await p.locator('#filtro-collab option').allInnerTexts()).map((x) => x.trim()), ['Tutti i collaboratori', 'Luca', 'Giuseppe']);
  });

  test('zone: aggiunta, doppione, modifica, disattivazione; una zona usata non si elimina', async () => {
    const p = app.pagina;
    await apri('zone');
    assert.match(rimuoviSpazi(await riga('Centro').innerText()), /Centro 7 pratiche · scaglioni predefiniti · ripartizione: Luca 100% Attivo/);
    await p.getByLabel('Nome della zona').fill('CENTRO');
    await p.click('#aggiungi-zona');
    await p.waitForFunction(() => /Esiste già una voce con questo nome/.test(document.querySelector('.imp-corpo').textContent));
    await p.getByLabel('Nome della zona').fill('Porto');
    await p.click('#aggiungi-zona');
    await attendiNotifica(p, /Zona “Porto” aggiunta/);
    await riga('Porto').waitFor();
    assert.match(rimuoviSpazi(await riga('Porto').innerText()), /Porto 0 pratiche · scaglioni predefiniti · ripartizione: NON IMPOSTATA Attivo/);
    // la ripartizione della zona: quote che non fanno 100% rifiutate, poi «Tutto a Giuseppe»
    await riga('Porto').getByRole('button', { name: 'Ripartizione' }).click();
    const rip = finestra(p);
    assert.match(rimuoviSpazi(await rip.innerText()), /Ripartizione della zona Porto/);
    await rip.getByLabel('Quota di Luca').fill('30');
    await bottoneFinestra(p, 'Salva la ripartizione').click();
    await rip.locator('.errore').getByText(/Le quote sommano 30%: devono fare 100%/).waitFor();
    await rip.getByRole('button', { name: 'Tutto a Giuseppe' }).click();
    await bottoneFinestra(p, 'Salva la ripartizione').click();
    await attendiNotifica(p, /Ripartizione della zona “Porto” salvata/);
    await p.waitForFunction(() => /Porto 0 pratiche · scaglioni predefiniti · ripartizione: Giuseppe 100%/.test(document.querySelector('.imp-corpo').innerText.replace(/\s+/g, ' ')));
    assert.deepEqual(await sql(p, "SELECT c.nome, q.percentuale FROM zone_quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN zone z ON z.id = q.zona_id WHERE z.nome = 'Porto'"), [{ nome: 'Giuseppe', percentuale: 100 }]);
    // modifica e disattivazione
    await riga('Porto').getByRole('button', { name: 'Modifica' }).click();
    const f = finestra(p);
    await f.getByLabel('Nome').fill('Porto vecchio');
    await f.getByLabel('Zona attiva').uncheck();
    await bottoneFinestra(p, 'Salva').click();
    await attendiNotifica(p, /Modifiche salvate/);
    assert.deepEqual(await sql(p, "SELECT nome, attiva FROM zone WHERE nome = 'Porto vecchio'"), [{ nome: 'Porto vecchio', attiva: 0 }]);
    // una zona non attiva non si propone nella nuova pratica
    await vai(p, '#/nuova');
    assert.deepEqual((await p.locator('#form-pratica').getByLabel(/^Zona\*?$/).locator('option').allInnerTexts()).map((x) => x.trim()), ['Scegli la zona', 'Centro', 'Collina', 'Lungomare']);
    await p.evaluate(() => { location.hash = '#/impostazioni?sezione=zone'; });
    await p.waitForSelector('.imp-corpo .card');
    // zona in uso: blocco
    await riga('Lungomare').getByRole('button', { name: 'Elimina' }).click();
    assert.match(rimuoviSpazi(await f.innerText()), /Zona in uso: non si può eliminare/);
    assert.match(rimuoviSpazi(await f.innerText()), /La zona “Lungomare” è usata da 5 pratiche/);
    await bottoneFinestra(p, 'Chiudi').click();
    // zona libera: conferma ed eliminazione
    await riga('Porto vecchio').getByRole('button', { name: 'Elimina' }).click();
    await bottoneFinestra(p, 'Elimina').click();
    await attendiNotifica(p, /Zona eliminata/);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone WHERE nome LIKE 'Porto%'"), 0);
  });

  test('scaglioni: la tabella mostra le soglie, l\'anteprima le spiega e l\'esempio confronta i due metodi', async () => {
    const p = app.pagina;
    await apri('scaglioni');
    const soglie = await p.locator('#tabella-editor-scaglioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.querySelectorAll('input')].map((i) => i.value)));
    assert.deepEqual(soglie, [['0,00', '30'], ['10.000,00', '35'], ['20.000,00', '40']]);
    assert.equal(await p.getByLabel('Soglia dello scaglione 1').evaluate((i) => i.readOnly), true, 'il primo scaglione parte sempre da zero');
    const anteprima = (await p.locator('ul.esempio-calcolo li').allInnerTexts()).map((x) => x.replace(/ /g, ' ').trim());
    assert.deepEqual(anteprima, [
      '1° scaglione: da 0,00 € a 9.999,99 € → 30%', '2° scaglione: da 10.000,00 € a 19.999,99 € → 35%', '3° scaglione: da 20.000,00 € in su → 40%',
    ]);
    await p.getByLabel('Prova con un cumulo mensile di').fill('13.000');
    const es = rimuoviSpazi(await p.locator('.imp-corpo div.esempio-calcolo').innerText());
    assert.match(es, /Con 13\.000,00 € di cumulo mensile:/);
    assert.match(es, /scaglione raggiunto: 4\.550,00 € \(metodo in uso\)/); // 13.000 × 35%
    assert.match(es, /progressivo: 4\.050,00 €/); // 10.000 × 30% + 3.000 × 35%
    // una soglia che coincide con la precedente: la soglia esatta appartiene allo scaglione più alto
    await p.getByLabel('Prova con un cumulo mensile di').fill('10.000');
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo div.esempio-calcolo').innerText()), /scaglione raggiunto: 3\.500,00 €/);
  });

  test('scaglioni: controlli prima di salvare (soglie ripetute, percentuale oltre 100, campi vuoti)', async () => {
    const p = app.pagina;
    await apri('scaglioni');
    const n0 = await valoreSql(p, 'SELECT COUNT(*) FROM scaglioni WHERE zona_id IS NULL');
    await p.getByLabel('Soglia dello scaglione 2').fill('0');
    await p.click('#salva-scaglioni');
    await p.waitForFunction(() => document.querySelector('.imp-corpo .campo.ha-errore .errore')?.textContent.trim().length > 0);
    const messaggio = rimuoviSpazi(await p.locator('.imp-corpo .campo.ha-errore .errore').innerText());
    assert.ok(messaggio.length > 10, `messaggio chiaro: ${messaggio}`);
    await p.getByLabel('Soglia dello scaglione 2').fill('10000');
    await p.getByLabel('Percentuale dello scaglione 3').fill('150');
    await p.click('#salva-scaglioni');
    await p.waitForFunction(() => /100|percentuale/i.test(document.querySelector('.imp-corpo .campo.ha-errore .errore')?.textContent ?? ''));
    await p.getByLabel('Percentuale dello scaglione 3').fill('');
    await p.click('#salva-scaglioni');
    await p.waitForFunction(() => /Compila la soglia e la percentuale/.test(document.querySelector('.imp-corpo').textContent));
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM scaglioni WHERE zona_id IS NULL'), n0, 'niente è stato salvato');
    assert.deepEqual(await sql(p, 'SELECT da_cent, percentuale FROM scaglioni WHERE zona_id IS NULL ORDER BY da_cent'), [{ da_cent: 0, percentuale: 30 }, { da_cent: 1000000, percentuale: 35 }, { da_cent: 2000000, percentuale: 40 }]);
  });

  test('scaglioni: salvando, tutte le provvigioni vengono ricalcolate (anche quelle passate)', async () => {
    const p = app.pagina;
    await apri('scaglioni');
    await p.getByLabel('Percentuale dello scaglione 1').fill('25');
    await p.click('#salva-scaglioni');
    await attendiNotifica(p, /Scaglioni predefiniti salvati\. Le provvigioni sono state ricalcolate/);
    assert.equal(await valoreSql(p, 'SELECT percentuale FROM scaglioni WHERE zona_id IS NULL AND da_cent = 0'), 25);
    // 25% sotto i 10.000 €: maturate 28.236 → 25.700 (calcolo a mano nel commento del test)
    await vai(p, '#/');
    const r = await riquadri(p);
    assert.equal(r.maturate, 25700 * E);
    // la scheda della 001: 5.600 × 25% = 1.400 € (prima 1.680 €)
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}`);
    const righe = await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((x) => [...x.children].map((c) => c.innerText.replace(/ /g, ' ').trim())));
    assert.equal(righe[0][3], '1° · 25%');
    assert.equal(righe[0][4], '1.400,00 €');
    // ripristino
    await apri('scaglioni');
    await p.getByLabel('Percentuale dello scaglione 1').fill('30');
    await p.click('#salva-scaglioni');
    await attendiNotifica(p, /Scaglioni predefiniti salvati/);
    await vai(p, '#/');
    assert.equal((await riquadri(p)).maturate, 28236 * E);
  });

  test('scaglioni: aggiungere ed eliminare una riga', async () => {
    const p = app.pagina;
    await apri('scaglioni');
    await p.click('#aggiungi-scaglione');
    assert.equal(await p.locator('#tabella-editor-scaglioni tbody tr').count(), 4);
    assert.equal(await p.getByLabel('Soglia dello scaglione 4').inputValue(), '30.000,00');
    assert.equal(await p.getByLabel('Percentuale dello scaglione 4').inputValue(), '45');
    const nuova = (await p.locator('ul.esempio-calcolo li').allInnerTexts()).map((x) => x.replace(/ /g, ' '));
    assert.ok(nuova.some((x) => /4° scaglione: da 30\.000,00 € in su → 45%/.test(x)));
    await p.getByRole('button', { name: 'Elimina lo scaglione 4' }).click();
    assert.equal(await p.locator('#tabella-editor-scaglioni tbody tr').count(), 3);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM scaglioni WHERE zona_id IS NULL'), 3, 'senza salvare, il database non cambia');
  });

  test('scaglioni propri di una zona: attivazione, modifica, effetto sui calcoli e ritorno ai predefiniti', async () => {
    const p = app.pagina;
    await apri('scaglioni');
    await p.getByLabel('Tabella da modificare').selectOption({ label: 'Zona Collina — usa i predefiniti' });
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo .nota').innerText()), /La zona “Collina” usa gli scaglioni predefiniti/);
    // il clic salva e poi porta all'indirizzo della tabella della zona: si aspetta la schermata nuova, non l'editor vecchio ancora a video
    await conNavigazione(p, () => p.getByRole('button', { name: 'Usa scaglioni propri' }).click());
    await attendiNotifica(p, /Scaglioni propri attivati per la zona “Collina”/);
    await p.waitForFunction(() => /tabella=\d+/.test(location.hash));
    await p.waitForSelector('#tabella-editor-scaglioni');
    assert.equal(await p.getByLabel('Percentuale dello scaglione 1').inputValue(), '30', 'parte da una copia dei predefiniti');
    await p.getByLabel('Percentuale dello scaglione 1').fill('50');
    await p.click('#salva-scaglioni');
    await attendiNotifica(p, /Scaglioni della zona “Collina” salvati/);
    assert.equal(await valoreSql(p, "SELECT usa_scaglioni_propri FROM zone WHERE nome = 'Collina'"), 1);
    // Collina: 004 (7.200 €) e 009 (3.520 €), entrambe di Luca e sotto soglia → 50%: 3.600 + 1.760 = 5.360 €
    await vai(p, '#/statistiche');
    await scegliZona(p, 'Collina');
    assert.equal((await totaliStatistiche(p)).provvigioni, 5360 * E);
    await scegliZona(p, null);
    assert.equal((await totaliStatistiche(p)).provvigioni, (28236 - 3216 + 5360) * E);
    // ritorno ai predefiniti con conferma
    await apri('scaglioni');
    await p.getByLabel('Tabella da modificare').selectOption({ label: 'Zona Collina — scaglioni propri' });
    await p.getByRole('button', { name: 'Torna ai predefiniti' }).click();
    assert.match(rimuoviSpazi(await finestra(p).innerText()), /Tornare agli scaglioni predefiniti\?/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, "SELECT usa_scaglioni_propri FROM zone WHERE nome = 'Collina'"), 1);
    await p.getByRole('button', { name: 'Torna ai predefiniti' }).click();
    await bottoneFinestra(p, 'Usa i predefiniti').click();
    await attendiNotifica(p, /La zona usa di nuovo gli scaglioni predefiniti/);
    assert.equal(await valoreSql(p, "SELECT usa_scaglioni_propri FROM zone WHERE nome = 'Collina'"), 0);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM scaglioni WHERE zona_id IS NOT NULL"), 0);
    await vai(p, '#/');
    assert.equal((await riquadri(p)).maturate, 28236 * E);
  });

  test('metodo di calcolo: progressivo, maturazione all\'incasso, base del cumulo — ogni scelta ricalcola e si può annullare', async () => {
    const p = app.pagina;
    await apri('calcolo');
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo').innerText()), /Esempio con i tuoi scaglioni: cumulo mensile di 13\.000,00 €/);
    assert.equal(await p.locator('input[name="metodo"]:checked').getAttribute('value'), 'raggiunto');
    assert.equal(await p.locator('input[name="base"]:checked').getAttribute('value'), 'collaboratore_zona');
    assert.equal(await p.locator('input[name="maturazione"]:checked').getAttribute('value'), 'conclusione');
    // progressivo: ogni percentuale solo sulla sua fascia → il cumulo di Luca (14.000) a ottobre vale 3.000 + 1.400 = 4.400 € (non 4.900)
    await p.locator('input[name="metodo"][value="progressivo"]').check();
    await attendiNotifica(p, /Impostazione salvata: tutte le provvigioni sono state ricalcolate/);
    assert.equal(await valoreSql(p, "SELECT valore FROM impostazioni WHERE chiave = 'calcolo.metodo'"), '"progressivo"');
    await vai(p, `#/pratiche/${await idPratica(p, '2026/011')}`);
    let righe = await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((x) => [...x.children].map((c) => c.innerText.replace(/ /g, ' ').trim())));
    assert.equal(righe[0][4], '2.600,00 €', '4.400 € del mese − 1.800 € già attribuiti alla 010');
    await p.locator('#come-calcolato summary').click();
    assert.match(rimuoviSpazi(await p.locator('#come-calcolato').innerText()), /Metodo progressivo: ogni percentuale vale solo sulla parte di cumulo del suo scaglione; a questa pratica spettano 2\.600,00 €/);
    await vai(p, '#/cumulo?mese=2026-10');
    assert.match(rimuoviSpazi(await p.locator('#contenuto .nota').first().innerText()), /Metodo: progressivo/);
    assert.match(rimuoviSpazi(await p.locator('.zona-card[aria-label="Zona Centro"]').innerText()), /Percentuale media 31,43%/); // 4.400 / 14.000
    // maturazione in proporzione agli incassi: la 010 è incassata per metà → matura metà
    await apri('calcolo');
    await p.locator('input[name="metodo"][value="raggiunto"]').check();
    await p.locator('input[name="maturazione"][value="incasso"]').check();
    await attendiNotifica(p, /Impostazione salvata/);
    await vai(p, `#/pratiche/${await idPratica(p, '2026/010')}`);
    await p.locator('#come-calcolato summary').click();
    assert.match(rimuoviSpazi(await p.locator('#come-calcolato').innerText()), /Maturata all'incasso: in proporzione a quanto il cliente ha pagato \(50%\) → 1\.050,00 €/);
    await vai(p, '#/');
    const r = await riquadri(p);
    assert.ok(r.maturate < 28236 * E, 'a parità di scaglioni, matura meno finché i clienti non pagano');
    // base del cumulo: per zona (somma dei collaboratori)
    await apri('calcolo');
    await p.locator('input[name="maturazione"][value="conclusione"]').check();
    await p.locator('input[name="base"][value="zona"]').check();
    await attendiNotifica(p, /Impostazione salvata/);
    await vai(p, '#/cumulo?mese=2026-10');
    assert.match(rimuoviSpazi(await p.locator('#contenuto .nota').first().innerText()), /per zona \(somma dei collaboratori\)/);
    await apri('calcolo');
    await p.locator('input[name="base"][value="collaboratore_zona"]').check();
    await attendiNotifica(p, /Impostazione salvata/);
    await vai(p, '#/');
    assert.equal((await riquadri(p)).maturate, 28236 * E, 'tornati alle scelte iniziali, i numeri tornano quelli di prima');
  });

  test('ripartizione predefinita: si salva solo se fa 100% e vale per le zone che non ne hanno una propria', async () => {
    const p = app.pagina;
    await apri('ripartizione');
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo').innerText()), /Nessuna ripartizione predefinita: le zone senza una ripartizione propria restano senza assegnazione/);
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    assert.equal(await p.getByLabel('Collaboratore 1').locator('option:checked').innerText(), 'Luca');
    assert.equal(await p.getByLabel('Quota 1').inputValue(), '100');
    await p.getByLabel('Quota 1').fill('60');
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    assert.equal(await p.getByLabel('Quota 2').inputValue(), '40');
    await p.getByLabel('Quota 2').fill('30');
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo').innerText()), /Totale quote: 90%/);
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Le quote sommano 90%: devono fare 100%/);
    await p.getByLabel('Quota 2').fill('40');
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Ripartizione predefinita salvata/);
    // una zona senza ripartizione propria usa la predefinita 60/40; una che ce l'ha (Centro: tutto a Luca) tiene la sua
    await apri('zone');
    await p.getByLabel('Nome della zona').fill('Darsena');
    await p.click('#aggiungi-zona');
    await attendiNotifica(p, /Zona “Darsena” aggiunta/);
    await vai(p, '#/nuova');
    await p.locator('#form-pratica').getByLabel(/^Zona\*?$/).selectOption({ label: 'Darsena' });
    const righeRip = async () => (await p.locator('#ripartizione-automatica .ripartizione-elenco li').allInnerTexts()).map(rimuoviSpazi);
    assert.deepEqual(await righeRip(), ['Luca 60%', 'Giuseppe 40%']);
    assert.match(rimuoviSpazi(await p.locator('#ripartizione-automatica').innerText()), /La zona “Darsena” non ha una divisione sua: si usa quella predefinita/);
    await p.locator('#form-pratica').getByLabel(/^Zona\*?$/).selectOption({ label: 'Centro' });
    assert.deepEqual(await righeRip(), ['Luca 100%']);
    await p.evaluate(() => { location.hash = '#/impostazioni?sezione=zone'; });
    await p.waitForFunction(() => document.querySelector('dialog.modale[open]') || document.querySelector('.imp-corpo .card'));
    if (await finestra(p).count()) await bottoneFinestra(p, 'Esci senza salvare').click(); // il modulo ha una zona scelta: chiede se uscire
    await p.waitForSelector('.imp-corpo .card');
    await riga('Darsena').getByRole('button', { name: 'Elimina' }).click();
    await bottoneFinestra(p, 'Elimina').click();
    await attendiNotifica(p, /Zona eliminata/);
    // si toglie
    await apri('ripartizione');
    await p.getByRole('button', { name: 'Nessuna ripartizione predefinita' }).click();
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Ripartizione predefinita salvata/);
    assert.equal(await valoreSql(p, "SELECT valore FROM impostazioni WHERE chiave = 'ripartizione.predefinita'"), '[]');
  });

  test('aliquote IVA: aggiunta, doppioni e valori assurdi rifiutati, aliquota proposta, rimozione', async () => {
    const p = app.pagina;
    await apri('iva');
    assert.deepEqual((await p.locator('.chip-col').allInnerTexts()).map((x) => x.trim()), ['22%', '10%', '4%', '0%']);
    await p.getByLabel('Nuova aliquota').fill('22');
    await p.click('#aggiungi-iva');
    await p.waitForFunction(() => /già nell'elenco/.test(document.querySelector('.imp-corpo').textContent));
    await p.getByLabel('Nuova aliquota').fill('150');
    await p.click('#aggiungi-iva');
    await p.waitForFunction(() => /tra 0 e 100/.test(document.querySelector('.imp-corpo').textContent));
    await p.getByLabel('Nuova aliquota').fill('5');
    await p.click('#aggiungi-iva');
    await attendiNotifica(p, /Aliquota 5% aggiunta/);
    assert.deepEqual((await p.locator('.chip-col').allInnerTexts()).map((x) => x.trim()), ['22%', '10%', '5%', '4%', '0%']);
    await p.getByLabel('Aliquota proposta per le nuove pratiche').selectOption('10');
    await attendiNotifica(p, /Aliquota predefinita salvata/);
    await vai(p, '#/nuova');
    await p.click('#altre-info summary'); // l'aliquota sta tra le informazioni facoltative
    assert.equal(await p.locator('#form-pratica').getByLabel('Aliquota IVA').inputValue(), '10');
    assert.ok((await p.locator('#form-pratica').getByLabel('Aliquota IVA').locator('option').allInnerTexts()).some((x) => x.trim() === '5%'));
    await apri('iva');
    await p.getByLabel('Aliquota proposta per le nuove pratiche').selectOption('22');
    await p.getByRole('button', { name: 'Rimuovi l\'aliquota 5%' }).click();
    await attendiNotifica(p, /Aliquota 5% rimossa dall'elenco/);
    assert.deepEqual((await p.locator('.chip-col').allInnerTexts()).map((x) => x.trim()), ['22%', '10%', '4%', '0%']);
  });

  test('preferenze: tema, soglie degli avvisi e backup automatico', async () => {
    const p = app.pagina;
    await apri('preferenze');
    await p.getByRole('button', { name: 'Scuro', exact: true }).click();
    await attendiNotifica(p, /Tema: scuro/);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.getByRole('button', { name: 'Chiaro', exact: true }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
    await p.getByRole('button', { name: 'Automatico', exact: true }).click();
    // validazione dei numeri
    await p.getByLabel(/Avvisami se l'ultimo backup/).fill('0');
    await p.click('#salva-preferenze');
    await p.waitForFunction(() => /scrivi un numero intero tra 1 e 365/.test(document.querySelector('.imp-corpo').textContent));
    await p.getByLabel(/Avvisami se l'ultimo backup/).fill('3');
    await p.getByLabel(/Segnala lo scaglione vicino/).fill('30');
    await p.getByLabel(/Copie automatiche da conservare/).fill('5');
    await p.getByLabel('Nome dell\'agenzia (facoltativo)').fill('Agenzia di prova');
    await p.getByLabel(/Crea una copia di sicurezza automatica/).uncheck();
    await p.click('#salva-preferenze');
    await attendiNotifica(p, /Preferenze salvate/);
    const imp = Object.fromEntries((await sql(p, "SELECT chiave, valore FROM impostazioni WHERE chiave LIKE 'avvisi.%' OR chiave LIKE 'backup.%' OR chiave = 'agenzia.nome'")).map((r) => [r.chiave, JSON.parse(r.valore)]));
    assert.equal(imp['avvisi.giorniBackup'], 3);
    assert.equal(imp['avvisi.sogliaScaglionePct'], 30);
    assert.equal(imp['backup.massimoAutomatici'], 5);
    assert.equal(imp['backup.automatico'], false);
    assert.equal(imp['agenzia.nome'], 'Agenzia di prova');
    // la soglia dello scaglione vicino cambia gli avvisi: Centro/Luca (mancano 6.000 su 20.000 = 30%) ora è "vicino"
    await vai(p, '#/');
    await p.waitForSelector('#avvisi .avviso');
    assert.match(rimuoviSpazi(await p.locator('#avvisi').innerText()), /Scaglione vicino: Luca · Centro/);
    // ripristino dei valori iniziali
    await apri('preferenze');
    await p.getByLabel(/Avvisami se l'ultimo backup/).fill('7');
    await p.getByLabel(/Segnala lo scaglione vicino/).fill('20');
    await p.getByLabel(/Copie automatiche da conservare/).fill('14');
    await p.getByLabel(/Crea una copia di sicurezza automatica/).check();
    await p.click('#salva-preferenze');
    await attendiNotifica(p, /Preferenze salvate/);
  });

  test('informazioni: versione, modalità, dove sono i dati, offline, scorciatoie', async () => {
    const p = app.pagina;
    await apri('info');
    await p.waitForFunction(() => /Gestione Immobiliare \d/.test(document.querySelector('.imp-corpo').textContent));
    const t = rimuoviSpazi(await p.locator('.imp-corpo').innerText());
    assert.match(t, /Programma Gestione Immobiliare 1\.0\.0/);
    assert.match(t, /Modalità Browser \(dati nella memoria del browser\)/);
    assert.match(t, /Dove sono i dati IndexedDB del browser/);
    assert.match(t, /Versione dell'archivio Schema 3/);
    assert.match(t, /Connessione a Internet Non necessaria: tutto funziona offline/);
    assert.match(t, /scorciatoie da tastiera/i);
  });

  test('con il tasto Invio: collaboratore, zona e aliquota si aggiungono, la lista si aggiorna e il cursore resta nel campo', async () => {
    const p = app.pagina;
    // collaboratore
    await apri('collaboratori');
    await p.getByLabel(/^Nome del collaboratore/).fill('Sara Invio');
    await p.keyboard.press('Enter');
    await attendiNotifica(p, /Collaboratore “Sara Invio” aggiunto/);
    await p.waitForFunction(() => [...document.querySelectorAll('.riga-elenco')].some((r) => r.dataset.nome === 'Sara Invio'));
    assert.equal(await p.locator('#nuovo-collaboratore').inputValue(), '', 'il campo si svuota');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'nuovo-collaboratore', 'il cursore resta nel campo, per aggiungerne un altro');
    // zona
    await apri('zone');
    await p.getByLabel(/^Nome della zona/).fill('Zona Invio');
    await p.keyboard.press('Enter');
    await attendiNotifica(p, /Zona “Zona Invio” aggiunta/);
    await p.waitForFunction(() => [...document.querySelectorAll('.riga-elenco')].some((r) => r.dataset.nome === 'Zona Invio'));
    assert.equal(await p.locator('#nuovo-zona').inputValue(), '');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'nuovo-zona');
    // aliquota IVA
    await apri('iva');
    await p.getByLabel('Nuova aliquota').fill('7');
    await p.keyboard.press('Enter');
    await attendiNotifica(p, /Aliquota 7% aggiunta/);
    await p.waitForFunction(() => [...document.querySelectorAll('.chip-col')].some((c) => c.textContent.trim() === '7%'));
    assert.equal(await p.locator('#nuova-iva').inputValue(), '');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'nuova-iva');
    // un nome già usato, sempre con Invio: l'errore compare nel campo e la lista non cambia
    await apri('zone');
    await p.getByLabel(/^Nome della zona/).fill('Zona Invio');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('.imp-corpo .ha-errore, .imp-corpo .errore:not(:empty)'));
    assert.equal(await p.locator('.riga-elenco', { hasText: 'Zona Invio' }).count(), 1);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
