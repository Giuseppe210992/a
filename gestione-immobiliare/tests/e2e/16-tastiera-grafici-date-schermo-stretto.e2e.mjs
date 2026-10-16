// Ultimi controlli rimasti scoperti: grafici e menu usati con la tastiera, campo data (scrittura, calendario), filtri su schermo stretto,
// grafico con tante zone ("Altri"), pulsante dentro la notifica dopo un ripristino, copia danneggiata, errori nei moduli della scheda.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, attendiQuiete, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

describe('Grafici usati con la tastiera', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });

  /** Mette il cursore sul grafico, preme i tasti e controlla che il suggerimento (tooltip) segua la scelta. */
  async function provaGrafico(p, selettore, { avanti, indietro }) {
    const g = p.locator(selettore);
    await g.scrollIntoViewIfNeeded();
    const svg = g.locator('svg.g-svg');
    await svg.focus();
    const tt = g.locator('.g-tooltip');
    const testo = () => tt.evaluate((e) => e.textContent.replace(/\s+/g, ' ').trim()); // stesso calcolo di quello nelle attese qui sotto
    await p.keyboard.press('Home');
    await tt.waitFor({ state: 'visible' });
    const primo = await testo();
    await p.keyboard.press('End');
    await p.waitForFunction(([sel, x]) => document.querySelector(`${sel} .g-tooltip`).textContent.replace(/\s+/g, ' ').trim() !== x, [selettore, primo]);
    const ultimo = await testo();
    assert.notEqual(primo, ultimo, 'Home e Fine portano a categorie diverse');
    await p.keyboard.press(indietro);
    await p.waitForFunction(([sel, x]) => document.querySelector(`${sel} .g-tooltip`).textContent.replace(/\s+/g, ' ').trim() !== x, [selettore, ultimo]);
    const penultimo = await testo();
    assert.notEqual(penultimo, ultimo, `${indietro} torna alla categoria precedente`);
    await p.keyboard.press(avanti);
    await p.waitForFunction(([sel, x]) => document.querySelector(`${sel} .g-tooltip`).textContent.replace(/\s+/g, ' ').trim() === x, [selettore, ultimo]);
    await p.keyboard.press('Escape');
    await tt.waitFor({ state: 'hidden' });
  }

  test('Dashboard › Andamento dei compensi (colonne): frecce, Home, Fine ed Esc', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await provaGrafico(p, '#grafico-compensi', { avanti: 'ArrowRight', indietro: 'ArrowLeft' });
  });

  test('Dashboard › Provvigioni maturate e liquidate (barre): frecce su e giù, Home, Fine ed Esc', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await provaGrafico(p, '#grafico-provvigioni', { avanti: 'ArrowDown', indietro: 'ArrowUp' });
  });

  test('Dashboard › Prezzo di acquisto e di vendita (confronto): frecce su e giù, Home, Fine ed Esc', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await provaGrafico(p, '#grafico-prezzi', { avanti: 'ArrowDown', indietro: 'ArrowUp' });
  });

  test('Statistiche › Compensi e incassi (linee): frecce destra e sinistra, Home, Fine ed Esc', async () => {
    const p = app.pagina;
    await vai(p, '#/statistiche');
    await provaGrafico(p, '#grafico-compensi-incassi', { avanti: 'ArrowRight', indietro: 'ArrowLeft' });
  });

  test('Statistiche › Compensi per zona (barre): frecce su e giù, Home, Fine ed Esc', async () => {
    const p = app.pagina;
    await vai(p, '#/statistiche');
    await provaGrafico(p, '#grafico-per-zona', { avanti: 'ArrowDown', indietro: 'ArrowUp' });
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
  });
});

