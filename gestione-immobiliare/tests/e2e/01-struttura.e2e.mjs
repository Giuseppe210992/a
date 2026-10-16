// Struttura: barra laterale fissa, voci di menu, riduzione con tooltip, intestazione, ricerca, tema.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, testoSospetto, rimuoviSpazi } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const VOCI = [
  ['dashboard', 'Dashboard', 'Dashboard'],
  ['nuova', 'Nuova pratica', 'Nuova pratica'],
  ['pratiche', 'Archivio pratiche', 'Archivio pratiche'],
  ['provvigioni', 'Provvigioni e liquidazioni', 'Provvigioni e liquidazioni'],
  ['cumulo', 'Cumulo mensile per zona', 'Cumulo mensile per zona'],
  ['statistiche', 'Statistiche e grafici', 'Statistiche e grafici'],
  ['backup', 'Backup e archivio storico', 'Backup e archivio storico'],
  ['impostazioni', 'Impostazioni', 'Impostazioni'],
];

describe('Struttura e navigazione', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });

  test('la barra laterale ha le 8 voci richieste, nell\'ordine, ciascuna con un\'icona', async () => {
    const p = app.pagina;
    const voci = await p.$$eval('.sidebar .nav-voce', (a) => a.map((x) => ({ nome: x.getAttribute('aria-label'), icona: !!x.querySelector('svg.icona'), testo: x.querySelector('.nav-testo').textContent })));
    assert.deepEqual(voci.map((v) => v.nome), VOCI.map((v) => v[1]));
    assert.ok(voci.every((v) => v.icona), 'ogni voce deve avere un\'icona');
    assert.deepEqual(voci.map((v) => v.testo), VOCI.map((v) => v[1]));
  });

  test('ogni voce apre la sua schermata e viene evidenziata', async () => {
    const p = app.pagina;
    for (const [id, nome, titolo] of VOCI) {
      await p.click(`.sidebar .nav-voce[data-id="${id}"]`);
      await p.waitForSelector(`#contenuto h1:has-text("${titolo}")`);
      const attiva = await p.$$eval('.sidebar .nav-voce[aria-current="page"]', (a) => a.map((x) => x.getAttribute('aria-label')));
      assert.deepEqual(attiva, [nome], `voce attiva dopo il clic su ${nome}`);
      assert.equal(await p.locator('#contenuto h1').count(), 1, `un solo titolo principale in ${nome}`);
    }
  });

  test('la barra e\' sempre visibile anche scorrendo la pagina (fissa)', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.evaluate(() => window.scrollTo(0, 1500));
    const r = await p.evaluate(() => { const b = document.querySelector('.sidebar').getBoundingClientRect(); return { top: b.top, h: b.height, vh: innerHeight }; });
    assert.ok(Math.abs(r.top) < 1, `la barra deve restare in alto (top=${r.top})`);
    assert.ok(r.h >= r.vh - 1, 'la barra occupa tutta l\'altezza');
    await p.evaluate(() => window.scrollTo(0, 0));
  });

  test('si riduce lasciando le icone, mostra il nome al passaggio del mouse e ricorda la scelta', async () => {
    const p = app.pagina;
    const larghezzaPiena = await p.$eval('.sidebar', (e) => e.getBoundingClientRect().width);
    await p.click('.sb-riduci');
    assert.equal(await p.evaluate(() => document.body.dataset.sidebar), 'ridotta');
    await p.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width < 120); // attende la transizione
    const larghezzaRidotta = await p.$eval('.sidebar', (e) => e.getBoundingClientRect().width);
    assert.ok(larghezzaRidotta < larghezzaPiena / 2, `ridotta ${larghezzaRidotta} < piena ${larghezzaPiena}`);
    // le icone restano visibili
    assert.equal(await p.locator('.sidebar .nav-voce svg.icona:visible').count(), 8);
    // il testo scompare ma il nome compare al passaggio del mouse
    assert.equal(await p.locator('.sidebar .nav-testo:visible').count(), 0);
    await p.hover('.nav-voce[data-id="cumulo"]');
    await p.waitForSelector('.tooltip-nav:not([hidden])');
    assert.equal(rimuoviSpazi(await p.textContent('.tooltip-nav')), 'Cumulo mensile per zona');
    await p.mouse.move(700, 500);
    await p.waitForSelector('.tooltip-nav', { state: 'hidden' });
    // il contenuto guadagna spazio
    await p.waitForFunction(() => document.querySelector('.principale').getBoundingClientRect().width > 1300);
    const contenuto = await p.$eval('.principale', (e) => e.getBoundingClientRect().width);
    assert.ok(contenuto > 1440 - 100, `il contenuto usa quasi tutta la larghezza (${contenuto})`);
    // dopo un ricaricamento la scelta resta
    await p.reload();
    await p.waitForFunction(() => window.__gi && window.__gi.app.archivio);
    assert.equal(await p.evaluate(() => document.body.dataset.sidebar), 'ridotta');
    await p.click('.sb-riduci');
    assert.equal(await p.evaluate(() => document.body.dataset.sidebar), 'estesa');
    await p.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width > 250);
    assert.equal(await p.locator('.sidebar .nav-testo:visible').count(), 8);
  });

  test('l\'intestazione mostra nome, data corrente, periodo, ricerca e il pulsante + Nuova pratica', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const tb = p.locator('.topbar');
    assert.equal(rimuoviSpazi(await tb.locator('.tb-titolo strong').textContent()), 'Gestione Immobiliare');
    const data = rimuoviSpazi(await tb.locator('.tb-data').textContent());
    assert.match(data, /^[A-ZÀ-Ù][a-zà-ù]+ \d{1,2} [a-zà-ù]+ \d{4}$/, `data in italiano: ${data}`);
    assert.match(data, /ottobre 2026$/);
    assert.match(rimuoviSpazi(await tb.locator('.tb-periodo').textContent()), /Anno 2026/);
    assert.ok(await tb.locator('input[type="search"]').isVisible());
    const btn = tb.locator('#btn-nuova-pratica');
    assert.ok(await btn.isVisible());
    assert.match(rimuoviSpazi(await btn.textContent()), /Nuova pratica/);
    await btn.click();
    await p.waitForSelector('#contenuto h1:has-text("Nuova pratica")');
    assert.equal(await p.evaluate(() => location.hash), '#/nuova');
  });

  test('il periodo nell\'intestazione e nella barra dei filtri resta sincronizzato', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.click('.tb-periodo');
    await p.waitForSelector('.sel-periodo');
    await p.click('.sel-periodo button:has-text("Mese scorso")');
    await p.waitForFunction(() => document.querySelector('.tb-periodo').textContent.includes('settembre 2026'));
    assert.match(rimuoviSpazi(await p.textContent('.periodo-btn')), /settembre 2026/);
    await p.keyboard.press('Escape');
    await p.click('.striscia-filtri .btn-ghost:has-text("Azzera filtri")');
    await p.waitForFunction(() => document.querySelector('.tb-periodo').textContent.includes('Anno 2026'));
  });

  test('la ricerca rapida trova per codice, via, cliente e zona; Invio apre la pratica', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const cerca = p.locator('#ricerca-rapida');
    const attendi = (n, testo) => p.waitForFunction(([n, t]) => document.querySelectorAll('.ris-voce').length === n && (!t || document.querySelector('.ris-voce').textContent.includes(t)), [n, testo]);
    await cerca.fill('Garibaldi');
    await attendi(1, '2026/003');
    assert.match(rimuoviSpazi(await p.textContent('.ris-voce')), /2026\/003 — Via Garibaldi 8/);
    await cerca.fill('Acquirente 11');
    await p.waitForFunction(() => document.querySelectorAll('.ris-voce').length === 1 && document.querySelector('.ris-voce').textContent.includes('2026/011'));
    await cerca.fill('lungomare');
    await p.waitForFunction(() => document.querySelectorAll('.ris-voce').length >= 4 && document.querySelector('.ris-piede'));
    await cerca.fill('niente-di-simile-xyz');
    await p.waitForSelector('.risultati-ricerca:has-text("Nessun risultato")');
    assert.equal(await p.locator('.ris-voce').count(), 0);
    await cerca.fill('2026/004');
    await attendi(1, '2026/004');
    await cerca.press('Enter');
    await p.waitForSelector('#contenuto h1:has-text("Via dei Pini 5")');
    assert.equal(await p.evaluate(() => location.hash.startsWith('#/pratiche/')), true);
    assert.equal(await cerca.inputValue(), '', 'la barra si svuota dopo aver aperto un risultato');
  });

  test('scorciatoie: "/" porta alla ricerca, Esc la chiude', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.locator('#contenuto h1').click(); // zona neutra: nessun collegamento
    await p.keyboard.press('/');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'ricerca-rapida');
    assert.equal(await p.inputValue('#ricerca-rapida'), '', 'la barra "/" non deve finire nel campo');
    await p.keyboard.type('Garibaldi');
    await p.waitForFunction(() => document.querySelectorAll('.ris-voce').length === 1);
    await p.keyboard.press('Escape');
    await p.waitForSelector('.risultati-ricerca', { state: 'hidden' });
    // anche se Esc arriva subito dopo l'ultima lettera, l'elenco non deve riaprirsi da solo
    await p.keyboard.press('/');
    await p.keyboard.type('Lungomare');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    assert.equal(await p.locator('.risultati-ricerca').isVisible(), false);
    await p.keyboard.press('Escape'); // seconda pressione: esce dal campo
    assert.notEqual(await p.evaluate(() => document.activeElement.id), 'ricerca-rapida');
  });

  test('tema chiaro/scuro: si cambia con un clic e viene ricordato', async () => {
    const p = app.pagina;
    const sfondo = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const chiaro = await sfondo();
    await p.click('.tb-azioni button[aria-label^="Passa al tema"]');
    const scuro = await sfondo();
    assert.notEqual(chiaro, scuro);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.reload();
    await p.waitForFunction(() => window.__gi && window.__gi.app.archivio);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.click('.tb-azioni button[aria-label^="Passa al tema"]');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
  });

  test('nessun errore in console e nessun testo "null" nelle pagine', async () => {
    const p = app.pagina;
    for (const hash of ['#/', '#/nuova', '#/pratiche', '#/provvigioni', '#/cumulo', '#/statistiche', '#/backup', '#/impostazioni']) {
      await vai(p, hash);
      const corpo = await p.locator('#contenuto').innerText();
      assert.ok(!/\bnull\b|\bundefined\b|\bNaN\b/.test(corpo), `testo sospetto in ${hash}: ${corpo.match(/.{0,30}(null|undefined|NaN).{0,30}/)?.[0]}`);
    }
    assert.deepEqual(await testoSospetto(p), [], 'nessun nodo null aggiunto al DOM');
    assert.deepEqual(app.errori, [], 'errori in console');
  });
});
