// Provvigioni e liquidazioni, Cumulo mensile per zona, Statistiche e grafici: numeri verificati con un calcolo fatto a mano.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto, scarica, leggiCsv,
  scegliCollaboratore, scegliZona, azzeraFiltri, scegliPeriodo, centesimi,
} from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const celle = (p, selettore) => p.locator(selettore).evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())));

describe('Provvigioni e liquidazioni', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await azzeraFiltri(p);
    await vai(p, '#/provvigioni');
  });

  test('riepilogo: totali e una scheda per collaboratore, con maturato, liquidato e da liquidare', async () => {
    const p = app.pagina;
    const kpi = await p.locator('.kpi').evaluateAll((a) => a.map((x) => x.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
    assert.match(kpi[0], /Fatturato attribuito 87\.920 €/);
    assert.match(kpi[1], /Provvigioni maturate 28\.236 €/);
    assert.match(kpi[2], /Già liquidate 6\.565 €/);
    assert.match(kpi[3], /Ancora da liquidare 21\.671 €/);
    const schede = await p.locator('.carta-collab').evaluateAll((a) => a.map((x) => x.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
    assert.equal(schede.length, 2);
    assert.match(schede[0], /^Luca 8 pratiche nel periodo Fatturato attribuito 42\.340,00 € Provvigioni maturate 13\.402,00 € Già liquidate 3\.045,00 € Ancora da liquidare 10\.357,00 €/);
    assert.match(schede[1], /^Giuseppe 7 pratiche nel periodo Fatturato attribuito 45\.580,00 € Provvigioni maturate 14\.834,00 € Già liquidate 3\.520,00 € Ancora da liquidare 11\.314,00 €/);
    // barra di avanzamento delle liquidazioni
    assert.equal(await p.locator('.carta-collab .meter[role="img"]').first().getAttribute('aria-label'), 'Liquidato il 23%');
  });

  test('i filtri della barra superiore valgono anche qui', async () => {
    const p = app.pagina;
    await scegliCollaboratore(p, 'Giuseppe');
    assert.equal(await p.locator('.carta-collab').count(), 1);
    assert.match(rimuoviSpazi(await p.locator('.carta-collab').innerText()), /Giuseppe/);
    await scegliCollaboratore(p, null);
    await scegliZona(p, 'Collina');
    const kpi = await p.locator('.kpi').first().innerText();
    assert.match(rimuoviSpazi(kpi), /10\.720 €/);
    await azzeraFiltri(p);
    await scegliPeriodo(p, 'Mese scorso');
    assert.match(rimuoviSpazi(await p.locator('.kpi').nth(1).innerText()), /1\.296 €/);
  });

  test('dettaglio per pratica: una riga per pratica e collaboratore, con scaglione e stato del pagamento', async () => {
    const p = app.pagina;
    await p.getByRole('tab', { name: 'Dettaglio per pratica' }).click();
    await p.waitForSelector('#tabella-dettaglio');
    assert.match(await p.evaluate(() => location.hash), /tab=dettaglio/);
    const righe = await celle(p, '#tabella-dettaglio tbody tr');
    assert.equal(righe.length, 15);
    const per = (codice, nome) => righe.find((r) => r[0].startsWith(codice) && r[1] === nome);
    assert.deepEqual(per('2026/001', 'Luca').slice(2), ['100%', '5.600,00 €', '1° · 30%', '1.680,00 €', '1.680,00 €', '0,00 €', 'Liquidata']);
    assert.deepEqual(per('2026/003', 'Luca').slice(2), ['50%', '1.900,00 €', '1° · 30%', '570,00 €', '285,00 €', '285,00 €', 'Parziale']);
    assert.deepEqual(per('2026/005', 'Giuseppe').slice(2), ['100%', '10.400,00 €', '2° · 35%', '3.640,00 €', '1.000,00 €', '2.640,00 €', 'Parziale']);
    assert.deepEqual(per('2026/011', 'Luca').slice(2), ['100%', '8.000,00 €', '2° · 35%', '2.800,00 €', '0,00 €', '2.800,00 €', 'Da liquidare']);
    // il totale in fondo
    const piede = (await celle(p, '#tabella-dettaglio tfoot tr'))[0];
    assert.match(piede[0], /^Totale \(15 righe\)/);
    assert.equal(piede[1], '87.920,00 €');
    assert.equal(piede[3], '28.236,00 €');
    assert.equal(piede[4], '6.565,00 €');
    assert.equal(piede[5], '21.671,00 €');
    // solo quelle da liquidare
    await p.locator('#solo-dal').check();
    await p.waitForFunction(() => document.querySelectorAll('#tabella-dettaglio tbody tr').length === 13);
    assert.match(await p.evaluate(() => location.hash), /solo=da-liquidare/);
    assert.equal(centesimi((await celle(p, '#tabella-dettaglio tfoot tr'))[0][5]), 21671 * E);
    // il clic sulla riga apre la scheda
    await p.locator('#tabella-dettaglio tbody tr').first().locator('td').nth(2).click();
    await p.waitForSelector('#contenuto h1');
    assert.match(await p.evaluate(() => location.hash), /^#\/pratiche\/\d+$/);
  });

  test('dettaglio: esporta in CSV le righe mostrate', async () => {
    const p = app.pagina;
    await p.getByRole('tab', { name: 'Dettaglio per pratica' }).click();
    await p.locator('#solo-dal').check();
    const file = await scarica(p, () => p.getByRole('button', { name: 'Esporta in CSV' }).click());
    assert.match(file.nome, /^Provvigioni_/);
    const csv = leggiCsv(file.bytes);
    assert.equal(csv.righe.length, 13);
    const col = csv.intestazioni.indexOf('Da liquidare');
    assert.equal(csv.righe.reduce((s, r) => s + centesimi(r[col]), 0), 21671 * E);
  });

  test('liquidazioni: elenco, dettaglio per pratica, modifica, eliminazione con conferma', async () => {
    const p = app.pagina;
    await p.getByRole('tab', { name: /Liquidazioni/ }).click();
    await p.waitForSelector('#tabella-liquidazioni');
    assert.match(rimuoviSpazi(await p.locator('#pannello-prov').innerText()), /3 liquidazioni · 6\.565,00 € nel periodo/);
    assert.equal(rimuoviSpazi(await p.locator('#tab-liquidazioni .conteggio').innerText()), '3');
    const righe = await celle(p, '#tabella-liquidazioni tbody tr');
    assert.deepEqual(righe.map((r) => [r[0], r[1], r[3]]), [
      ['10/05/2026', 'Luca', '1.365,00 €'], ['10/03/2026', 'Giuseppe', '3.520,00 €'], ['05/02/2026', 'Luca', '1.680,00 €'],
    ]);
    // l'elenco delle pratiche della liquidazione di Giuseppe
    const riga = p.locator('#tabella-liquidazioni tbody tr', { hasText: 'Giuseppe' });
    await riga.locator('summary').click();
    const dettagli = rimuoviSpazi(await riga.locator('details').innerText());
    assert.match(dettagli, /2 pratiche/);
    assert.match(dettagli, /2026\/002 — 2\.520,00 €/);
    assert.match(dettagli, /2026\/005 — 1\.000,00 €/);
    // modifica di data, metodo e note
    await p.getByRole('button', { name: 'Modifica la liquidazione del 05/02/2026' }).click();
    const f = finestra(p);
    assert.match(rimuoviSpazi(await f.innerText()), /Modifica la liquidazione a Luca/);
    await f.getByLabel('Data del pagamento').fill('06/02/2026');
    await f.getByLabel('Metodo').selectOption({ label: 'Contanti' });
    await f.getByLabel('Note').fill('Corretta');
    await bottoneFinestra(p, 'Salva').click();
    await attendiNotifica(p, /Liquidazione aggiornata/);
    assert.deepEqual(await sql(p, "SELECT data, metodo, note FROM liquidazioni WHERE data = '2026-02-06'"), [{ data: '2026-02-06', metodo: 'Contanti', note: 'Corretta' }]);
    assert.equal(await valoreSql(p, "SELECT SUM(importo_cent) FROM liquidazioni_righe"), 656500, 'gli importi non cambiano');
    // l'eliminazione chiede conferma e riporta le pratiche "da liquidare"
    await p.getByRole('button', { name: 'Elimina la liquidazione del 06/02/2026' }).click();
    const t = rimuoviSpazi(await f.innerText());
    assert.match(t, /Eliminare questa liquidazione\?/);
    assert.match(t, /1\.680,00 € a Luca/);
    assert.match(t, /1 pratica tornerà “da liquidare”/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni'), 3);
    await p.getByRole('button', { name: 'Elimina la liquidazione del 06/02/2026' }).click();
    await bottoneFinestra(p, 'Elimina liquidazione').click();
    await attendiNotifica(p, /Liquidazione eliminata/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni'), 2);
    await p.waitForFunction(() => /2 liquidazioni · 4\.885,00/.test(document.querySelector('#pannello-prov').innerText.replace(/ /g, ' ')));
    // la dashboard segue: da liquidare 21.671 + 1.680
    await vai(p, '#/');
    await p.waitForFunction(() => /Liquidate 4\.885\s€ su 28\.236\s€/.test(document.body.innerText));
  });

  test('liquidazioni: "Registra liquidazione" dall\'elenco, anche per un anticipo su una pratica in corso', async () => {
    const p = app.pagina;
    await p.getByRole('tab', { name: /Liquidazioni/ }).click();
    await p.locator('#btn-nuova-liq').click();
    const f = finestra(p);
    await f.getByLabel('Collaboratore').selectOption(String(await valoreSql(p, "SELECT id FROM collaboratori WHERE nome = 'Luca'")));
    // la 013 è in corso: compare tra gli anticipi
    assert.match(rimuoviSpazi(await f.innerText()), /Anticipi su pratiche ancora in corso/);
    const riga013 = f.locator('tbody tr', { hasText: '2026/013' });
    assert.match(rimuoviSpazi(await riga013.innerText()), /In corso/);
    await f.locator('button:has-text("Nessuna")').click();
    await riga013.locator('input.input').fill('500');
    assert.equal(await riga013.locator('input[type=checkbox]').isChecked(), true, 'scrivendo un importo la riga si seleziona');
    await bottoneFinestra(p, 'Registra liquidazione').click();
    await attendiNotifica(p, /Liquidazione di 500,00 € registrata per Luca/);
    // l'anticipo compare nel dettaglio come "Anticipo" e il residuo è negativo
    await p.getByRole('tab', { name: 'Dettaglio per pratica' }).click();
    await p.waitForSelector('#tabella-dettaglio');
    const r = (await celle(p, '#tabella-dettaglio tbody tr')).find((x) => x[0].startsWith('2026/013'));
    assert.equal(r[8], 'Anticipo');
    assert.equal(r[6], '500,00 €');
    assert.equal(r[7], '−500,00 €');
    // pulizia
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const l = app.archivio.tutti("SELECT id FROM liquidazioni WHERE data = '2026-10-16'");
      for (const x of l) await api.eliminaLiquidazione(app.archivio, x.id);
    });
  });

  test('incassi: elenco, totale, eliminazione con conferma, registrazione dall\'elenco', async () => {
    const p = app.pagina;
    await p.getByRole('tab', { name: /Incassi/ }).click();
    await p.waitForSelector('#tabella-incassi');
    assert.match(rimuoviSpazi(await p.locator('#pannello-prov').innerText()), /4 incassi · 25\.376,00 € nel periodo \(IVA inclusa\)/);
    const righe = await celle(p, '#tabella-incassi tbody tr');
    assert.deepEqual(righe.map((r) => [r[0], r[1].split(' ')[0], r[2]]), [
      ['05/10/2026', '2026/010', '3.660,00 €'], ['12/03/2026', '2026/003', '4.636,00 €'], ['25/02/2026', '2026/002', '10.248,00 €'], ['20/01/2026', '2026/001', '6.832,00 €'],
    ]);
    // registra un incasso da qui
    await p.locator('#btn-nuovo-incasso').click();
    const f = finestra(p);
    await f.getByLabel('Pratica').selectOption(String(await idPratica(p, '2026/012')));
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('1.000');
    await bottoneFinestra(p, 'Registra incasso').click();
    await attendiNotifica(p, /Incasso di 1\.000,00 € registrato sulla pratica 2026\/012/);
    await p.waitForFunction(() => /5 incassi · 26\.376,00/.test(document.querySelector('#pannello-prov').innerText.replace(/ /g, ' ')));
    // eliminazione
    await p.getByRole('button', { name: 'Elimina l\'incasso del 16/10/2026' }).click();
    assert.match(rimuoviSpazi(await f.innerText()), /Eliminare questo incasso\?/);
    assert.match(rimuoviSpazi(await f.innerText()), /1\.000,00 € del 16\/10\/2026 sulla pratica 2026\/012/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 5);
    await p.getByRole('button', { name: 'Elimina l\'incasso del 16/10/2026' }).click();
    await bottoneFinestra(p, 'Elimina incasso').click();
    await attendiNotifica(p, /Incasso eliminato/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 4);
  });

  test('i pulsanti in alto aprono le finestre di incasso e liquidazione; "Vedi il dettaglio" cambia scheda', async () => {
    const p = app.pagina;
    await p.click('#btn-incasso-prov');
    assert.match(rimuoviSpazi(await finestra(p).innerText()), /Registra un incasso/);
    await bottoneFinestra(p, 'Annulla').click();
    await p.click('#btn-liquidazione-prov');
    assert.match(rimuoviSpazi(await finestra(p).innerText()), /Registra una liquidazione/);
    await bottoneFinestra(p, 'Annulla').click();
    await p.locator('.carta-collab').first().getByRole('button', { name: 'Vedi il dettaglio' }).click();
    await p.waitForSelector('#tabella-dettaglio');
    await vai(p, '#/provvigioni');
    await p.locator('.carta-collab').first().getByRole('button', { name: 'Registra liquidazione' }).click();
    assert.match(await finestra(p).getByLabel('Collaboratore').locator('option:checked').innerText(), /^Luca/, 'la liquidazione parte dal collaboratore della scheda');
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});

describe('Cumulo mensile per zona', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => { await azzeraFiltri(app.pagina); await vai(app.pagina, '#/cumulo?mese=2026-10'); });

  /** Le righe del cumulo: { zona, chi, scaglione, fatturato, percentuale, provvigione, prossimo, testo } */
  const leggi = (p) => p.locator('.zona-card').evaluateAll((cards) => cards.map((c) => ({
    zona: c.querySelector('h2').textContent.trim(),
    righe: [...c.querySelectorAll('.cumulo-riga')].map((r) => {
      const n = {};
      r.querySelectorAll('.cumulo-numeri .n').forEach((x) => { n[x.querySelector('span').textContent.trim()] = x.querySelector('b').textContent.replace(/ /g, ' ').trim(); });
      return {
        chi: r.querySelector('.cumulo-chi').textContent.replace(/nessun fatturato nel mese/, '').trim(),
        vuota: r.classList.contains('cumulo-vuota'),
        badge: r.querySelector('.badge')?.textContent.trim() ?? null,
        numeri: n,
        testo: r.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
      };
    }),
  })));

  test('ottobre 2026: fatturato cumulato, scaglione e percentuale raggiunti per ogni collaboratore e zona', async () => {
    const p = app.pagina;
    assert.equal(rimuoviSpazi(await p.locator('#cumulo-mese').innerText()), 'Ottobre 2026');
    assert.match(rimuoviSpazi(await p.locator('#contenuto .nota').first().innerText()), /per collaboratore e zona/);
    assert.match(rimuoviSpazi(await p.locator('#contenuto .nota').first().innerText()), /Metodo: scaglione raggiunto/);
    const zone = await leggi(p);
    assert.deepEqual(zone.map((z) => z.zona).sort(), ['Centro', 'Collina', 'Lungomare']);
    const centro = zone.find((z) => z.zona === 'Centro');
    const luca = centro.righe.find((r) => r.chi === 'Luca');
    assert.equal(luca.badge, '2° scaglione · 35%');
    assert.deepEqual([luca.numeri['Fatturato cumulato'], luca.numeri['Percentuale raggiunta'], luca.numeri['Provvigione sul mese'], luca.numeri['Prossimo scaglione']],
      ['14.000,00 €', '35%', '4.900,00 €', '6.000,00 €']);
    assert.match(luca.testo, /Mancano 6\.000,00 € per passare al 3° scaglione \(40%\), che parte da 20\.000,00 €/);
    assert.match(luca.testo, /Pratiche che compongono il cumulo \(2\)/);
    assert.ok(centro.righe.find((r) => r.chi === 'Giuseppe').vuota, 'Giuseppe non ha fatturato nel Centro a ottobre');
    const lungomare = zone.find((z) => z.zona === 'Lungomare');
    const giu = lungomare.righe.find((r) => r.chi === 'Giuseppe');
    assert.equal(giu.badge, '1° scaglione · 30%');
    assert.deepEqual([giu.numeri['Fatturato cumulato'], giu.numeri['Provvigione sul mese'], giu.numeri['Prossimo scaglione']], ['9.200,00 €', '2.760,00 €', '800,00 €']);
    assert.match(giu.testo, /Mancano 800,00 € per passare al 2° scaglione \(35%\)/);
    const collina = zone.find((z) => z.zona === 'Collina');
    assert.ok(collina.righe.every((r) => r.vuota));
    // il riepilogo di ogni zona
    assert.match(rimuoviSpazi(await p.locator('.zona-card[aria-label="Zona Centro"] .card-testa').innerText()), /fatturato 14\.000,00 € · provvigioni 4\.900,00 €/);
  });

  test('si scorre tra i mesi e si può scegliere mese e anno; "Mese corrente" riporta a oggi', async () => {
    const p = app.pagina;
    await p.click('#mese-prec');
    await p.waitForFunction(() => document.querySelector('#cumulo-mese').textContent === 'Settembre 2026');
    let zone = await leggi(p);
    const collina = zone.find((z) => z.zona === 'Collina').righe.find((r) => r.chi === 'Luca');
    assert.deepEqual([collina.numeri['Fatturato cumulato'], collina.badge, collina.numeri['Provvigione sul mese']], ['3.520,00 €', '1° scaglione · 30%', '1.056,00 €']);
    const lung = zone.find((z) => z.zona === 'Lungomare').righe.find((r) => r.chi === 'Giuseppe');
    assert.deepEqual([lung.numeri['Fatturato cumulato'], lung.numeri['Provvigione sul mese']], ['800,00 €', '240,00 €'], 'la 015 senza rogito conta nel mese di apertura');
    assert.match(await p.evaluate(() => location.hash), /mese=2026-09/);
    await p.selectOption('select[aria-label="Mese"]', '05');
    await p.waitForFunction(() => document.querySelector('#cumulo-mese').textContent === 'Maggio 2026');
    zone = await leggi(p);
    const mag = zone.find((z) => z.zona === 'Lungomare').righe.find((r) => r.chi === 'Giuseppe');
    assert.deepEqual([mag.numeri['Fatturato cumulato'], mag.badge, mag.numeri['Percentuale raggiunta'], mag.numeri['Provvigione sul mese']], ['10.400,00 €', '2° scaglione · 35%', '35%', '3.640,00 €'], 'soglia superata di poco: 35% su tutto il cumulo');
    await p.selectOption('select[aria-label="Anno"]', '2025');
    await p.waitForFunction(() => document.querySelector('#cumulo-mese').textContent === 'Maggio 2025');
    zone = await leggi(p);
    assert.ok(zone.every((z) => z.righe.every((r) => r.vuota)), 'nessun dato nel 2025');
    await p.getByRole('button', { name: 'Mese corrente' }).click();
    await p.waitForFunction(() => document.querySelector('#cumulo-mese').textContent === 'Ottobre 2026');
    assert.equal(await p.getByRole('button', { name: 'Mese corrente' }).isDisabled(), true);
    await p.click('#mese-succ');
    await p.waitForFunction(() => document.querySelector('#cumulo-mese').textContent === 'Novembre 2026');
    await p.click('#mese-succ');
    await p.click('#mese-succ');
    await p.waitForFunction(() => document.querySelector('#cumulo-mese').textContent === 'Gennaio 2027');
    assert.equal(await p.locator('select[aria-label="Anno"]').inputValue(), '2027');
    // la scelta viene ricordata quando si torna sulla pagina
    await vai(p, '#/');
    await vai(p, '#/cumulo');
    assert.equal(rimuoviSpazi(await p.locator('#cumulo-mese').innerText()), 'Gennaio 2027');
    await p.getByRole('button', { name: 'Mese corrente' }).click();
  });

  test('i filtri di zona e collaboratore restringono il cumulo', async () => {
    const p = app.pagina;
    await scegliCollaboratore(p, 'Giuseppe');
    let zone = await leggi(p);
    assert.ok(zone.every((z) => z.righe.every((r) => r.chi === 'Giuseppe')));
    await scegliZona(p, 'Lungomare');
    zone = await leggi(p);
    assert.deepEqual(zone.map((z) => z.zona), ['Lungomare']);
    assert.equal(zone[0].righe.length, 1);
    assert.equal(zone[0].righe[0].numeri['Fatturato cumulato'], '9.200,00 €');
  });

  test('la tabella dell\'anno riporta il cumulo di ogni mese con scaglione e percentuale', async () => {
    const p = app.pagina;
    const intest = await p.$$eval('#matrice-cumulo thead th', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(intest.slice(1), ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']);
    const righe = await celle(p, '#matrice-cumulo tbody tr');
    const lucaCentro = righe.find((r) => /Centro · Luca/.test(r[0]));
    // gen 5.600 (30%), mar 1.900, giu 3.120, lug 7.000, ott 14.000 (35%): in forma compatta
    assert.match(lucaCentro[1], /^5,6 k 1° · 30%$/);
    assert.match(lucaCentro[10], /^14 k 2° · 35%$/);
    assert.equal(lucaCentro[2], '—');
    assert.equal(lucaCentro[11], '—');
    const giuLung = righe.find((r) => /Lungomare · Giuseppe/.test(r[0]));
    assert.match(giuLung[5], /^10,4 k 2° · 35%$/);
    assert.match(giuLung[8], /^12,8 k 2° · 35%$/);
    // il titolo di ogni cella spiega il dato per esteso
    const titolo = await p.locator('#matrice-cumulo tbody tr', { hasText: 'Lungomare · Giuseppe' }).locator('td').nth(4).getAttribute('title');
    assert.match(titolo.replace(/ /g, ' '), /maggio 2026: 10\.400,00 € · 2° scaglione, 35%/);
  });

  test('senza scaglioni il cumulo lo segnala e rimanda alle impostazioni', async () => {
    const c = await avvia();
    try {
      await c.pagina.evaluate(async () => {
        const { api, app } = window.__gi;
        await api.salvaTabellaScaglioni(app.archivio, null, []); // il programma parte con gli scaglioni dell'agenzia: qui si prova il caso «senza»
        await api.creaZona(app.archivio, { nome: 'Unica' });
      });
      await vai(c.pagina, '#/cumulo');
      const t = rimuoviSpazi(await c.pagina.locator('#contenuto').innerText());
      assert.match(t, /Scaglioni non impostati/);
    } finally { await c.chiudi(); }
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});

describe('Statistiche e grafici', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => { await azzeraFiltri(app.pagina); await vai(app.pagina, '#/statistiche'); });

  test('indicatori del periodo calcolati a mano', async () => {
    const p = app.pagina;
    const kpi = await p.locator('.kpi').evaluateAll((a) => a.map((x) => x.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
    assert.match(kpi[0], /^Tempo medio di chiusura 40 giorni/);
    assert.match(kpi[1], /^Prezzo medio di vendita 181\.500 €/);
    assert.match(kpi[2], /^Compenso medio per pratica 6\.763 €/);
    assert.match(kpi[3], /^Compenso sul prezzo di vendita 4%/);
    assert.match(kpi[4], /^Margine di agenzia 59\.684 € 67,9% dei compensi, prima dei costi/);
  });

  test('sette grafici con valori e tabella equivalente', async () => {
    const p = app.pagina;
    const titoli = await p.$$eval('.grafico-card h3', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(titoli, ['Compensi e incassi', 'Compravendite concluse', 'Valore degli immobili venduti', 'Provvigioni e margine di agenzia', 'Compensi per zona', 'Compensi per collaboratore', 'Pratiche per tipo di immobile']);
    for (const id of ['compensi-incassi', 'concluse', 'valore', 'margine', 'per-zona', 'per-collaboratore', 'per-tipo']) {
      const g = p.locator(`#grafico-${id}`);
      assert.equal(await g.locator('svg.g-svg').count(), 1, id);
      await g.locator('button:has-text("Tabella")').click();
      assert.ok(await g.locator('.grafico-tab tbody tr').count() >= 1, `tabella di ${id}`);
      await g.locator('button:has-text("Grafico")').click();
    }
    // compensi per zona e per collaboratore
    const zona = p.locator('#grafico-per-zona');
    await zona.locator('button:has-text("Tabella")').click();
    const rz = await celle(p, '#grafico-per-zona .grafico-tab tbody tr');
    assert.deepEqual(Object.fromEntries(rz.map((r) => [r[0].split(' ·')[0].toLowerCase(), centesimi(r[1])])), { lungomare: 41600 * E, centro: 35600 * E, collina: 10720 * E });
    const coll = p.locator('#grafico-per-collaboratore');
    await coll.locator('button:has-text("Tabella")').click();
    const rc = await celle(p, '#grafico-per-collaboratore .grafico-tab tbody tr');
    assert.deepEqual(Object.fromEntries(rc.map((r) => [r[0].split(' ·')[0].toLowerCase(), centesimi(r[1])])), { luca: 42340 * E, giuseppe: 45580 * E });
    const tipo = p.locator('#grafico-per-tipo');
    await tipo.locator('button:has-text("Tabella")').click();
    const rt = await celle(p, '#grafico-per-tipo .grafico-tab tbody tr');
    assert.deepEqual(Object.fromEntries(rt.map((r) => [r[0].split(' ·')[0].toLowerCase(), Number(r[1])])), { appartamento: 12, 'box / garage': 1 });
  });

  test('compensi e incassi: due serie con totali separati e nota sul confronto', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-compensi-incassi');
    assert.equal(await g.locator('.g-legenda-voce').count(), 2);
    assert.match(rimuoviSpazi(await g.locator('.grafico-cifre').innerText()), /Compensi 87\.920,00 € Incassi nel periodo 25\.376,00 €/);
    assert.match(rimuoviSpazi(await g.locator('.grafico-nota').innerText()), /Le due serie non sono confrontabili riga per riga/);
    // il grafico a linee ha un'unica area sensibile: il mese si sceglie con la posizione (marzo = 3° di 12)
    await g.scrollIntoViewIfNeeded();
    const area = await g.locator('.g-hit').boundingBox();
    await p.mouse.move(area.x + 10 + (area.width - 20) * (2 / 11), area.y + area.height / 2);
    await g.locator('.g-tooltip').waitFor({ state: 'visible' });
    await p.waitForFunction(() => document.querySelector('#grafico-compensi-incassi .g-tt-testa').textContent.includes('marzo 2026'));
    const tt = rimuoviSpazi(await g.locator('.g-tooltip').innerText());
    assert.match(tt, /marzo 2026/);
    assert.match(tt, /Compensi \(imponibile\) 3\.800,00 €/);
    assert.match(tt, /Incassi \(IVA inclusa\) 4\.636,00 €/);
    await p.mouse.move(5, 5);
  });

  test('riepilogo numerico mese per mese con totali e CSV', async () => {
    const p = app.pagina;
    const righe = await celle(p, '#tabella-statistiche tbody tr');
    assert.equal(righe.length, 12);
    const ott = righe.find((r) => r[0].toLowerCase() === 'ottobre 2026');
    assert.deepEqual(ott.slice(1), ['3', '23.200,00 €', '3.660,00 €', '7.660,00 €', '15.540,00 €', '580.000,00 €']);
    const gen = righe.find((r) => r[0].toLowerCase() === 'gennaio 2026');
    assert.deepEqual(gen.slice(1), ['1', '5.600,00 €', '6.832,00 €', '1.680,00 €', '3.920,00 €', '140.000,00 €']);
    const tot = (await celle(p, '#tabella-statistiche tfoot tr'))[0];
    assert.deepEqual(tot, ['Totale', '13', '87.920,00 €', '25.376,00 €', '28.236,00 €', '59.684,00 €', '2.178.000,00 €']);
    const file = await scarica(p, () => p.locator('#esporta-statistiche').click());
    assert.match(file.nome, /^Statistiche_/);
    const csv = leggiCsv(file.bytes);
    assert.deepEqual(csv.intestazioni, ['Periodo', 'Concluse', 'Compensi', 'Incassi', 'Provvigioni', 'Margine', 'Valore venduto']);
    assert.equal(csv.righe.length, 12);
    assert.deepEqual(csv.righe.find((r) => r[0] === 'ottobre 2026'), ['ottobre 2026', '3', '23200,00', '3660,00', '7660,00', '15540,00', '580000,00']);
  });

  test('vista annuale e filtri cambiano numeri e titoli', async () => {
    const p = app.pagina;
    await p.click('.striscia-filtri .segmenti button:has-text("Annuale")');
    await p.waitForFunction(() => document.querySelector('#contenuto .pagina-testa p').textContent.includes('annuali'));
    const righe = await celle(p, '#tabella-statistiche tbody tr');
    assert.deepEqual(righe.map((r) => r[0].toLowerCase()), ['anno 2026']);
    assert.equal(righe[0][1], '13');
    await p.click('.striscia-filtri .segmenti button:has-text("Mensile")');
    await scegliCollaboratore(p, 'Luca');
    const kpi = await p.locator('.kpi').evaluateAll((a) => a.map((x) => x.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
    assert.match(kpi[4], /^Margine di agenzia 28\.938 €/); // 42.340 − 13.402
    const tot = (await celle(p, '#tabella-statistiche tfoot tr'))[0];
    assert.equal(tot[1], '8');
    assert.equal(tot[2], '42.340,00 €');
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
