// Primo avvio: archivio vuoto, nessun dato dimostrativo, configurazione guidata.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, kpi, rimuoviSpazi } from './lib.mjs';

describe('Primo avvio', () => {
  let app;
  before(async () => { app = await avvia(); });
  after(async () => { await app.chiudi(); });

  test('la dashboard parte vuota: zeri, nessun dato di esempio', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    assert.equal(await kpi(p, 'Compravendite concluse'), '0');
    assert.equal(rimuoviSpazi(await kpi(p, 'Totale compensi registrati')), '0 €');
    assert.equal(rimuoviSpazi(await kpi(p, 'Provvigioni maturate')), '0 €');
    assert.equal(rimuoviSpazi(await kpi(p, 'Provvigioni ancora da liquidare')), '0 €');
    assert.equal(rimuoviSpazi(await kpi(p, 'Valore complessivo immobili venduti')), '0 €');
    assert.equal(await kpi(p, 'Pratiche in corso'), '0');
    const stato = await p.evaluate(() => {
      const a = window.__gi.app.archivio;
      return { pratiche: a.valore('SELECT COUNT(*) FROM pratiche'), zone: a.valore('SELECT COUNT(*) FROM zone'), incassi: a.valore('SELECT COUNT(*) FROM incassi'), nomi: a.tutti('SELECT nome FROM collaboratori ORDER BY id').map((r) => r.nome) };
    });
    assert.deepEqual(stato, { pratiche: 0, zone: 0, incassi: 0, nomi: ['Luca', 'Giuseppe'] });
    // 6 grafici con messaggio di stato vuoto, nessuna barra inventata
    assert.equal(await p.locator('.grafico-card').count(), 6);
    assert.equal(await p.locator('.g-barra').count(), 0);
    assert.equal(await p.locator('.grafico-card .g-vuoto').count(), 6);
    // guida ai primi passi
    assert.match(await p.textContent('.primi-passi'), /Per iniziare/);
    assert.equal(await p.locator('.primi-passi .passo').count(), 4);
    assert.equal(await p.locator('.primi-passi .passo.fatto').count(), 1); // solo i collaboratori
    // la tabella delle ultime pratiche e' vuota ma spiegata
    assert.match(await p.textContent('section[aria-labelledby="ult-titolo"]'), /Nessuna pratica da mostrare/);
    // nessun avviso inutile su un archivio vuoto
    assert.match(await p.textContent('#avvisi'), /Tutto in ordine/);
    assert.deepEqual(app.errori, []);
  });

  test('tutte le schermate si aprono anche senza dati', async () => {
    const p = app.pagina;
    for (const [hash, titolo] of [['#/pratiche', 'Archivio pratiche'], ['#/provvigioni', 'Provvigioni e liquidazioni'], ['#/cumulo', 'Cumulo mensile per zona'], ['#/statistiche', 'Statistiche e grafici'], ['#/backup', 'Backup e archivio storico'], ['#/impostazioni', 'Impostazioni']]) {
      await vai(p, hash);
      assert.equal(rimuoviSpazi(await p.locator('#contenuto h1').first().textContent()), titolo);
    }
    assert.deepEqual(app.errori, []);
  });

  test('una pratica "Registra incasso/liquidazione" senza pratiche spiega cosa fare', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.click('#op-incasso');
    await p.waitForSelector('dialog.modale[open]');
    assert.match(await p.textContent('dialog.modale'), /Non c'è ancora nessuna pratica/);
    await p.click('dialog.modale button:has-text("Nuova pratica")');
    await p.waitForSelector('#contenuto h1:has-text("Nuova pratica")');
    assert.equal(await p.locator('dialog.modale').count(), 0);
  });
});
