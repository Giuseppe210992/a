// Capo (15%) e segretaria (4%): prendono una percentuale fissa del totale delle provvigioni di ogni pratica, in qualsiasi zona,
// in aggiunta a Luca e Giuseppe. Si prova che ci sono già al primo avvio, che la stima nel modulo e la scheda le mostrano, che
// i riquadri e il margine le contano, che si possono cambiare e pagare. Il mese della proposta decide il cumulo.
// Numeri calcolati a mano con gli scaglioni dell'agenzia (5% fino a 2.600, 8% fino a 5.200, 11% fino a 7.800, 15% fino a 13.000, 20% oltre).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, riquadri, totaliStatistiche, finestra, bottoneFinestra, attendiNotifica, testoSospetto, scarica, leggiCsv, centesimi } from './lib.mjs';

const E = 100;

describe('Percentuali fisse: capo e segretaria', () => {
  let app;
  before(async () => {
    app = await avvia({ conPercentualiFisse: true });
    await app.pagina.evaluate(async () => {
      const { api, app: a } = window.__gi;
      const [luca] = api.elencoCollaboratori(a.archivio);
      const zona = await api.creaZona(a.archivio, { nome: 'Centro' });
      await api.salvaRipartizioneZona(a.archivio, zona, [{ collaboratore_id: luca.id, percentuale: 100 }]);
    });
  });
  after(async () => { await app.chiudi(); });

  const L = (e, o = {}) => app.pagina.locator('#form-pratica').getByLabel(e, o);

  test('il primo avvio crea il capo (15%) e la segretaria (4%); non compaiono nelle ripartizioni delle zone', async () => {
    const p = app.pagina;
    await vai(p, '#/impostazioni?sezione=collaboratori');
    const riga = (nome) => p.locator(`.riga-elenco[data-nome="${nome}"]`);
    assert.match(rimuoviSpazi(await riga('Capo').innerText()), /Capo 15% del totale delle provvigioni · 0 liquidazioni/);
    assert.match(rimuoviSpazi(await riga('Segretaria').innerText()), /Segretaria 4% del totale delle provvigioni · 0 liquidazioni/);
    assert.match(rimuoviSpazi(await riga('Luca').innerText()), /Luca 0 pratiche/);
    // la ripartizione di una zona offre solo chi lavora a scaglioni
    await vai(p, '#/impostazioni?sezione=zone');
    await p.locator('.riga-elenco[data-nome="Centro"]').getByRole('button', { name: 'Ripartizione' }).click();
    const f = finestra(p);
    assert.deepEqual(await f.locator('input[aria-label^="Quota di"]').evaluateAll((a) => a.map((i) => i.getAttribute('aria-label'))), ['Quota di Luca', 'Quota di Giuseppe']);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('nel modulo: nominativi obbligatori, mese della proposta e stima con capo e segretaria', async () => {
    const p = app.pagina;
    await vai(p, '#/nuova');
    await L(/^Zona\*?$/).selectOption({ label: 'Centro' });
    await L('Prezzo di vendita').fill('200.000');
    // 6.100 con bonifico = 5.000 + 1.100 di IVA da ciascuna parte: 10.000 € di compenso senza IVA → Luca 15% = 1.500
    await p.locator('#pagamenti-venditore').getByLabel('Bonifico').fill('6.100');
    await p.locator('#pagamenti-acquirente').getByLabel('Bonifico').fill('6.100');
    await p.waitForFunction(() => /Quota 100% dei compensi: 10\.000,00/.test(document.querySelector('.stima-provvigione')?.textContent ?? ''));
    const stima = async () => rimuoviSpazi(await p.locator('.stima-provvigione').innerText());
    let s = await stima();
    assert.match(s, /Luca\s*1\.500,00 €/);
    assert.match(s, /Capo\s*225,00 €\s*15% del totale delle provvigioni \(1\.500,00 €\)/);
    assert.match(s, /Segretaria\s*60,00 €\s*4% del totale delle provvigioni \(1\.500,00 €\)/);
    assert.match(s, /Cumulo di ottobre 2026 in Centro: 10\.000,00 €/);
    // senza i nominativi non si salva
    await p.click('#salva-pratica');
    await p.waitForFunction(() => document.querySelectorAll('#form-pratica .campo.ha-errore').length === 2);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    // la proposta è di settembre: il cumulo cambia mese
    await L('Mese della proposta').selectOption({ label: 'Settembre 2026' });
    await p.waitForFunction(() => /Cumulo di settembre 2026 in Centro/.test(document.querySelector('.stima-provvigione')?.textContent ?? ''));
    await L('Nominativo del venditore').fill('Mario Rossi');
    await L('Nominativo dell\'acquirente').fill('Anna Bianchi');
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 salvata/);
    assert.equal(await valoreSql(p, "SELECT mese_proposta FROM pratiche WHERE codice = '2026/001'"), '2026-09');
  });

  test('la scheda mostra capo e segretaria con il calcolo; i riquadri e il margine li contano', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}`);
    const righe = (await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent)))).map((r) => r.map(rimuoviSpazi));
    assert.deepEqual(righe.map((r) => [r[0], r[1], r[2], r[3], r[4]]), [
      ['Luca', '100%', '10.000,00 €', '4° · 15%', '1.500,00 €'],
      ['Capo', '—', '—', '15% del totale', '225,00 €'],
      ['Segretaria', '—', '—', '4% del totale', '60,00 €'],
    ]);
    assert.match(rimuoviSpazi(await p.locator('#contenuto').innerText()), /Mese della proposta settembre 2026 Inserita il 16\/10\/2026/);
    await p.locator('#come-calcolato summary').click();
    const calcolo = rimuoviSpazi(await p.locator('#come-calcolato').innerText());
    assert.match(calcolo, /Totale delle provvigioni dei collaboratori su questa pratica: 1\.500,00 €\./);
    assert.match(calcolo, /Capo prende il 15% di quel totale, in qualsiasi zona: 1\.500,00 € × 15% = 225,00 € \(arrotondato al centesimo\)\./);
    assert.match(calcolo, /Segretaria prende il 4% di quel totale/);
    // la dashboard di settembre (la proposta è di settembre): provvigioni 1.500 + 225 + 60 = 1.785
    await vai(p, '#/');
    await p.click('.periodo-btn');
    await p.click('.sel-periodo [role="tab"]:has-text("Tutto")');
    await p.keyboard.press('Escape');
    const r = await riquadri(p);
    assert.deepEqual([r.concluse, r.compensi, r.maturate, r.daLiquidare], [1, 10000 * E, 1785 * E, 1785 * E]);
    // il margine dell'agenzia è quello che resta dopo tutte le provvigioni: 10.000 − 1.785 = 8.215
    await vai(p, '#/statistiche');
    const t = await totaliStatistiche(p);
    assert.deepEqual([t.compensi, t.provvigioni, t.margine], [10000 * E, 1785 * E, 8215 * E]);
    // nell'archivio le quote sono solo quelle dei collaboratori
    await vai(p, '#/pratiche');
    assert.match(rimuoviSpazi(await p.locator('#tabella-archivio tbody tr').first().innerText()), /Luca/);
    assert.doesNotMatch(rimuoviSpazi(await p.locator('#tabella-archivio tbody tr').first().innerText()), /Capo|Segretaria/);
  });

  test('si può pagare il capo dalla liquidazione; esportazione e Provvigioni lo mostrano', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.click('#op-liquidazione');
    const f = finestra(p);
    await f.getByLabel('Collaboratore').selectOption({ label: (await f.getByLabel('Collaboratore').locator('option').allInnerTexts()).find((x) => x.startsWith('Capo')) });
    assert.match(rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText()), /Totale della liquidazione 225,00 €/);
    await bottoneFinestra(p, 'Registra liquidazione').click();
    await attendiNotifica(p, /Liquidazione di 225,00 € registrata per Capo/);
    assert.deepEqual(await sql(p, 'SELECT r.importo_cent, c.nome FROM liquidazioni_righe r JOIN liquidazioni l ON l.id = r.liquidazione_id JOIN collaboratori c ON c.id = l.collaboratore_id'), [{ importo_cent: 22500, nome: 'Capo' }]);
    // modificare la pratica non è bloccato dalla liquidazione del capo
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}/modifica`);
    await L('Prezzo di vendita').fill('210.000');
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 aggiornata/);
    // CSV delle provvigioni: una riga per ciascuno, quota vuota per chi ha la percentuale fissa
    await vai(p, '#/provvigioni');
    await p.getByRole('tab', { name: /Dettaglio/ }).click();
    const file = await scarica(p, () => p.getByRole('button', { name: 'Esporta in CSV' }).click());
    const csv = leggiCsv(file.bytes);
    const col = (n) => csv.intestazioni.indexOf(n);
    const capo = csv.righe.find((r) => r[col('Collaboratore')] === 'Capo');
    assert.deepEqual([capo[col('Quota %')], capo[col('Percentuale applicata')], capo[col('Provvigione calcolata')], capo[col('Liquidata')], capo[col('Da liquidare')]], ['', '15', '225,00', '225,00', '0,00']);
    assert.equal(csv.righe.reduce((s, r) => s + centesimi(r[col('Provvigione calcolata')] || '0'), 0), 1785 * E);
  });

  test('si cambia la percentuale del capo da Impostazioni: tutto si ricalcola; valori non validi rifiutati', async () => {
    const p = app.pagina;
    await vai(p, '#/impostazioni?sezione=collaboratori');
    await p.locator('.riga-elenco[data-nome="Capo"]').getByRole('button', { name: 'Modifica' }).click();
    const f = finestra(p);
    await f.getByLabel('Percentuale fissa sul totale delle provvigioni').fill('abc');
    await bottoneFinestra(p, 'Salva').click();
    assert.match(rimuoviSpazi(await f.innerText()), /Scrivi una percentuale valida/);
    await f.getByLabel('Percentuale fissa sul totale delle provvigioni').fill('150');
    await bottoneFinestra(p, 'Salva').click();
    await f.locator('.ha-errore').waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /maggiore di 0 e al massimo 100/);
    await f.getByLabel('Percentuale fissa sul totale delle provvigioni').fill('20');
    await bottoneFinestra(p, 'Salva').click();
    await attendiNotifica(p, /Modifiche salvate/);
    assert.equal(await valoreSql(p, "SELECT percentuale_fissa FROM collaboratori WHERE nome = 'Capo'"), 20);
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}`);
    const righe = (await p.locator('#tabella-provvigioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.textContent)))).map((r) => r.map(rimuoviSpazi));
    assert.deepEqual(righe.find((r) => r[0] === 'Capo').slice(3, 5), ['20% del totale', '300,00 €']); // 20% di 1.500
    // Luca lavora già a scaglioni: non gli si può dare una percentuale fissa (il campo non c'è nemmeno)
    await vai(p, '#/impostazioni?sezione=collaboratori');
    await p.locator('.riga-elenco[data-nome="Luca"]').getByRole('button', { name: 'Modifica' }).click();
    assert.equal(await finestra(p).getByLabel('Percentuale fissa sul totale delle provvigioni').count(), 0);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
