// Primo avvio: archivio vuoto, nessun dato dimostrativo, configurazione guidata.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, kpi, rimuoviSpazi } from './lib.mjs';

describe('Primo avvio', () => {
  let app;
  before(async () => { app = await avvia({ conPercentualiFisse: true }); }); // come al primo avvio vero: con il capo e la segretaria
  after(async () => { await app.chiudi(); });

  test('la dashboard parte vuota: zeri, nessun dato di esempio', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    assert.equal(await kpi(p, 'Pratiche concluse'), '0');
    assert.equal(rimuoviSpazi(await kpi(p, 'Compensi dell\'agenzia')), '0 €');
    assert.equal(rimuoviSpazi(await kpi(p, 'Provvigioni pagate')), '0 €');
    assert.equal(await p.locator('.kpi').count(), 3);
    const stato = await p.evaluate(() => {
      const a = window.__gi.app.archivio;
      return { pratiche: a.valore('SELECT COUNT(*) FROM pratiche'), zone: a.valore('SELECT COUNT(*) FROM zone'), incassi: a.valore('SELECT COUNT(*) FROM incassi'), nomi: a.tutti('SELECT nome FROM collaboratori ORDER BY id').map((r) => r.nome) };
    });
    assert.deepEqual(stato, { pratiche: 0, zone: 0, incassi: 0, nomi: ['Luca', 'Giuseppe', 'Capo', 'Segretaria'] });
    // la tabella delle ultime pratiche e' vuota ma spiegata
    assert.match(await p.textContent('section[aria-labelledby="ult-titolo"]'), /Nessuna pratica da mostrare/);
    // nessun avviso inutile su un archivio vuoto
    assert.match(await p.textContent('#avvisi'), /Tutto in ordine/);
    assert.deepEqual(app.errori, []);
  });

  test('tutte le schermate si aprono anche senza dati', async () => {
    const p = app.pagina;
    for (const [hash, titolo] of [['#/pratiche', 'Archivio pratiche'], ['#/provvigioni', 'Provvigioni'], ['#/cumulo', 'Cumulo mensile per zona'], ['#/statistiche', 'Statistiche e grafici'], ['#/backup', 'Backup e archivio storico'], ['#/impostazioni', 'Impostazioni']]) {
      await vai(p, hash);
      assert.equal(rimuoviSpazi(await p.locator('#contenuto h1').first().textContent()), titolo);
    }
    assert.deepEqual(app.errori, []);
  });
});
