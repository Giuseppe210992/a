// Dashboard con dati: quattro riquadri (verificati con un calcolo fatto a mano), periodo, un solo grafico, ultime pratiche, avvisi,
// aggiornamento automatico. I filtri per zona e collaboratore si usano nelle Statistiche (stesse cifre, calcolate a mano).
//
// Il calcolo atteso e' indipendente dal programma: parte dalle 15 pratiche di dati-prova.mjs, dagli scaglioni
// 0 € → 30%, 10.000 € → 35%, 20.000 € → 40% (percentuale dello scaglione raggiunto su tutto il cumulo del mese,
// per collaboratore e zona) e dalle liquidazioni inserite. I valori sono in euro.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, conNavigazione, riquadri, totaliStatistiche, scegliPeriodo, scegliZona, scegliCollaboratore, azzeraFiltri, centesimi, rimuoviSpazi, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const ATTESO_ANNO = { concluse: 13, compensi: 87920 * E, maturate: 28236 * E, daLiquidare: 21671 * E };

describe('Dashboard: riquadri, periodo e grafico', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); await vai(app.pagina, '#/'); });
  after(async () => { await app.chiudi(); });

  test('i quattro riquadri mostrano i valori calcolati a mano (anno 2026)', async () => {
    const p = app.pagina;
    assert.deepEqual(await riquadri(p), ATTESO_ANNO);
    assert.equal(await p.locator('.kpi').count(), 4);
    // le note dei riquadri danno il contesto
    const nota = async (etichetta) => rimuoviSpazi(await p.locator('.kpi', { has: p.locator('.kpi-etichetta', { hasText: new RegExp(`^${etichetta}$`) }) }).locator('.kpi-nota').innerText());
    assert.match(await nota('Ancora da pagare ai collaboratori'), /Già pagati 6\.565 € su 28\.236 €/);
    assert.match(await nota('Provvigioni dei collaboratori'), /Luca 13\.402 € · Giuseppe 14\.834 €/);
    assert.match(await nota('Pratiche concluse'), /Nel periodo scelto/);
    assert.match(await nota('Compensi dell\'agenzia'), /Senza IVA/);
    // niente confronti, miniature o altri numeri a corredo: solo i quattro riquadri
    assert.equal(await p.locator('.kpi .kpi-delta, .kpi .kpi-spark').count(), 0);
  });

  test('ogni riquadro apre la schermata collegata', async () => {
    const p = app.pagina;
    const prova = async (etichetta, controlla) => {
      await vai(p, '#/');
      await conNavigazione(p, () => p.locator('a.kpi', { has: p.locator('.kpi-etichetta', { hasText: new RegExp(`^${etichetta}$`) }) }).click());
      await controlla();
    };
    await prova('Pratiche concluse', async () => {
      assert.match(await p.locator('#contenuto h1').innerText(), /Archivio pratiche/);
      assert.match(await p.evaluate(() => location.hash), /stato=conclusa/);
      await p.waitForFunction(() => /13 pratiche/.test(document.querySelector('#contenuto').innerText));
    });
    await prova('Compensi dell\'agenzia', async () => assert.match(await p.locator('#contenuto h1').innerText(), /Statistiche e grafici/));
    await prova('Provvigioni dei collaboratori', async () => assert.match(await p.locator('#contenuto h1').innerText(), /Provvigioni e liquidazioni/));
    await prova('Ancora da pagare ai collaboratori', async () => {
      assert.match(await p.locator('#contenuto h1').innerText(), /Provvigioni e liquidazioni/);
      assert.match(await p.evaluate(() => location.hash), /solo=da-liquidare/);
    });
    await vai(p, '#/');
  });

  test('filtro periodo: mese scorso, mese corrente, intervallo personalizzato, tutto', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    // settembre 2026: pratiche 009 e 015 (quest'ultima senza data di rogito: vale la data di apertura)
    await scegliPeriodo(p, 'Mese scorso');
    assert.deepEqual(await riquadri(p), { concluse: 2, compensi: 4320 * E, maturate: 1296 * E, daLiquidare: 1296 * E });
    assert.match(rimuoviSpazi(await p.textContent('.tb-periodo')), /settembre 2026/);
    // ottobre 2026: pratiche 010, 011, 012
    await scegliPeriodo(p, 'Mese corrente');
    assert.deepEqual(await riquadri(p), { concluse: 3, compensi: 23200 * E, maturate: 7660 * E, daLiquidare: 7660 * E });
    // intervallo 01/03/2026 – 30/06/2026: pratiche 003, 004, 005, 006
    await p.click('.periodo-btn');
    await p.click('.sel-periodo [role="tab"]:has-text("Intervallo")');
    const campi = p.locator('.sel-periodo .campo-data input.input');
    await campi.nth(0).fill('01/03/2026');
    await campi.nth(1).fill('30/06/2026');
    await p.waitForFunction(() => document.querySelector('.tb-periodo').textContent.includes('01/03/2026'));
    await p.keyboard.press('Escape');
    assert.deepEqual(await riquadri(p), { concluse: 4, compensi: 26600 * E, maturate: 8500 * E, daLiquidare: 6135 * E });
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
    await p.waitForFunction(() => /01\/10\/2026\s*–\s*16\/10\/2026/.test(document.querySelector('.tb-periodo')?.textContent ?? ''));
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

  test('la dashboard ha solo il filtro del periodo; zona e collaboratore si scelgono nelle Statistiche', async () => {
    const p = app.pagina;
    await azzeraFiltri(p);
    await vai(p, '#/');
    assert.equal(await p.locator('#filtro-zona').isVisible(), false);
    assert.equal(await p.locator('#filtro-collab').isVisible(), false);
    assert.equal(await p.locator('.striscia-filtri .segmenti').isVisible(), false, 'niente vista mensile/annuale');
    assert.equal(await p.locator('.periodo-btn').first().isVisible(), true);
    await vai(p, '#/statistiche');
    assert.equal(await p.locator('#filtro-zona').isVisible(), true);
    assert.equal(await p.locator('#filtro-collab').isVisible(), true);
  });

  test('Statistiche: filtro per zona (stessi numeri calcolati a mano)', async () => {
    const p = app.pagina;
    await azzeraFiltri(p);
    await vai(p, '#/statistiche');
    const t = async () => { const x = await totaliStatistiche(p); return { concluse: x.concluse, compensi: x.compensi, provvigioni: x.provvigioni, margine: x.margine, valore: x.valore }; };
    assert.deepEqual(await t(), { concluse: 13, compensi: 87920 * E, provvigioni: 28236 * E, margine: 59684 * E, valore: 2178000 * E });
    await scegliZona(p, 'Lungomare');
    assert.deepEqual(await t(), { concluse: 5, compensi: 41600 * E, provvigioni: 13640 * E, margine: 27960 * E, valore: 1020000 * E });
    await scegliZona(p, 'Collina');
    assert.deepEqual(await t(), { concluse: 2, compensi: 10720 * E, provvigioni: 3216 * E, margine: 7504 * E, valore: 268000 * E });
    await scegliZona(p, 'Centro');
    assert.deepEqual(await t(), { concluse: 6, compensi: 35600 * E, provvigioni: 11380 * E, margine: 24220 * E, valore: 890000 * E });
    assert.match(rimuoviSpazi(await p.locator('#contenuto .pagina-testa p').innerText()), /Anno 2026/);
    await azzeraFiltri(p);
  });

  test('Statistiche: filtro per collaboratore (conta le sue quote) e filtri combinati', async () => {
    const p = app.pagina;
    await azzeraFiltri(p);
    await vai(p, '#/statistiche');
    const t = async () => { const x = await totaliStatistiche(p); return [x.concluse, x.compensi, x.provvigioni, x.valore]; };
    await scegliCollaboratore(p, 'Luca');
    assert.deepEqual(await t(), [8, 42340 * E, 13402 * E, 1158000 * E]);
    await scegliCollaboratore(p, 'Giuseppe');
    assert.deepEqual(await t(), [7, 45580 * E, 14834 * E, 1245000 * E]);
    // Luca + zona Centro
    await scegliCollaboratore(p, 'Luca');
    await scegliZona(p, 'Centro');
    assert.deepEqual(await t(), [6, 31620 * E, 10186 * E, 890000 * E]);
    // il pulsante "Azzera filtri" ripristina tutto
    await azzeraFiltri(p);
    assert.deepEqual(await t(), [13, 87920 * E, 28236 * E, 2178000 * E]);
    assert.equal(await p.locator('.striscia-filtri button:has-text("Azzera filtri")').isVisible(), false);
  });

  test('i filtri restano quando si cambia schermata; la dashboard guarda sempre tutta l\'agenzia', async () => {
    const p = app.pagina;
    await vai(p, '#/statistiche');
    await scegliCollaboratore(p, 'Giuseppe');
    await p.click('.sidebar .nav-voce[data-id="dashboard"]');
    await p.waitForSelector('.kpi');
    assert.equal((await riquadri(p)).compensi, 87920 * E, 'la dashboard non è filtrata');
    await p.click('.sidebar .nav-voce[data-id="statistiche"]');
    await p.waitForSelector('#contenuto h1:has-text("Statistiche e grafici")');
    assert.equal(await p.inputValue('#filtro-collab'), String(await p.evaluate(() => window.__gi.app.filtri.collaboratoreId)));
    assert.equal((await totaliStatistiche(p)).compensi, 45580 * E);
    await azzeraFiltri(p);
  });

  test('c\'è un solo grafico, con valori scritti e testo alternativo', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const titoli = await p.$$eval('.grafico-card h3', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(titoli, ['Compensi mese per mese']);
    const g = p.locator('#grafico-compensi');
    assert.equal(await g.locator('svg.g-svg').count(), 1, 'un solo disegno');
    assert.ok(await g.locator('.g-barra, .g-punto, .g-linea').count() > 0, 'ha delle barre');
    assert.ok(await g.locator('svg.g-svg').getAttribute('aria-label'), 'ha un testo per i lettori di schermo');
    assert.equal(await g.locator('.g-vuoto').isVisible(), false);
    assert.equal(await g.locator('.g-legenda').count(), 0, 'una sola serie: niente legenda');
    const cifre = rimuoviSpazi(await g.locator('.grafico-cifre').innerText());
    assert.match(cifre, /Totale del periodo 87\.920,00 €/);
    assert.match(cifre, /Media al mese 7\.326,67 €/);
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
  });

  test('con il periodo di un solo mese il grafico mostra comunque 12 mesi, quelli fuori periodo attenuati', async () => {
    const p = app.pagina;
    await scegliPeriodo(p, 'Mese corrente');
    const g = p.locator('#grafico-compensi');
    assert.equal(await g.locator('.g-hit').count(), 12);
    assert.ok(await g.locator('.g-colonna.g-dim').count() >= 10, 'i mesi fuori dal periodo sono attenuati');
    assert.match(rimuoviSpazi(await g.locator('.grafico-nota').innerText()), /colonne più chiare sono fuori dal periodo scelto/);
    assert.match(rimuoviSpazi(await g.locator('.grafico-cifre').innerText()), /Totale del periodo 23\.200,00 €/);
    await azzeraFiltri(p);
  });

  test('ultime pratiche: le ultime cinque, poche colonne, e il clic apre la scheda', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const intest = await p.$$eval('section[aria-labelledby="ult-titolo"] thead th', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(intest, ['Data', 'Pratica', 'Compensi']);
    const righe = p.locator('section[aria-labelledby="ult-titolo"] tbody tr');
    assert.equal(await righe.count(), 5);
    // ordine: ultime inserite per prime (015, 014, 013, 012, 011)
    const codici = await righe.evaluateAll((tr) => tr.map((r) => r.children[1].querySelector('.sottotesto').textContent.trim()));
    assert.deepEqual(codici, ['2026/015', '2026/014', '2026/013', '2026/012', '2026/011']);
    const testo = rimuoviSpazi(await righe.nth(2).innerText());
    assert.match(testo, /05\/10\/2026/);
    assert.match(testo, /Via Nuova 4/);
    assert.match(testo, /6\.200,00 €/);
    // clic su una riga (non sul collegamento) → scheda della pratica
    await righe.nth(3).locator('td').last().click();
    await p.waitForSelector('#contenuto h1:has-text("Via Pergolesi 1")');
    assert.match(await p.evaluate(() => location.hash), /^#\/pratiche\/\d+$/);
    await vai(p, '#/');
    await p.locator('section[aria-labelledby="ult-titolo"] a:has-text("Vedi tutte")').click();
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
        immobile_indirizzo: 'Via Aggiunta 1', immobile_comune: 'Roccaverde', immobile_tipo: 'Appartamento',
        prezzo_vendita_cent: 100000 * 100, compenso_venditore_cent: 1500 * 100, compenso_acquirente_cent: 1500 * 100, aliquota_iva: 22,
      }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
    });
    await p.waitForFunction((n) => document.querySelector('.kpi-valore').textContent.trim() === String(n), prima.concluse + 1);
    const dopo = await riquadri(p);
    assert.equal(dopo.concluse, prima.concluse + 1);
    assert.equal(dopo.compensi, prima.compensi + 3000 * E);
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
