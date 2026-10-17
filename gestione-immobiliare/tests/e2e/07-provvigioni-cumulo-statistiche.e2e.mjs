// Provvigioni, Cumulo mensile per zona, Statistiche e grafici: numeri verificati con un calcolo fatto a mano.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto, scarica, leggiCsv,
  scegliCollaboratore, scegliZona, azzeraFiltri, scegliPeriodo, centesimi,
} from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const celle = (p, selettore) => p.locator(selettore).evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())));

describe('Provvigioni', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await azzeraFiltri(p);
    await vai(p, '#/provvigioni');
  });

  test('riepilogo semplice: un totale per persona e il totale generale, senza liquidazioni', async () => {
    const p = app.pagina;
    const kpi = await p.locator('.kpi').evaluateAll((a) => a.map((x) => x.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
    assert.deepEqual(kpi, ['Luca 13.402,00 €', 'Giuseppe 14.834,00 €', 'Totale 28.236,00 €']);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.doesNotMatch(t, /liquid/i, 'nessun riferimento a liquidazioni');
    assert.equal(await p.getByRole('tab').count(), 0, 'niente schede: una sola tabella');
    assert.equal(await p.locator('button:has-text("Registra liquidazione")').count(), 0);
  });

  test('tabella: una riga per pratica e persona, con quota, compenso, percentuale e provvigione', async () => {
    const p = app.pagina;
    const righe = await celle(p, '#tabella-dettaglio tbody tr');
    assert.equal(righe.length, 15);
    const per = (codice, chi) => righe.find((r) => r[0].startsWith(codice) && r[1] === chi);
    assert.deepEqual(per('2026/011', 'Luca').slice(1), ['Luca', '100%', '8.000,00 €', '2° · 35%', '2.800,00 €']);
    assert.deepEqual(per('2026/003', 'Giuseppe').slice(1), ['Giuseppe', '50%', '1.900,00 €', '1° · 30%', '570,00 €']);
    const somma = righe.reduce((t, r) => t + centesimi(r[5]), 0);
    assert.equal(somma, 28236 * E);
    assert.deepEqual(await celle(p, '#tabella-dettaglio tfoot tr'), [['Totale (15 righe)', '28.236,00 €']]);
    // clic su una riga → scheda della pratica
    await p.locator('#tabella-dettaglio tbody tr').first().locator('td').last().click();
    await p.waitForSelector('#contenuto #btn-modifica');
  });

  test('i filtri della barra superiore valgono anche qui', async () => {
    const p = app.pagina;
    await scegliCollaboratore(p, 'Giuseppe');
    await p.waitForFunction(() => document.querySelectorAll('.kpi').length === 2);
    assert.deepEqual(await p.locator('.kpi').evaluateAll((a) => a.map((x) => x.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())), ['Giuseppe 14.834,00 €', 'Totale 14.834,00 €']);
    await azzeraFiltri(p);
    await scegliPeriodo(p, 'Mese corrente');
    await p.waitForFunction(() => /7\.660,00/.test(document.querySelector('#pannello-prov').innerText.replace(/ /g, ' ')));
    await azzeraFiltri(p);
  });

  test('esporta in CSV le righe mostrate', async () => {
    const p = app.pagina;
    const file = await scarica(p, () => p.getByRole('button', { name: 'Esporta in CSV' }).click());
    assert.match(file.nome, /^Provvigioni.*\.csv$/);
    const csv = leggiCsv(file.bytes);
    assert.equal(csv.righe.length, 15);
    const col = csv.intestazioni.indexOf('Provvigione calcolata');
    assert.ok(col >= 0);
    assert.equal(csv.righe.reduce((t, r) => t + centesimi(r[col] || '0'), 0), 28236 * E);
    await attendiNotifica(p, /Provvigioni esportate in CSV/);
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
    assert.equal(kpi.length, 3, 'tre indicatori');
    assert.match(kpi[0], /^Compenso medio per pratica 6\.763 €/);
    assert.match(kpi[1], /^Prezzo medio di vendita 181\.500 €/);
    assert.match(kpi[2], /^Margine dell'agenzia 59\.684 € 67,9% dei compensi, prima dei costi/);
  });

  test('tre grafici con valori e tabella equivalente', async () => {
    const p = app.pagina;
    const titoli = await p.$$eval('.grafico-card h3', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(titoli, ['Compensi e incassi', 'Compensi per zona', 'Compensi per collaboratore']);
    for (const id of ['compensi-incassi', 'per-zona', 'per-collaboratore']) {
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
  });

  test('compensi e incassi: due serie con totali separati e nota sul confronto', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-compensi-incassi');
    assert.equal(await g.locator('.g-legenda-voce').count(), 2);
    assert.match(rimuoviSpazi(await g.locator('.grafico-cifre').innerText()), /Compensi 87\.920,00 € Incassi nel periodo 25\.376,00 €/);
    assert.match(rimuoviSpazi(await g.locator('.grafico-nota').innerText()), /I compensi sono senza IVA e seguono il giorno della pratica/);
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
    assert.match(kpi[2], /^Margine dell'agenzia 28\.938 €/); // 42.340 − 13.402
    const tot = (await celle(p, '#tabella-statistiche tfoot tr'))[0];
    assert.equal(tot[1], '8');
    assert.equal(tot[2], '42.340,00 €');
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