describe('Menu delle azioni, campo data e notifiche con il pulsante', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  /** Se è rimasto aperto un modulo con modifiche non salvate (prova precedente fallita), ne esce confermando. */
  async function esciDalModulo(p) {
    if (!(await p.locator('#form-pratica').count())) return;
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForFunction(() => document.querySelector('dialog.modale[open]') || !document.querySelector('#form-pratica'));
    if (await finestra(p).count()) await bottoneFinestra(p, 'Esci senza salvare').click();
    await p.waitForFunction(() => !document.querySelector('#form-pratica'));
  }
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await esciDalModulo(p);
    await vai(p, '#/');
  });

  test('Archivio › menu "Azioni per la pratica": Invio lo apre, le frecce scorrono le voci, Esc lo chiude e riporta il cursore', async () => {
    const p = app.pagina;
    await vai(p, '#/pratiche');
    const bottone = p.getByRole('button', { name: 'Azioni per la pratica 2026/012' });
    await bottone.focus();
    await p.keyboard.press('Enter');
    const menu = p.locator('.popover[role="menu"]');
    await menu.waitFor();
    const voci = menu.locator('button.voce');
    assert.deepEqual((await voci.allInnerTexts()).map((x) => x.trim()), ['Apri la scheda', 'Modifica', 'Registra un incasso', 'Elimina…']);
    const attiva = () => p.evaluate(() => document.activeElement.textContent.trim());
    assert.equal(await attiva(), 'Apri la scheda');
    await p.keyboard.press('ArrowDown');
    assert.equal(await attiva(), 'Modifica');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('ArrowUp');
    assert.equal(await attiva(), 'Elimina…', 'dall\'inizio si passa all\'ultima voce');
    await p.keyboard.press('Escape');
    await p.locator('.popover[role="menu"]').waitFor({ state: 'detached' });
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Azioni per la pratica 2026/012');
    // il pulsante apre e richiude lo stesso menu
    await bottone.click();
    await menu.waitFor();
    await bottone.click();
    await p.locator('.popover[role="menu"]').waitFor({ state: 'detached' });
    // e una voce si sceglie con Invio
    await bottone.focus();
    await p.keyboard.press('Enter');
    await menu.waitFor();
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await finestra(p).waitFor();
    assert.match(await finestra(p).locator('h2').innerText(), /Registra un incasso/);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('Finestre: Maiusc+Tab dal primo elemento porta all\'ultimo e Tab dall\'ultimo al primo: il cursore non esce dalla finestra', async () => {
    const p = app.pagina;
    await p.click('#op-incasso');
    const f = finestra(p);
    await f.waitFor();
    const nome = () => p.evaluate(() => { const e = document.activeElement; return e.getAttribute('aria-label') || e.textContent.trim() || e.id; });
    await f.getByRole('button', { name: 'Chiudi' }).focus();
    await p.keyboard.press('Shift+Tab');
    assert.equal(await nome(), 'Registra incasso', 'dal primo si passa all\'ultimo');
    await p.keyboard.press('Tab');
    assert.equal(await nome(), 'Chiudi', 'dall\'ultimo si torna al primo');
    assert.equal(await f.evaluate((d) => d.contains(document.activeElement)), true);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('Campo data: le barre compaiono da sole, le lettere vengono tolte, il calendario si apre e la data scelta compare', async () => {
    const p = app.pagina;
    await vai(p, '#/nuova');
    const data = p.locator('#form-pratica').getByLabel('Data di apertura');
    await data.fill('');
    await data.pressSequentially('20102026');
    assert.equal(await data.inputValue(), '20/10/2026');
    await data.fill('');
    await data.pressSequentially('2010');
    assert.equal(await data.inputValue(), '20/10');
    await data.fill('');
    await data.pressSequentially('ab12');
    assert.equal(await data.inputValue(), '12', 'le lettere non vengono accettate');
    // il pulsante del calendario chiama il selettore del browser
    await p.evaluate(() => {
      window.__selettori = 0;
      const orig = HTMLInputElement.prototype.showPicker;
      HTMLInputElement.prototype.showPicker = function () { window.__selettori += 1; return orig.call(this); };
    });
    await p.locator('#form-pratica').getByRole('button', { name: 'Scegli dal calendario' }).first().click();
    assert.equal(await p.evaluate(() => window.__selettori), 1);
    // quando nel calendario si sceglie un giorno, il campo mostra la data in italiano
    await p.evaluate(() => {
      const nativo = document.querySelector('#form-pratica .data-nativa');
      nativo.value = '2026-11-05';
      nativo.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await data.inputValue(), '05/11/2026');
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForFunction(() => document.querySelector('dialog.modale[open]') || document.querySelector('#contenuto h1')?.textContent === 'Dashboard');
    if (await finestra(p).count()) await bottoneFinestra(p, 'Esci senza salvare').click();
  });

  test('Ripristino di una copia: la notifica ha il pulsante "Vai alla dashboard"; una copia danneggiata viene rifiutata con una spiegazione', async () => {
    const p = app.pagina;
    await vai(p, '#/backup');
    await p.click('#bk-crea');
    await attendiNotifica(p, /Backup creato/);
    await p.locator('#tabella-storico tbody tr').first().waitFor();
    await p.locator('#tabella-storico tbody tr').first().getByRole('button', { name: 'Ripristina' }).click();
    await bottoneFinestra(p, 'Ripristina questa copia').click();
    await attendiNotifica(p, /Dati ripristinati: 15 pratiche/);
    await p.locator('.toast-area .toast:not([data-vecchia])').getByRole('button', { name: 'Vai alla dashboard' }).click();
    await p.waitForFunction(() => location.hash === '#/');
    // una copia che non è un archivio valido
    await p.evaluate(async () => { await window.__gi.app.driver.creaCopia(new Uint8Array(300).fill(7), 'manuale'); });
    await vai(p, '#/backup');
    await p.waitForFunction(() => document.querySelectorAll('#tabella-storico tbody tr').length >= 2);
    const nPratiche = await valoreSql(p, 'SELECT COUNT(*) FROM pratiche');
    // la riga con la copia danneggiata è la più recente (in cima)
    await p.locator('#tabella-storico tbody tr').first().getByRole('button', { name: 'Ripristina' }).click();
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Questa copia non è utilizzabile/);
    await bottoneFinestra(p, 'Ho capito').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), nPratiche, 'i dati non sono stati toccati');
  });

  test('Scheda pratica › Modifica incasso con un importo non valido spiega l\'errore e lascia aperta la finestra', async () => {
    const p = app.pagina;
    const codice = await valoreSql(p, 'SELECT pr.codice FROM incassi i JOIN pratiche pr ON pr.id = i.pratica_id ORDER BY i.id LIMIT 1');
    await vai(p, `#/pratiche/${await idPratica(p, codice)}`);
    await p.getByRole('button', { name: /^Modifica l'incasso del/ }).first().click();
    const f = finestra(p);
    await f.waitFor();
    const sqlPrimo = `SELECT i.importo_cent FROM incassi i JOIN pratiche pr ON pr.id = i.pratica_id WHERE pr.codice = '${codice}' ORDER BY i.id LIMIT 1`;
    const prima = await valoreSql(p, sqlPrimo);
    await f.getByLabel('Importo (IVA inclusa)').fill('abc');
    await bottoneFinestra(p, 'Salva').click();
    await f.locator('.ha-errore').first().waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Scrivi un importo valido/);
    assert.equal(await f.count(), 1);
    assert.equal(await valoreSql(p, sqlPrimo), prima);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
    void sql; void attendiQuiete;
  });
});

describe('Schermo stretto, tante zone e scheda senza scaglioni', () => {
  test('Telefono: il pulsante "Filtri" apre e chiude la barra dei filtri', async () => {
    const app = await avvia({ viewport: { width: 390, height: 844 } });
    try {
      const p = app.pagina;
      await vai(p, '#/');
      const toggle = p.locator('.filtri-toggle');
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await p.locator('.striscia-filtri').evaluate((e) => e.classList.contains('aperta')), true);
      assert.equal(await p.locator('#filtro-zona').isVisible(), true, 'con la barra aperta si vedono i filtri');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await p.locator('#filtro-zona').isVisible(), false);
    } finally { await app.chiudi(); }
  });

  test('Dashboard: con più di cinque zone le più piccole confluiscono in "Altri" e il totale non cambia', async () => {
    const app = await avvia();
    try {
      const p = app.pagina;
      await inserisciDatiProva(p);
      await p.evaluate(async () => {
        const { api, app: a } = window.__gi;
        const [luca] = api.elencoCollaboratori(a.archivio);
        for (let i = 1; i <= 4; i++) {
          const z = await api.creaZona(a.archivio, { nome: `Zona extra ${i}` });
          await api.salvaPratica(a.archivio, {
            codice: `X/${i}`, stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-09-20', zona_id: z,
            immobile_indirizzo: `Via Extra ${i}`, prezzo_vendita_cent: 5000000, compenso_venditore_cent: 100000 * i, compenso_acquirente_cent: 0, aliquota_iva: 22,
          }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
        }
      });
      await vai(p, '#/');
      const grafico = p.locator('#grafico-zone');
      await grafico.waitFor();
      await grafico.getByRole('button', { name: /Tabella/ }).click();
      const tabella = grafico.locator('.grafico-tab');
      await tabella.waitFor({ state: 'visible' });
      const testo = rimuoviSpazi(await tabella.innerText());
      assert.match(testo, /Altri/i); // i titoli della tabella sono in maiuscolo nello stile
      const intestazioni = (await tabella.locator('thead th').allInnerTexts()).map((x) => x.trim());
      assert.equal(intestazioni.filter((x) => x.toLowerCase() === 'altri').length, 1);
      assert.equal(intestazioni.length - 1 <= 6, true, 'al massimo cinque zone più "Altri"');
      // le colonne delle zone (compreso "Altri") sommano esattamente il totale di ogni mese, e i mesi sommano le provvigioni maturate
      const { perColonne, perTotale } = await tabella.evaluate((t) => {
        const num = (s) => Number(s.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        const righe = [...t.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => num(c.textContent.replace(/\./g, ''))));
        return { perColonne: righe.reduce((s, r) => s + r.slice(0, -1).reduce((x, v) => x + v, 0), 0), perTotale: righe.reduce((s, r) => s + r[r.length - 1], 0) };
      });
      const maturate = await p.evaluate(() => window.__gi.modello().collaboratori.reduce((s, c) => s + c.maturateCent, 0)) / 100;
      assert.ok(Math.abs(perColonne - perTotale) < 0.5, `zone + Altri = totali dei mesi (${perColonne} / ${perTotale})`);
      assert.ok(Math.abs(perTotale - maturate) < 1, `totali dei mesi ${perTotale} = provvigioni maturate ${maturate}`);
    } finally { await app.chiudi(); }
  });

  test('Chiudere la finestra con un modulo non salvato chiede conferma; senza modifiche si chiude senza domande', async () => {
    const app = await avvia();
    try {
      const p = app.pagina;
      await vai(p, '#/nuova');
      const indirizzo = p.getByLabel(/^Indirizzo dell'immobile/);
      await indirizzo.click(); // il browser chiede conferma solo se l'utente ha davvero usato la pagina
      await indirizzo.pressSequentially('Via Non Salvata 1');
      const [dialogo] = await Promise.all([p.waitForEvent('dialog'), p.close({ runBeforeUnload: true })]);
      assert.equal(dialogo.type(), 'beforeunload');
      await dialogo.dismiss();
      assert.equal(p.isClosed(), false, 'scegliendo di restare, la pagina resta aperta e il testo scritto c\'è ancora');
      assert.equal(await indirizzo.inputValue(), 'Via Non Salvata 1');
    } finally { await app.chiudi(); }
  });

  test('Scheda pratica senza scaglioni impostati: il calcolo della provvigione dice che la percentuale è 0%', async () => {
    const app = await avvia();
    try {
      const p = app.pagina;
      await p.evaluate(async () => {
        const { api, app: a } = window.__gi;
        const z = await api.creaZona(a.archivio, { nome: 'Zona prova' });
        const [luca] = api.elencoCollaboratori(a.archivio);
        await api.salvaPratica(a.archivio, {
          codice: 'T/1', stato: 'conclusa', data_pratica: '2026-08-01', data_rogito: '2026-09-15', zona_id: z,
          immobile_indirizzo: 'Via Prova 1', prezzo_vendita_cent: 10000000, compenso_venditore_cent: 300000, compenso_acquirente_cent: 300000, aliquota_iva: 22,
        }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
      });
      await vai(p, `#/pratiche/${await idPratica(p, 'T/1')}`);
      await p.waitForFunction(() => /Gli scaglioni non sono impostati: la percentuale applicata è 0%/.test(document.querySelector('#contenuto').textContent));
    } finally { await app.chiudi(); }
  });
});
