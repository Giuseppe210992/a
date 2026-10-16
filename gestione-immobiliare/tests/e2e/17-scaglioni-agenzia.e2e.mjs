// Scaglioni dell'agenzia preimpostati: 5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre.
// Si prova che sono già al primo avvio, che si leggono come li ha detti l'agenzia (anche al centesimo), che arrivano alla stima nel
// modulo, alla scheda e alla dashboard, e che si possono ripristinare. I numeri attesi sono calcolati a mano, non dal programma.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, riquadri, finestra, bottoneFinestra, attendiNotifica, testoSospetto } from './lib.mjs';

const E = 100;
const RIGHE_AGENZIA = ['0,00/5', '2.600,01/8', '5.200,01/11', '7.800,01/15', '13.000,01/20'];

describe('Scaglioni dell\'agenzia preimpostati', () => {
  let app;
  before(async () => { app = await avvia(); });
  after(async () => { await app.chiudi(); });

  const righeEditor = (p) => p.locator('#tabella-editor-scaglioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.querySelectorAll('input')].map((i) => i.value).join('/')));
  const esempio = async (p, cumulo) => {
    await p.getByLabel('Prova con un cumulo mensile di').fill(cumulo);
    return rimuoviSpazi(await p.locator('.imp-corpo div.esempio-calcolo').innerText());
  };

  test('al primo avvio la tabella è già quella dell\'agenzia e si legge come l\'ha detta, anche al centesimo', async () => {
    const p = app.pagina;
    await vai(p, '#/impostazioni?sezione=scaglioni');
    await p.waitForSelector('#tabella-editor-scaglioni');
    assert.deepEqual(await righeEditor(p), RIGHE_AGENZIA);
    assert.equal(await p.locator('#scaglioni-vuoti').count(), 0, 'nessun avviso «senza scaglioni»');
    assert.deepEqual((await p.locator('ul.esempio-calcolo li').allInnerTexts()).map(rimuoviSpazi), [
      '1° scaglione: da 0,00 € a 2.600,00 € → 5%',
      '2° scaglione: da 2.600,01 € a 5.200,00 € → 8%',
      '3° scaglione: da 5.200,01 € a 7.800,00 € → 11%',
      '4° scaglione: da 7.800,01 € a 13.000,00 € → 15%',
      '5° scaglione: da 13.000,01 € in su → 20%',
    ]);
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo').innerText()), /«5% fino a 2\.600 €» si scrive con un secondo scaglione che parte da 2\.600,01 €/);
    // l'esempio con i due metodi, calcolato a mano
    let es = await esempio(p, '13.000');
    assert.match(es, /scaglione raggiunto: 1\.950,00 € \(metodo in uso\)/); // 13.000 × 15%
    assert.match(es, /progressivo: 1\.404,00 €/);                          // 130 + 208 + 286 + 5.200 × 15%
    es = await esempio(p, '13.000,01');
    assert.match(es, /scaglione raggiunto: 2\.600,00 €/);                  // 13.000,01 × 20% = 2.600,002
    es = await esempio(p, '2.600');
    assert.match(es, /scaglione raggiunto: 130,00 €/);                     // 2.600,00 precisi: ancora 5%
    assert.match(es, /progressivo: 130,00 €/);
    es = await esempio(p, '2.600,01');
    assert.match(es, /scaglione raggiunto: 208,00 €/);                     // 2.600,01 × 8% = 208,0008
    assert.deepEqual(await sql(p, 'SELECT da_cent, percentuale FROM scaglioni WHERE zona_id IS NULL ORDER BY da_cent'), [
      { da_cent: 0, percentuale: 5 }, { da_cent: 260001, percentuale: 8 }, { da_cent: 520001, percentuale: 11 }, { da_cent: 780001, percentuale: 15 }, { da_cent: 1300001, percentuale: 20 },
    ]);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM scaglioni WHERE zona_id IS NOT NULL'), 0);
    assert.deepEqual(app.errori, []);
  });

  test('una pratica vera: stima nel modulo, scheda e dashboard usano le percentuali dell\'agenzia (10.000 € di cumulo → 15%)', async () => {
    const p = app.pagina;
    await p.evaluate(async () => { const { api, app: a } = window.__gi; await api.creaZona(a.archivio, { nome: 'Centro' }); });
    await vai(p, '#/nuova');
    const L = (e, o = {}) => p.locator('#form-pratica').getByLabel(e, o);
    await L('Indirizzo dell\'immobile').fill('Via Agenzia 1');
    await L('Comune').fill('Minturno');
    await L(/^Zona$/).selectOption({ label: 'Centro' });
    await L(/^Stato/).selectOption('conclusa');
    await L('Data di apertura').fill('01/10/2026');
    await L('Data del rogito').fill('14/10/2026');
    await L('Prezzo di vendita').fill('200.000');
    await L('Compenso dal venditore').fill('5.000,00');
    await L('Compenso dall\'acquirente').fill('5.000,00');
    await p.getByRole('button', { name: 'Tutto a Luca' }).click();
    await p.waitForFunction(() => /Quota 100% dei compensi: 10\.000,00/.test(document.querySelector('.stima-provvigione')?.textContent ?? ''));
    const s = rimuoviSpazi(await p.locator('.stima-provvigione').innerText());
    assert.match(s, /Luca\s*1\.500,00 €/);                                                  // 10.000 × 15%
    assert.match(s, /Cumulo di ottobre 2026 in Centro: 10\.000,00 € → scaglione 4 \(15%\)/);
    assert.match(s, /Mancano 3\.000,01 € allo scaglione 5 \(20%\)/);                         // si passa al 20% da 13.000,01 €
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 salvata/);
    // scheda: i passaggi con i numeri reali
    await vai(p, `#/pratiche/${await idPratica(p, '2026/001')}`);
    const dettagli = p.locator('#come-calcolato');
    await dettagli.locator('summary').click();
    const t = rimuoviSpazi(await dettagli.innerText());
    assert.match(t, /Scaglione raggiunto: 4° \(da 7\.800,01 € a 13\.000,00 €\) → 15%/);
    assert.match(t, /Metodo “scaglione raggiunto”: 15% su tutto il cumulo; 10\.000,00 € × 15% = 1\.500,00 €/);
    // dashboard: provvigione maturata e nessun avviso «scaglioni non configurati»
    await vai(p, '#/');
    const r = await riquadri(p);
    assert.equal(r.maturate, 1500 * E);
    assert.equal(r.daLiquidare, 1500 * E);
    assert.doesNotMatch(await p.textContent('#avvisi'), /Scaglioni non configurati/);
    assert.deepEqual(await testoSospetto(p), []);
  });

  test('«Ripristina gli scaglioni dell\'agenzia»: se già uguali lo dice, altrimenti chiede conferma; le zone con scaglioni propri non cambiano', async () => {
    const p = app.pagina;
    await p.evaluate(async () => {
      const { api, app: a } = window.__gi;
      const z = await api.creaZona(a.archivio, { nome: 'Collina' });
      await api.salvaTabellaScaglioni(a.archivio, z, [{ da_cent: 0, percentuale: 50 }]);
      await api.aggiornaZona(a.archivio, z, { usaScaglioniPropri: true });
    });
    await vai(p, '#/');
    await vai(p, '#/impostazioni?sezione=scaglioni');
    await p.waitForSelector('#tabella-editor-scaglioni');
    // già uguali: nessuna domanda
    await p.click('#ripristina-scaglioni');
    await attendiNotifica(p, /Gli scaglioni sono già quelli dell'agenzia/);
    assert.equal(await finestra(p).count(), 0);
    // si cambia e si salva il primo scaglione
    await p.getByLabel('Percentuale dello scaglione 1').fill('7');
    await p.click('#salva-scaglioni');
    await attendiNotifica(p, /Scaglioni predefiniti salvati/);
    assert.equal(await valoreSql(p, 'SELECT percentuale FROM scaglioni WHERE zona_id IS NULL AND da_cent = 0'), 7);
    // la finestra spiega cosa succede; annullando non cambia nulla
    await p.click('#ripristina-scaglioni');
    const t = rimuoviSpazi(await finestra(p).innerText());
    assert.match(t, /Ripristinare gli scaglioni dell'agenzia\?/);
    assert.match(t, /5% fino a 2\.600,00 €, 8% fino a 5\.200,00 €, 11% fino a 7\.800,00 €, 15% fino a 13\.000,00 €, 20% oltre 13\.000,00 €/);
    assert.match(t, /Le modifiche fatte a questa tabella andranno perse/);
    assert.match(t, /Le tabelle proprie delle singole zone non cambiano/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT percentuale FROM scaglioni WHERE zona_id IS NULL AND da_cent = 0'), 7);
    // confermando, torna la tabella dell'agenzia (anche a video) e le provvigioni vengono ricalcolate
    await p.click('#ripristina-scaglioni');
    await bottoneFinestra(p, 'Ripristina').click();
    await attendiNotifica(p, /Scaglioni dell'agenzia ripristinati\. Le provvigioni sono state ricalcolate/);
    assert.deepEqual((await sql(p, 'SELECT da_cent, percentuale FROM scaglioni WHERE zona_id IS NULL ORDER BY da_cent')).map((r) => `${r.da_cent}/${r.percentuale}`), ['0/5', '260001/8', '520001/11', '780001/15', '1300001/20']);
    assert.deepEqual(await righeEditor(p), RIGHE_AGENZIA);
    assert.deepEqual(await sql(p, "SELECT da_cent, percentuale FROM scaglioni WHERE zona_id = (SELECT id FROM zone WHERE nome = 'Collina')"), [{ da_cent: 0, percentuale: 50 }], 'la zona Collina ha ancora i suoi');
  });

  test('senza scaglioni (archivio vecchio) l\'editor lo dice e il ripristino riporta quelli dell\'agenzia', async () => {
    const p = app.pagina;
    await p.evaluate(async () => { const { api, app: a } = window.__gi; await api.salvaTabellaScaglioni(a.archivio, null, []); });
    await vai(p, '#/');
    await vai(p, '#/impostazioni?sezione=scaglioni');
    await p.waitForSelector('#scaglioni-vuoti');
    assert.match(rimuoviSpazi(await p.locator('#scaglioni-vuoti').innerText()), /Non ci sono scaglioni: le provvigioni risultano a zero/);
    assert.equal(await p.locator('#tabella-editor-scaglioni tbody tr').count(), 0);
    // «Aggiungi scaglione» propone la prima percentuale dell'agenzia, non un valore inventato
    await p.click('#aggiungi-scaglione');
    assert.equal(await p.getByLabel('Percentuale dello scaglione 1').inputValue(), '5');
    await p.click('#ripristina-scaglioni');
    assert.match(rimuoviSpazi(await finestra(p).innerText()), /Ripristinare gli scaglioni dell'agenzia\?/);
    await bottoneFinestra(p, 'Ripristina').click();
    await attendiNotifica(p, /Scaglioni dell'agenzia ripristinati/);
    assert.deepEqual(await righeEditor(p), RIGHE_AGENZIA);
    assert.equal(await p.locator('#scaglioni-vuoti').count(), 0);
    assert.deepEqual(await testoSospetto(p), []);
    assert.deepEqual(app.errori, []);
  });
});
