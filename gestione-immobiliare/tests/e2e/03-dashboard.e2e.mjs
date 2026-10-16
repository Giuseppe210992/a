// Dashboard con dati: riquadri (verificati con un calcolo fatto a mano), filtri, grafici, ultime pratiche, avvisi, aggiornamento automatico.
//
// Il calcolo atteso e' indipendente dal programma: parte dalle 15 pratiche di dati-prova.mjs, dagli scaglioni
// 0 € → 30%, 10.000 € → 35%, 20.000 € → 40% (percentuale dello scaglione raggiunto su tutto il cumulo del mese,
// per collaboratore e zona) e dalle liquidazioni inserite. I valori sono in euro.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, riquadri, scegliPeriodo, scegliZona, scegliCollaboratore, azzeraFiltri, centesimi, rimuoviSpazi, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const ATTESO_ANNO = { concluse: 13, compensi: 87920 * E, maturate: 28236 * E, daLiquidare: 21671 * E, valore: 2178000 * E, inCorso: 2 };

describe('Dashboard: riquadri, filtri e grafici', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); await vai(app.pagina, '#/'); });
  after(async () => { await app.chiudi(); });

  test('i sei riquadri mostrano i valori calcolati a mano (anno 2026)', async () => {
    const p = app.pagina;
    assert.deepEqual(await riquadri(p), ATTESO_ANNO);
    // le note dei riquadri danno il contesto: incassato, liquidato su maturato, prezzo medio, per rogito
    const nota = async (etichetta) => rimuoviSpazi(await p.locator('.kpi', { has: p.locator('.kpi-etichetta', { hasText: new RegExp(`^${etichetta}$`) }) }).locator('.kpi-nota').innerText());
    assert.match(await nota('Provvigioni ancora da liquidare'), /Liquidate 6\.565 € su 28\.236 € maturate/);
    assert.match(await nota('Valore complessivo immobili venduti'), /Prezzo medio 167\.538 €/);
    assert.match(await nota('Compravendite concluse'), /Per data di rogito/);
    assert.match(await nota('Pratiche in corso'), /qualunque sia il periodo/);
    // senza dati nel 2025 il confronto dice onestamente che manca
    const delta = rimuoviSpazi(await p.locator('.kpi', { has: p.locator('.kpi-etichetta', { hasText: /^Compravendite concluse$/ }) }).locator('.kpi-delta').innerText());
    assert.match(delta, /Nessun confronto/);
    assert.match(delta, /anno 2025 senza dati/);
  });

  test('ogni riquadro apre la schermata collegata', async () => {
    const p = app.pagina;
    const prova = async (etichetta, controlla) => {
      await vai(p, '#/');
      await p.locator('a.kpi', { has: p.locator('.kpi-etichetta', { hasText: new RegExp(`^${etichetta}$`) }) }).click();
      await p.waitForSelector('#contenuto h1');
      await controlla();
    };
    await prova('Compravendite concluse', async () => {
      assert.match(await p.locator('#contenuto h1').innerText(), /Archivio pratiche/);
      assert.match(await p.evaluate(() => location.hash), /stato=conclusa/);
      await p.waitForFunction(() => /13 pratiche/.test(document.querySelector('#contenuto').innerText));
    });
    await prova('Totale compensi registrati', async () => assert.match(await p.locator('#contenuto h1').innerText(), /Statistiche e grafici/));
    await prova('Provvigioni maturate', async () => assert.match(await p.locator('#contenuto h1').innerText(), /Provvigioni e liquidazioni/));
    await prova('Provvigioni ancora da liquidare', async () => {
      assert.match(await p.locator('#contenuto h1').innerText(), /Provvigioni e liquidazioni/);
      assert.match(await p.evaluate(() => location.hash), /solo=da-liquidare/);
    });
    await prova('Valore complessivo immobili venduti', async () => assert.match(await p.locator('#contenuto h1').innerText(), /Archivio pratiche/));
    await prova('Pratiche in corso', async () => {
      assert.match(await p.evaluate(() => location.hash), /stato=in_corso/);
      await p.waitForFunction(() => /2 pratiche/.test(document.querySelector('#contenuto').innerText));
    });
    await vai(p, '#/');
  });

  test('filtro periodo: mese scorso, mese corrente, intervallo personalizzato, tutto', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    // settembre 2026: pratiche 009 e 015 (quest'ultima senza data di rogito: vale la data di apertura)
    await scegliPeriodo(p, 'Mese scorso');
    assert.deepEqual(await riquadri(p), { concluse: 2, compensi: 4320 * E, maturate: 1296 * E, daLiquidare: 1296 * E, valore: 88000 * E, inCorso: 2 });
    assert.match(rimuoviSpazi(await p.textContent('.tb-periodo')), /settembre 2026/);
    // ottobre 2026: pratiche 010, 011, 012
    await scegliPeriodo(p, 'Mese corrente');
    assert.deepEqual(await riquadri(p), { concluse: 3, compensi: 23200 * E, maturate: 7660 * E, daLiquidare: 7660 * E, valore: 580000 * E, inCorso: 2 });
    // intervallo 01/03/2026 – 30/06/2026: pratiche 003, 004, 005, 006
    await p.click('.periodo-btn');
    await p.click('.sel-periodo [role="tab"]:has-text("Intervallo")');
    const campi = p.locator('.sel-periodo .campo-data input.input');
    await campi.nth(0).fill('01/03/2026');
    await campi.nth(1).fill('30/06/2026');
    await p.waitForFunction(() => document.querySelector('.tb-periodo').textContent.includes('01/03/2026'));
    await p.keyboard.press('Escape');
    assert.deepEqual(await riquadri(p), { concluse: 4, compensi: 26600 * E, maturate: 8500 * E, daLiquidare: 6135 * E, valore: 665000 * E, inCorso: 2 });
    // tutto il periodo = stesso risultato dell'anno (tutti i dati sono del 2026)
    await p.click('.periodo-btn');
    await p.click('.sel-periodo [role="tab"]:has-text("Tutto")');
    await p.keyboard.press('Escape');
    assert.deepEqual(await riquadri(p), ATTESO_ANNO);
    await azzeraFiltri(p);
  });

  test('un intervallo non valido o al contrario viene spiegato e non cambia i dati', async () => {
    const p = app.pagina;
    await azzeraFiltri(p);
    await p.click('.periodo-btn');
    await p.click('.sel-periodo [role="tab"]:has-text("Intervallo")');
    const campi = p.locator('.sel-periodo .campo-data input.input');
    await p.waitForTimeout(60);
    const etichetta = async () => rimuoviSpazi(await p.textContent('.tb-periodo'));
    const iniziale = await etichetta(); // 01/10/2026 – 16/10/2026 (proposto: dall'inizio del mese a oggi)
    assert.match(iniziale, /01\/10\/2026 – 16\/10\/2026/);
    await campi.nth(0).fill('31/02/2026'); // data inesistente
    await campi.nth(0).blur();
    assert.match(rimuoviSpazi(await p.locator('.sel-periodo .errore').first().innerText()), /Data non valida/);
    assert.equal(await etichetta(), iniziale, 'il periodo non cambia con una data inesistente');
    // una data iniziale valida si applica subito
    await campi.nth(0).fill('10/10/2026');
    await p.waitForFunction(() => document.querySelector('.tb-periodo').textContent.includes('10/10/2026 – 16/10/2026'));
    const intermedia = await etichetta();
    // date nell'ordine sbagliato: messaggio e nessun cambiamento
    await campi.nth(1).fill('01/10/2026');
    await campi.nth(1).blur();
    assert.match(rimuoviSpazi(await p.locator('.sel-periodo .errore').nth(1).innerText()), /precedente/);
    assert.equal(await etichetta(), intermedia, 'il periodo non cambia con date al contrario');
    // correzione: il messaggio sparisce e il periodo si applica
    await campi.nth(1).fill('31/10/2026');
    await p.waitForFunction(() => document.querySelector('.tb-periodo').textContent.includes('10/10/2026'));
    await p.waitForFunction(() => !document.querySelector('.sel-periodo .ha-errore'));
    // dal 10 al 31 ottobre resta solo la 012 (rogito 12/10); la 010 è del 2/10 e la 011 del 9/10
    const r = await riquadri(p);
    assert.deepEqual([r.concluse, r.compensi], [1, 9200 * E]);
    await p.keyboard.press('Escape');
    assert.deepEqual(app.errori, []);
    await azzeraFiltri(p);
  });

  test('filtro per zona', async () => {
    const p = app.pagina;
    await azzeraFiltri(p);
    await scegliZona(p, 'Lungomare');
    assert.deepEqual(await riquadri(p), { concluse: 5, compensi: 41600 * E, maturate: 13640 * E, daLiquidare: 10120 * E, valore: 1020000 * E, inCorso: 0 });
    await scegliZona(p, 'Collina');
    assert.deepEqual(await riquadri(p), { concluse: 2, compensi: 10720 * E, maturate: 3216 * E, daLiquidare: 2136 * E, valore: 268000 * E, inCorso: 0 });
    await scegliZona(p, 'Centro');
    assert.deepEqual(await riquadri(p), { concluse: 6, compensi: 35600 * E, maturate: 11380 * E, daLiquidare: 9415 * E, valore: 890000 * E, inCorso: 1 });
    assert.match(rimuoviSpazi(await p.locator('#contenuto .pagina-testa p').innerText()), /zona Centro/);
  });

  test('filtro per collaboratore (conta le sue quote) e filtri combinati', async () => {
    const p = app.pagina;
    await azzeraFiltri(p);
    await scegliCollaboratore(p, 'Luca');
    assert.deepEqual(await riquadri(p), { concluse: 8, compensi: 42340 * E, maturate: 13402 * E, daLiquidare: 10357 * E, valore: 1158000 * E, inCorso: 1 });
    await scegliCollaboratore(p, 'Giuseppe');
    assert.deepEqual(await riquadri(p), { concluse: 7, compensi: 45580 * E, maturate: 14834 * E, daLiquidare: 11314 * E, valore: 1245000 * E, inCorso: 0 });
    // Luca + zona Centro
    await scegliCollaboratore(p, 'Luca');
    await scegliZona(p, 'Centro');
    assert.deepEqual(await riquadri(p), { concluse: 6, compensi: 31620 * E, maturate: 10186 * E, daLiquidare: 8221 * E, valore: 890000 * E, inCorso: 1 });
    // il pulsante "Azzera filtri" ripristina tutto
    await azzeraFiltri(p);
    assert.deepEqual(await riquadri(p), ATTESO_ANNO);
    assert.equal(await p.locator('.striscia-filtri button:has-text("Azzera filtri")').isVisible(), false);
  });

  test('i filtri restano quando si cambia schermata e valgono anche per le altre pagine', async () => {
    const p = app.pagina;
    await scegliCollaboratore(p, 'Giuseppe');
    await p.click('.sidebar .nav-voce[data-id="statistiche"]');
    await p.waitForSelector('#contenuto h1:has-text("Statistiche e grafici")');
    assert.equal(await p.inputValue('#filtro-collab'), String(await p.evaluate(() => window.__gi.app.filtri.collaboratoreId)));
    assert.match(rimuoviSpazi(await p.textContent('#contenuto')), /Giuseppe/);
    await p.click('.sidebar .nav-voce[data-id="dashboard"]');
    await p.waitForSelector('.kpi');
    assert.equal((await riquadri(p)).compensi, 45580 * E);
    await azzeraFiltri(p);
  });

  test('i sei grafici sono presenti, con valori scritti, legenda e testo alternativo', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const titoli = await p.$$eval('.grafico-card h3', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(titoli, [
      'Andamento dei compensi', 'Compravendite concluse', 'Provvigioni maturate e liquidate',
      'Confronto tra collaboratori', 'Provvigioni per zona e scaglioni raggiunti', 'Prezzo di acquisto e di vendita',
    ]);
    for (const id of ['compensi', 'concluse', 'provvigioni', 'confronto', 'zone', 'prezzi']) {
      const g = p.locator(`#grafico-${id}`);
      assert.equal(await g.locator('svg.g-svg').count(), 1, `grafico ${id}: un solo disegno`);
      assert.ok(await g.locator('.g-barra, .g-punto, .g-linea').count() > 0, `grafico ${id}: ha delle barre/punti`);
      assert.ok(await g.locator('svg.g-svg').getAttribute('aria-label'), `grafico ${id}: ha un testo per i lettori di schermo`);
      assert.equal(await g.locator('.g-vuoto').isVisible(), false, `grafico ${id}: non mostra il messaggio di grafico vuoto`);
    }
    // legenda solo dove ci sono almeno due serie
    assert.equal(await p.locator('#grafico-compensi .g-legenda').count(), 0);
    assert.equal(await p.locator('#grafico-confronto .g-legenda-voce').count(), 2);
    assert.deepEqual(await p.$$eval('#grafico-confronto .g-legenda-voce', (a) => a.map((x) => x.textContent.trim())), ['Luca', 'Giuseppe']);
    assert.equal(await p.locator('#grafico-provvigioni .g-legenda-voce').count(), 2);
    assert.ok(await p.locator('#grafico-zone .g-legenda-voce').count() >= 3, 'zone: una voce per zona');
    // cifre chiave
    const cifre = async (id) => rimuoviSpazi(await p.locator(`#grafico-${id} .grafico-cifre`).innerText());
    assert.match(await cifre('compensi'), /Totale del periodo 87\.920,00 €/);
    assert.match(await cifre('compensi'), /Media mensile 7\.326,67 €/);
    assert.match(await cifre('concluse'), /Nel periodo 13/);
    assert.match(await cifre('concluse'), /Valore medio 167\.538 €/);
    assert.match(await cifre('provvigioni'), /Maturate 28\.236 € Liquidate 6\.565 € Da liquidare 21\.671 €/);
    // 9 pratiche con entrambi i prezzi (mancano 002, 006, 012 e la 015 senza prezzi): media delle variazioni = +16,7%
    assert.match(await cifre('prezzi'), /Variazione media \+16,7%/);
    assert.match(await cifre('prezzi'), /Pratiche confrontate 9 \(ultime 8\)/);
    assert.match(rimuoviSpazi(await p.locator('#grafico-prezzi .grafico-nota').innerText()), /4 pratiche concluse non hanno entrambi i prezzi/);
  });

  test('grafico compensi: tooltip al passaggio del mouse e con la tastiera', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-compensi');
    const colonne = g.locator('.g-hit');
    assert.equal(await colonne.count(), 12);
    await colonne.nth(9).hover(); // ottobre
    const tt = g.locator('.g-tooltip');
    await tt.waitFor({ state: 'visible' });
    assert.match(rimuoviSpazi(await tt.innerText()), /ottobre 2026\s+Compensi 23\.200,00 €/);
    await colonne.nth(0).hover();
    await p.waitForFunction(() => document.querySelector('#grafico-compensi .g-tt-testa').textContent.includes('gennaio 2026'));
    assert.match(rimuoviSpazi(await tt.innerText()), /gennaio 2026\s+Compensi 5\.600,00 €/);
    await p.mouse.move(5, 5);
    await tt.waitFor({ state: 'hidden' });
    // tastiera: focus sul grafico, frecce per scorrere, Esc per chiudere
    await g.locator('svg.g-svg').focus();
    await tt.waitFor({ state: 'visible' });
    await p.keyboard.press('Home');
    assert.match(rimuoviSpazi(await tt.innerText()), /gennaio 2026/);
    for (let i = 0; i < 9; i++) await p.keyboard.press('ArrowRight');
    assert.match(rimuoviSpazi(await tt.innerText()), /ottobre 2026\s+Compensi 23\.200,00 €/);
    await p.keyboard.press('Escape');
    await tt.waitFor({ state: 'hidden' });
  });

  test('ogni grafico ha la vista tabella con gli stessi numeri e si torna al grafico', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-compensi');
    await g.locator('button:has-text("Tabella")').click();
    await g.locator('.grafico-tab table').waitFor({ state: 'visible' });
    assert.equal(await g.locator('svg.g-svg').isVisible(), false);
    const righe = await g.locator('.grafico-tab tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    assert.equal(righe.length, 12);
    const per = Object.fromEntries(righe.map((r) => [r[0], r[1]]));
    assert.equal(per['gennaio 2026'], '5.600,00 €');
    assert.equal(per['agosto 2026'], '12.800,00 €');
    assert.equal(per['settembre 2026'], '4.320,00 €');
    assert.equal(per['ottobre 2026'], '23.200,00 €');
    assert.equal(per['dicembre 2026'], '0,00 €');
    const somma = righe.reduce((s, r) => s + centesimi(r[1]), 0);
    assert.equal(somma, 87920 * E, 'la somma delle righe e\' il totale dei compensi');
    assert.equal(await g.locator('button[aria-pressed="true"]').count(), 1);
    await g.locator('button:has-text("Grafico")').click();
    await g.locator('svg.g-svg').waitFor({ state: 'visible' });
    // tutte le schede: vista tabella disponibile e con dati
    for (const id of ['concluse', 'provvigioni', 'confronto', 'zone', 'prezzi']) {
      const card = p.locator(`#grafico-${id}`);
      await card.locator('button:has-text("Tabella")').click();
      assert.ok(await card.locator('.grafico-tab tbody tr').count() >= 2, `tabella di ${id}`);
      await card.locator('button:has-text("Grafico")').click();
    }
  });

  test('provvigioni per collaboratore: liquidate e da liquidare (tooltip e tabella)', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-provvigioni');
    await g.locator('button:has-text("Tabella")').click();
    const righe = await g.locator('.grafico-tab tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    const luca = righe.find((r) => r[0].startsWith('Luca'));
    const giuseppe = righe.find((r) => r[0].startsWith('Giuseppe'));
    assert.deepEqual([centesimi(luca[1]), centesimi(luca[2])], [3045 * E, 10357 * E]);
    assert.deepEqual([centesimi(giuseppe[1]), centesimi(giuseppe[2])], [3520 * E, 11314 * E]);
    await g.locator('button:has-text("Grafico")').click();
    await g.locator('.g-hit').first().hover();
    const tt = g.locator('.g-tooltip');
    await tt.waitFor({ state: 'visible' });
    const t = rimuoviSpazi(await tt.innerText());
    assert.match(t, /Luca/);
    assert.match(t, /Liquidate 3\.045,00 €/);
    assert.match(t, /Da liquidare 10\.357,00 €/);
    await p.mouse.move(5, 5);
  });

  test('confronto tra collaboratori: misura selezionabile e legenda che nasconde una serie', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-confronto');
    const cifre = async () => rimuoviSpazi(await g.locator('.grafico-cifre').innerText());
    assert.match(await cifre(), /Luca 42\.340 €\s*Giuseppe 45\.580 €/);
    await g.locator('.segmenti button:has-text("Provvigioni")').click();
    await p.waitForFunction(() => document.querySelector('#grafico-confronto .grafico-cifre').textContent.includes('13.402'));
    assert.match(await cifre(), /Luca 13\.402 €\s*Giuseppe 14\.834 €/);
    await g.locator('.segmenti button:has-text("Pratiche")').click();
    await p.waitForFunction(() => /Luca\s*8/.test(document.querySelector('#grafico-confronto .grafico-cifre').textContent));
    assert.match(await cifre(), /Luca 8\s*Giuseppe 7/);
    await g.locator('.segmenti button:has-text("Compensi")').click();
    // la legenda nasconde/mostra una serie (almeno una resta sempre visibile)
    const prima = await g.locator('.g-barra').count();
    const luca = g.locator('.g-legenda-voce', { hasText: 'Luca' });
    await luca.click();
    assert.equal(await g.locator('.g-legenda-voce', { hasText: 'Luca' }).getAttribute('aria-pressed'), 'false');
    const dopo = await g.locator('.g-barra').count();
    assert.ok(dopo < prima, `meno barre senza Luca (${prima} → ${dopo})`);
    await g.locator('.g-legenda-voce', { hasText: 'Giuseppe' }).click(); // l'ultima serie non si puo' spegnere
    assert.equal(await g.locator('.g-legenda-voce', { hasText: 'Giuseppe' }).getAttribute('aria-pressed'), 'true');
    await g.locator('.g-legenda-voce', { hasText: 'Luca' }).click();
    assert.equal(await g.locator('.g-barra').count(), prima);
  });

  test('provvigioni per zona: scaglioni raggiunti nel mese corrente', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-zone');
    const testo = rimuoviSpazi(await g.locator('.grafico-sotto').innerText());
    assert.match(testo, /Scaglioni raggiunti a ottobre 2026/);
    // Luca nel Centro: 14.000 € → 2° scaglione 35%; Giuseppe sul Lungomare: 9.200 € → 1° scaglione 30%
    assert.match(testo, /Centro\s+Luca\s+14\.000 €\s+2° · 35%/);
    assert.match(testo, /Lungomare\s+Giuseppe\s+9\.200 €\s+1° · 30%/);
    await g.locator('button:has-text("Tabella")').click();
    const righe = await g.locator('.grafico-tab tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    const ott = righe.find((r) => r[0].startsWith('ottobre 2026'));
    assert.ok(ott, 'riga di ottobre');
    await g.locator('button:has-text("Grafico")').click();
  });

  test('prezzi di acquisto e vendita: solo le pratiche con entrambi i prezzi', async () => {
    const p = app.pagina;
    const g = p.locator('#grafico-prezzi');
    await g.locator('button:has-text("Tabella")').click();
    const righe = await g.locator('.grafico-tab tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    assert.equal(righe.length, 8);
    const r11 = righe.find((r) => r[0].startsWith('2026/011'));
    assert.deepEqual(r11.slice(1), ['170.000,00 €', '200.000,00 €', '+30.000,00 € (+17,6%)']);
    const r03 = righe.find((r) => r[0].startsWith('2026/003'));
    assert.deepEqual(r03.slice(1), ['100.000,00 €', '95.000,00 €', '−5.000,00 € (−5%)']);
    assert.ok(!righe.some((r) => r[0].startsWith('2026/002')), 'la 002 non ha il prezzo di acquisto');
    assert.ok(!righe.some((r) => r[0].startsWith('2026/001')), 'si mostrano le ultime 8: la 001, la piu\' vecchia, resta fuori');
    await g.locator('button:has-text("Grafico")').click();
  });

  test('vista annuale: i grafici passano da mesi ad anni e i riquadri non cambiano', async () => {
    const p = app.pagina;
    await p.click('.striscia-filtri .segmenti button:has-text("Annuale")');
    await p.waitForFunction(() => document.querySelector('#grafico-compensi .grafico-testa p').textContent.includes('per anno'));
    assert.deepEqual(await riquadri(p), ATTESO_ANNO);
    const g = p.locator('#grafico-compensi');
    await g.locator('button:has-text("Tabella")').click();
    const righe = await g.locator('.grafico-tab tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent.replace(/ /g, ' ').trim())));
    assert.deepEqual(righe.map((r) => r[0].replace(' (fuori periodo)', '')), ['Anno 2024', 'Anno 2025', 'Anno 2026']);
    assert.equal(righe[2][1], '87.920,00 €');
    assert.equal(righe[0][1], '0,00 €');
    await g.locator('button:has-text("Grafico")').click();
    assert.match(rimuoviSpazi(await p.locator('#grafico-compensi .grafico-cifre').innerText()), /Media annua/);
    await p.click('.striscia-filtri .segmenti button:has-text("Mensile")');
    await p.waitForFunction(() => document.querySelector('#grafico-compensi .grafico-testa p').textContent.includes('per mese'));
  });

  test('con il filtro di un solo mese il grafico mostra comunque 12 mesi, quelli fuori periodo attenuati', async () => {
    const p = app.pagina;
    await scegliPeriodo(p, 'Mese corrente');
    const g = p.locator('#grafico-compensi');
    assert.equal(await g.locator('.g-hit').count(), 12);
    assert.ok(await g.locator('.g-colonna.g-dim').count() >= 10, 'i mesi fuori dal periodo sono attenuati');
    assert.match(rimuoviSpazi(await g.locator('.grafico-nota').innerText()), /colonne più chiare sono fuori dal periodo/);
    assert.match(rimuoviSpazi(await g.locator('.grafico-cifre').innerText()), /Totale del periodo 23\.200,00 €/);
    await azzeraFiltri(p);
  });

  test('ultime pratiche: righe, colonne, stato, e il clic apre la scheda', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const intest = await p.$$eval('section[aria-labelledby="ult-titolo"] thead th', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(intest, ['Data', 'Immobile', 'Zona', 'Stato', 'Compensi']);
    const righe = p.locator('section[aria-labelledby="ult-titolo"] tbody tr');
    assert.equal(await righe.count(), 8);
    // ordine: ultime inserite per prime (015, 014, 013, 012, ...)
    const codici = await righe.evaluateAll((tr) => tr.map((r) => r.children[1].querySelector('.sottotesto').textContent.split(' · ')[0]));
    assert.deepEqual(codici, ['2026/015', '2026/014', '2026/013', '2026/012', '2026/011', '2026/010', '2026/009', '2026/008']);
    const testo = rimuoviSpazi(await righe.nth(2).innerText());
    assert.match(testo, /05\/10\/2026/);
    assert.match(testo, /Via Nuova 4/);
    assert.match(testo, /Centro/);
    assert.match(testo, /In corso/);
    assert.match(testo, /6\.200,00 €/);
    assert.match(rimuoviSpazi(await righe.nth(1).innerText()), /Da indicare/); // 014 senza zona
    // clic su una riga (non sul collegamento) → scheda della pratica
    await righe.nth(3).locator('td').last().click();
    await p.waitForSelector('#contenuto h1:has-text("Via Pergolesi 1")');
    assert.match(await p.evaluate(() => location.hash), /^#\/pratiche\/\d+$/);
    await vai(p, '#/');
    await p.locator('section[aria-labelledby="ult-titolo"] a:has-text("Vedi archivio")').click();
    await p.waitForSelector('#contenuto h1:has-text("Archivio pratiche")');
  });

  test('avvisi automatici: dati mancanti, da liquidare, scaglione vicino, backup assente', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.waitForSelector('#avvisi .avviso');
    const avvisi = await p.$$eval('#avvisi li.avviso', (a) => a.map((x) => ({ classe: x.className, testo: x.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() })));
    const trova = (re) => avvisi.find((a) => re.test(a.testo));
    assert.ok(trova(/Nessun backup eseguito/), 'avviso backup');
    assert.ok(trova(/pratich[ae] con dati mancanti/), 'avviso dati mancanti');
    const liq = trova(/Provvigioni da liquidare: 21\.671,00 €/);
    assert.ok(liq, 'avviso da liquidare');
    assert.match(liq.testo, /Luca 10\.357,00 €/);
    assert.match(liq.testo, /Giuseppe 11\.314,00 €/);
    const sca = trova(/Scaglione vicino: Giuseppe · Lungomare/);
    assert.ok(sca, 'avviso scaglione vicino');
    assert.match(sca.testo, /Mancano 800,00 € per lo scaglione 2 \(35%\)/);
    assert.ok(!trova(/integrità/i), 'nessun problema di integrita\'');
    // non invasivi: nessuna finestra, nessun blocco; il titolo mostra quanti sono
    assert.equal(await p.locator('dialog[open]').count(), 0);
    assert.match(await p.locator('#avv-titolo').innerText(), /^Avvisi \(\d+\)$/);
    // ordine: prima da controllare, poi informazioni
    const ordine = avvisi.map((a) => (a.classe.includes('critico') ? 0 : a.classe.includes('avviso ') || a.classe.endsWith('avviso') ? 1 : 2));
    assert.deepEqual(ordine, ordine.slice().sort((a, b) => a - b));
  });

  test('un avviso si può nascondere e ripristinare; "Crea backup ora" fa sparire l\'avviso del backup', async () => {
    const p = app.pagina;
    const quanti = () => p.locator('#avvisi li.avviso').count();
    const attendi = (n) => p.waitForFunction((x) => document.querySelectorAll('#avvisi li.avviso').length === x, n);
    const n0 = await quanti();
    await p.locator('#avvisi li.avviso:has-text("Provvigioni da liquidare") button:has-text("Nascondi")').click();
    await attendi(n0 - 1);
    await p.locator('#avvisi button:has-text("Mostra di nuovo gli avvisi nascosti")').click();
    await attendi(n0);
    const copieDopo = async () => p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).length);
    const c0 = await copieDopo();
    await p.locator('#avvisi li.avviso:has-text("Nessun backup eseguito") button:has-text("Crea backup ora")').click();
    await p.waitForFunction(() => !document.querySelector('#avvisi').textContent.includes('Nessun backup eseguito'));
    assert.equal(await copieDopo(), c0 + 1);
    await attendi(n0 - 1);
  });

  test('i dati cambiati da qualsiasi punto aggiornano subito dashboard e intestazione, senza ricaricare', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const prima = await riquadri(p);
    // nuova pratica conclusa in ottobre 2026, Luca 100%: compensi 3.000 € (imponibile) → cumulo Luca/Centro ottobre 14.000 → 17.000 (35%)
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const [luca] = api.elencoCollaboratori(app.archivio);
      const zona = app.archivio.valore("SELECT id FROM zone WHERE nome = 'Centro'");
      await api.salvaPratica(app.archivio, {
        codice: '2026/016', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-10-14', zona_id: zona,
        immobile_indirizzo: 'Via Aggiunta 1', immobile_comune: 'Minturno', immobile_tipo: 'Appartamento',
        prezzo_vendita_cent: 100000 * 100, compenso_venditore_cent: 1500 * 100, compenso_acquirente_cent: 1500 * 100, aliquota_iva: 22,
      }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
    });
    await p.waitForFunction((n) => document.querySelector('.kpi-valore').textContent.trim() === String(n), prima.concluse + 1);
    const dopo = await riquadri(p);
    assert.equal(dopo.concluse, prima.concluse + 1);
    assert.equal(dopo.compensi, prima.compensi + 3000 * E);
    assert.equal(dopo.valore, prima.valore + 100000 * E);
    // provvigione: cumulo Luca/Centro a ottobre da 14.000 € (35% = 4.900) a 17.000 € (35% = 5.950) → +1.050 €
    assert.equal(dopo.maturate, prima.maturate + 1050 * E);
    assert.equal(dopo.daLiquidare, prima.daLiquidare + 1050 * E);
    // la tabella delle ultime pratiche mostra subito la nuova
    await p.waitForFunction(() => document.querySelector('section[aria-labelledby="ult-titolo"] tbody tr td:nth-child(2)').textContent.includes('Via Aggiunta 1'));
    // e il grafico dei compensi: ottobre ora 26.200
    await p.locator('#grafico-compensi .g-hit').nth(9).hover();
    await p.waitForFunction(() => document.querySelector('#grafico-compensi .g-tooltip').textContent.includes('26.200,00'));
    await p.mouse.move(5, 5);
    // si annulla la modifica: elimina la pratica e torna tutto come prima
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const id = app.archivio.valore("SELECT id FROM pratiche WHERE codice = '2026/016'");
      await api.eliminaPratica(app.archivio, id);
    });
    await p.waitForFunction((n) => document.querySelector('.kpi-valore').textContent.trim() === String(n), prima.concluse);
    assert.deepEqual(await riquadri(p), prima);
  });

  test('nessun errore, nessun "null" scritto nelle pagine', async () => {
    const p = app.pagina;
    assert.deepEqual(await testoSospetto(p), []);
    assert.deepEqual(app.errori, []);
  });
});
