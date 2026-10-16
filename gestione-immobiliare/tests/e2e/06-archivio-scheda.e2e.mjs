// Archivio pratiche (ricerca, filtri, ordinamento, pagine, azioni, eliminazione con conferma) e scheda della pratica.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto, scarica, leggiCsv, riquadri,
} from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const celle = (p, selettore = '#tabella-archivio tbody tr') => p.locator(selettore).evaluateAll((tr) => tr.map((r) => [...r.children].map((c) => c.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())));
const codici = async (p) => (await celle(p)).map((r) => r[0].replace(/\s*Dati$/, ''));

describe('Archivio pratiche', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await vai(p, '#/pratiche');
    await p.waitForSelector('#tabella-archivio, .vuoto');
  });

  test('elenco: colonne, conteggio e contenuto delle righe', async () => {
    const p = app.pagina;
    assert.match(rimuoviSpazi(await p.locator('#contenuto .pagina-testa p').innerText()), /^15 pratiche$/);
    const intest = await p.$$eval('#tabella-archivio thead th', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(intest.slice(0, 9).map((x) => x.replace(/[▲▼]/g, '')), ['Codice', 'Data', 'Immobile', 'Zona', 'Stato', 'Collaboratori', 'Prezzo vendita', 'Compensi', 'Incassato']);
    const righe = await celle(p);
    assert.equal(righe.length, 15);
    const r11 = righe.find((r) => r[0].startsWith('2026/011'));
    assert.equal(r11[1], '09/10/2026');
    assert.match(r11[2], /^Via Mazzini 9 Minturno · Appartamento/);
    assert.match(r11[2], /Ven\. Venditore 11 · Acq\. Acquirente 11/);
    assert.deepEqual([r11[3], r11[4], r11[5]], ['Centro', 'Conclusa', 'Luca']);
    assert.match(r11[2] + r11[6], /200\.000/, 'il prezzo di vendita compare (in colonna o accanto all\'immobile se lo spazio è poco)');
    assert.equal(r11[7], '8.000,00 €');
    assert.match(r11[8], /^0,00 €/);
    const r03 = righe.find((r) => r[0].startsWith('2026/003'));
    assert.equal(r03[5], 'Luca 50% Giuseppe 50%');
    assert.match(r03[8], /^4\.636,00 € 100% di 4\.636 €$/);
    const r14 = righe.find((r) => r[0].startsWith('2026/014'));
    assert.equal(r14[3], 'Da indicare');
    assert.equal(r14[4], 'In corso');
    assert.equal(r14[5], '—');
    assert.match(righe.find((r) => r[0].startsWith('2026/015'))[0], /Dati$/, 'la pratica incompleta ha il segnalino "Dati"');
    // ordine iniziale: data decrescente
    assert.deepEqual((await codici(p)).slice(0, 4), ['2026/012', '2026/011', '2026/013', '2026/010']);
    assert.equal((await codici(p)).at(-1), '2026/001');
    assert.equal(rimuoviSpazi(await p.locator('#tabella-archivio thead th[aria-sort="descending"]').innerText()).replace(/\s/g, '').toLowerCase(), 'data▼');
    assert.equal(await p.locator('#tabella-archivio thead th[aria-sort="ascending"]').count(), 0);
  });

  test('ordinamento: un clic sull\'intestazione ordina, un secondo clic inverte', async () => {
    const p = app.pagina;
    await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Codice' }).click();
    assert.deepEqual((await codici(p)).slice(0, 3), ['2026/001', '2026/002', '2026/003']);
    assert.equal(await p.locator('#tabella-archivio thead th[aria-sort="ascending"]').count(), 1);
    assert.match(await p.evaluate(() => location.hash), /ord=codice/);
    await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Codice' }).click();
    assert.deepEqual((await codici(p)).slice(0, 3), ['2026/015', '2026/014', '2026/013']);
    // compensi (imponibile) dal più alto: 008 12.800 €, 005 10.400 €, 012 9.200 €
    await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Compensi' }).click();
    assert.deepEqual((await codici(p)).slice(0, 3), ['2026/008', '2026/005', '2026/012']);
    await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Compensi' }).click();
    assert.deepEqual((await codici(p)).slice(0, 3), ['2026/014', '2026/015', '2026/009']);
    await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Zona' }).click();
    assert.equal((await celle(p))[0][3], 'Centro');
    assert.equal((await celle(p)).at(-1)[3], 'Da indicare', 'le pratiche senza zona vanno in fondo');
    await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Stato' }).click();
    assert.equal((await celle(p))[0][4], 'Conclusa');
    // il colonna Collaboratori non si ordina
    assert.equal(await p.locator('#tabella-archivio thead').getByRole('button', { name: 'Collaboratori' }).count(), 0);
  });

  test('ricerca: per codice, via, cliente, comune; più parole; evidenziazione; Esc cancella', async () => {
    const p = app.pagina;
    const cerca = p.locator('#arch-q');
    const attendiCodici = (...attesi) => p.waitForFunction((a) => {
      const c = [...document.querySelectorAll('#tabella-archivio tbody tr')].map((r) => r.children[0].textContent.trim().replace(/Dati$/, ''));
      return c.length === a.length && a.every((x) => c.includes(x));
    }, attesi);
    await cerca.fill('garibaldi');
    await attendiCodici('2026/003');
    assert.ok(await p.locator('#tabella-archivio mark').count() > 0, 'la parola cercata è evidenziata');
    assert.match(await p.evaluate(() => location.hash), /q=garibaldi/);
    assert.match(rimuoviSpazi(await p.locator('#contenuto .pagina-testa p').innerText()), /^1 pratica su 15$/);
    await cerca.fill('acquirente 11'); // tutte le parole devono comparire: 'acquirente' e '11'
    await attendiCodici('2026/011');
    await cerca.fill('minturno');
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 13);
    await cerca.fill('via roma');
    await attendiCodici('2026/001');
    await cerca.fill('2026/01'); // codici dal 010 al 015
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 6);
    await cerca.fill('ACCENTI è maiuscole'); // nessun risultato e messaggio
    await p.waitForSelector('.vuoto:has-text("Nessuna pratica corrisponde")');
    await p.getByRole('button', { name: 'Azzera i filtri' }).click();
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 15);
    assert.equal(await cerca.inputValue(), '');
    await cerca.fill('lungomare');
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 5); // 002, 005, 008 + zone Lungomare (012, 015)
    await cerca.press('Escape');
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 15);
  });

  test('filtri per stato, zona, collaboratore, anno e dati mancanti, anche combinati', async () => {
    const p = app.pagina;
    const quanti = (n) => p.waitForFunction((x) => document.querySelectorAll('#tabella-archivio tbody tr').length === x, n);
    await p.selectOption('#arch-stato', 'in_corso');
    await quanti(2);
    assert.deepEqual((await codici(p)).sort(), ['2026/013', '2026/014']);
    await p.selectOption('#arch-stato', 'conclusa');
    await quanti(13);
    await p.selectOption('#arch-zona', { label: 'Collina' });
    await quanti(2);
    assert.deepEqual((await codici(p)).sort(), ['2026/004', '2026/009']);
    await p.selectOption('#arch-zona', '');
    await p.selectOption('#arch-stato', '');
    await p.selectOption('#arch-collab', { label: 'Giuseppe' });
    await quanti(7);
    await p.selectOption('#arch-collab', { label: 'Luca' });
    await quanti(9); // 001 003 004 006 007 009 010 011 013
    await p.selectOption('#arch-zona', { label: 'Centro' });
    await quanti(7); // senza la 004 e la 009 (Collina)
    await p.selectOption('#arch-collab', '');
    await p.selectOption('#arch-zona', '');
    await p.selectOption('#arch-anno', '2026');
    await quanti(15);
    assert.deepEqual(await p.locator('#arch-anno option').allInnerTexts(), ['Tutti gli anni', '2026']);
    await p.selectOption('#arch-anno', '');
    // solo pratiche incomplete: la 015 (senza rogito né prezzo) e quelle in corso senza dati essenziali
    await p.locator('#arch-inc').check();
    const incomplete = await p.evaluate(() => window.__gi.modello().pratiche.filter((x) => x.incompleta).map((x) => x.codice).sort());
    assert.ok(incomplete.includes('2026/015'));
    assert.ok(!incomplete.includes('2026/001'));
    await quanti(incomplete.length);
    assert.deepEqual((await codici(p)).sort(), incomplete);
    assert.match(await p.evaluate(() => location.hash), /incomplete=1/);
    await p.locator('#arch-inc').uncheck();
    await quanti(15);
  });

  test('i filtri restano nell\'indirizzo: ricaricando la pagina ritornano uguali', async () => {
    const p = app.pagina;
    await p.selectOption('#arch-zona', { label: 'Lungomare' });
    await p.selectOption('#arch-stato', 'conclusa');
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 5);
    const hash = await p.evaluate(() => location.hash);
    assert.match(hash, /zona=\d+/);
    assert.match(hash, /stato=conclusa/);
    await p.reload();
    await p.waitForFunction(() => window.__gi?.app?.archivio);
    await p.waitForSelector('#tabella-archivio');
    assert.equal(await p.locator('#arch-stato').inputValue(), 'conclusa');
    assert.equal(await p.locator('#arch-zona option:checked').innerText(), 'Lungomare');
    assert.equal(await p.locator('#tabella-archivio tbody tr').count(), 5);
  });

  test('un clic sulla riga o sul codice apre la scheda; il menu offre le azioni', async () => {
    const p = app.pagina;
    await p.locator('#tabella-archivio tbody tr', { hasText: '2026/005' }).locator('td').nth(7).click();
    await p.waitForSelector('#contenuto h1:has-text("Via del Mare 21")');
    await vai(p, '#/pratiche');
    await p.locator('#tabella-archivio tbody tr', { hasText: '2026/006' }).getByRole('link', { name: '2026/006' }).click();
    await p.waitForSelector('#contenuto h1:has-text("Corso Vittorio 40")');
    await vai(p, '#/pratiche');
    const riga = p.locator('#tabella-archivio tbody tr', { hasText: '2026/007' });
    await riga.getByRole('button', { name: 'Azioni per la pratica 2026/007' }).click();
    const voci = await p.locator('.popover [role="menuitem"]').allInnerTexts();
    assert.deepEqual(voci.map((x) => x.trim()), ['Apri la scheda', 'Modifica', 'Registra un incasso', 'Elimina…']);
    await p.getByRole('menuitem', { name: 'Modifica' }).click();
    await p.waitForSelector('#contenuto h1:has-text("Modifica pratica 2026/007")');
    await vai(p, '#/pratiche');
    await riga.getByRole('button', { name: 'Azioni per la pratica 2026/007' }).click();
    await p.getByRole('menuitem', { name: 'Registra un incasso' }).click();
    const f = finestra(p);
    await f.waitFor();
    assert.match(await f.locator('select').first().locator('option:checked').innerText(), /^2026\/007 — Via Appia 100/);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('la pagina mostra 25 pratiche per volta e permette di sfogliare', async () => {
    const p = app.pagina;
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const zona = app.archivio.valore("SELECT id FROM zone WHERE nome = 'Centro'");
      for (let i = 0; i < 12; i++) {
        await api.salvaPratica(app.archivio, { codice: `P-${String(i + 1).padStart(2, '0')}`, stato: 'in_corso', data_pratica: '2026-01-05', zona_id: zona, immobile_indirizzo: `Via Pagina ${i + 1}` }, []);
      }
    });
    try {
      await vai(p, '#/pratiche');
      assert.equal(await p.locator('#tabella-archivio tbody tr').count(), 25);
      assert.match(rimuoviSpazi(await p.locator('.paginazione').innerText()), /Pratiche 1–25 di 27.*Pagina 1 di 2/);
      assert.equal(await p.getByRole('button', { name: 'Precedente' }).isDisabled(), true);
      await p.getByRole('button', { name: 'Successiva' }).click();
      await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 2);
      assert.match(rimuoviSpazi(await p.locator('.paginazione').innerText()), /Pratiche 26–27 di 27.*Pagina 2 di 2/);
      assert.equal(await p.getByRole('button', { name: 'Successiva' }).isDisabled(), true);
      assert.match(await p.evaluate(() => location.hash), /pag=2/);
      await p.getByRole('button', { name: 'Precedente' }).click();
      await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 25);
      // un filtro riporta alla prima pagina
      await p.getByRole('button', { name: 'Successiva' }).click();
      await p.selectOption('#arch-stato', 'in_corso');
      await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 14);
      assert.equal(await p.locator('.paginazione').count(), 0);
    } finally {
      await p.evaluate(async () => {
        const { api, app } = window.__gi;
        for (const r of app.archivio.tutti("SELECT id FROM pratiche WHERE codice LIKE 'P-%'")) await api.eliminaPratica(app.archivio, r.id);
      });
    }
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 15);
  });

  test('"Esporta l\'elenco" esporta solo le pratiche filtrate', async () => {
    const p = app.pagina;
    await p.selectOption('#arch-zona', { label: 'Collina' });
    await p.waitForFunction(() => document.querySelectorAll('#tabella-archivio tbody tr').length === 2);
    const file = await scarica(p, () => p.getByRole('button', { name: 'Esporta l\'elenco' }).click());
    assert.match(file.nome, /^Pratiche_2026-10-16\.csv$/);
    const csv = leggiCsv(file.bytes);
    assert.deepEqual(csv.righe.map((r) => r[0]).sort(), ['2026/004', '2026/009']);
    await attendiNotifica(p, /2 pratiche esportate in CSV/);
  });

  test('eliminazione: chiede conferma, mostra cosa verrà eliminato, e Annulla non tocca nulla', async () => {
    const p = app.pagina;
    // pratica di prova con un incasso (non toccare le 15 pratiche dei dati di prova)
    const id = await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const [luca] = api.elencoCollaboratori(app.archivio);
      const nuova = await api.salvaPratica(app.archivio, { codice: 'DEL-1', stato: 'in_corso', data_pratica: '2026-10-01', immobile_indirizzo: 'Via da Eliminare 1', compenso_venditore_cent: 100000 }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
      await api.registraIncasso(app.archivio, { praticaId: nuova, data: '2026-10-02', importoCent: 50000 });
      return nuova;
    });
    await vai(p, '#/pratiche');
    const riga = p.locator('#tabella-archivio tbody tr', { hasText: 'DEL-1' });
    await riga.getByRole('button', { name: 'Azioni per la pratica DEL-1' }).click();
    await p.getByRole('menuitem', { name: 'Elimina…' }).click();
    const f = finestra(p);
    await f.waitFor();
    const t = rimuoviSpazi(await f.innerText());
    assert.match(t, /Eliminare la pratica DEL-1\?/);
    assert.match(t, /Via da Eliminare 1/);
    assert.match(t, /Verrà eliminato anche 1 incasso registrato \(500,00 €\)|Verranno eliminati anche 1 incasso registrato \(500,00 €\)/);
    assert.match(t, /ripartizione tra collaboratori/);
    assert.match(t, /L'operazione non si può annullare/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM pratiche WHERE codice = 'DEL-1'"), 1);
    // ora si conferma
    await riga.getByRole('button', { name: 'Azioni per la pratica DEL-1' }).click();
    await p.getByRole('menuitem', { name: 'Elimina…' }).click();
    await bottoneFinestra(p, 'Elimina la pratica').click();
    await attendiNotifica(p, /Pratica DEL-1 eliminata/);
    await p.waitForFunction(() => !document.querySelector('#tabella-archivio').textContent.includes('DEL-1'));
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM pratiche WHERE codice = 'DEL-1'"), 0);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi WHERE pratica_id = ?', [id]), 0, 'gli incassi della pratica sono stati eliminati');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM quote WHERE pratica_id = ?', [id]), 0);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 4);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM registro WHERE tipo = 'pratica_eliminata' AND dettaglio LIKE 'DEL-1 %'"), 1, 'l\'eliminazione resta nel registro');
  });

  test('una pratica con liquidazioni non si elimina: si può segnare come annullata', async () => {
    const p = app.pagina;
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const [luca] = api.elencoCollaboratori(app.archivio);
      const nuova = await api.salvaPratica(app.archivio, { codice: 'LIQ-1', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-09-20', immobile_indirizzo: 'Via Liquidata 5', compenso_venditore_cent: 100000 }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
      await api.registraLiquidazione(app.archivio, { collaboratoreId: luca.id, data: '2026-09-25', righe: [{ praticaId: nuova, importoCent: 1000 }] });
    });
    await vai(p, '#/');
    const prima = await riquadri(p);
    await vai(p, '#/pratiche');
    const riga = p.locator('#tabella-archivio tbody tr', { hasText: 'LIQ-1' });
    await riga.getByRole('button', { name: 'Azioni per la pratica LIQ-1' }).click();
    await p.getByRole('menuitem', { name: 'Elimina…' }).click();
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Questa pratica non si può eliminare/);
    assert.match(rimuoviSpazi(await f.innerText()), /ha una liquidazione registrata/);
    await bottoneFinestra(p, 'Segna come annullata').click();
    await attendiNotifica(p, /Pratica LIQ-1 segnata come annullata/);
    assert.equal(await valoreSql(p, "SELECT stato FROM pratiche WHERE codice = 'LIQ-1'"), 'annullata');
    await p.waitForFunction(() => /Annullata/.test([...document.querySelectorAll('#tabella-archivio tbody tr')].find((r) => r.textContent.includes('LIQ-1'))?.textContent ?? ''));
    // fuori dai totali della dashboard
    await vai(p, '#/');
    assert.equal((await riquadri(p)).concluse, prima.concluse - 1, 'la pratica annullata non conta tra le concluse');
    // ripulisco
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const id = app.archivio.valore("SELECT id FROM pratiche WHERE codice = 'LIQ-1'");
      const liq = app.archivio.tutti('SELECT DISTINCT liquidazione_id AS id FROM liquidazioni_righe WHERE pratica_id = ?', [id]);
      for (const l of liq) await api.eliminaLiquidazione(app.archivio, l.id);
      await api.eliminaPratica(app.archivio, id);
    });
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 15);
  });

  test('archivio vuoto: messaggio e invito a inserire la prima pratica', async () => {
    const c = await avvia();
    try {
      await vai(c.pagina, '#/pratiche');
      const t = rimuoviSpazi(await c.pagina.locator('#contenuto').innerText());
      assert.match(t, /Nessuna pratica inserita/);
      assert.match(t, /L'archivio è vuoto/);
      await c.pagina.getByRole('link', { name: 'Inserisci la prima pratica' }).click();
      await c.pagina.waitForSelector('#contenuto h1:has-text("Nuova pratica")');
    } finally { await c.chiudi(); }
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});

describe('Scheda della pratica', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
  });

  test('la scheda di una pratica condivisa mostra dati, incassi, ripartizione e liquidazioni', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/003')}`);
    assert.match(rimuoviSpazi(await p.locator('#contenuto h1').innerText()), /^Via Garibaldi 8 Conclusa$/);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Pratica 2026\/003 · Minturno · Appartamento · Zona Centro/);
    assert.match(t, /Prezzo di vendita 95\.000,00 €/);
    assert.match(t, /Differenza −5\.000,00 € \(−5%\)/);
    assert.match(t, /Venditore Venditore 3/);
    assert.match(t, /Rogito 09\/03\/2026/);
    assert.match(t, /Totale imponibile 3\.800,00 €/);
    assert.match(t, /IVA 22% 836,00 €/);
    assert.match(t, /Totale con IVA 4\.636,00 €/);
    assert.match(t, /Incassato 4\.636,00 € Saldata/);
    assert.match(t, /12\/03\/2026 4\.636,00 €/);
    const righe = await celle(p, '#tabella-provvigioni tbody tr');
    assert.deepEqual(righe.map((r) => r.slice(0, 8)), [
      ['Luca', '50%', '1.900,00 €', '1° · 30%', '570,00 €', '570,00 €', '285,00 €', '285,00 €'],
      ['Giuseppe', '50%', '1.900,00 €', '1° · 30%', '570,00 €', '570,00 €', '0,00 €', '570,00 €'],
    ]);
    assert.match(t, /Liquidazioni collegate/);
    assert.match(t, /10\/05\/2026 Luca 285,00 €/);
    assert.match(t, /Cronologia Inserita/);
    // pulsanti d'azione
    for (const id of ['#btn-modifica', '#btn-incasso', '#btn-liquida']) assert.ok(await p.locator(id).isVisible(), id);
  });

  test('"Come è stata calcolata la provvigione" spiega i passaggi con i numeri reali', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/011')}`);
    const dettagli = p.locator('#come-calcolato');
    assert.equal(await dettagli.evaluate((d) => d.open), false);
    await dettagli.locator('summary').click();
    const t = rimuoviSpazi(await dettagli.innerText());
    assert.match(t, /Compenso della pratica: 4\.000,00 € dal venditore \+ 4\.000,00 € dall'acquirente = 8\.000,00 € \(imponibile, IVA esclusa\)/);
    assert.match(t, /Quota di Luca: 100% → fatturato attribuito 8\.000,00 €/);
    assert.match(t, /Cumulo di ottobre 2026 di Luca nella zona Centro: 14\.000,00 € \(2 pratiche\)/);
    assert.match(t, /Scaglione raggiunto: 2° \(da 10\.000,00 € a 19\.999,99 €\) → 35%/);
    assert.match(t, /Metodo “scaglione raggiunto”: 35% su tutto il cumulo; 8\.000,00 € × 35% = 2\.800,00 €/);
    assert.match(t, /Maturata alla conclusione della pratica: 2\.800,00 €/);
    assert.match(t, /Liquidata finora: 0,00 € → ancora da liquidare 2\.800,00 €/);
  });

  test('una pratica in corso mostra la stima delle provvigioni, dichiarandola tale', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/013')}`);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Stima: se la pratica si concludesse a ottobre 2026/);
    const righe = await celle(p, '#tabella-provvigioni tbody tr');
    assert.equal(righe[0][0], 'Luca');
    // 6.200 € si sommano al cumulo di ottobre di Luca nel Centro (6.000 + 8.000): 20.200 € → 3° scaglione, 40% → 2.480 €
    assert.equal(righe[0][3], '3° · 40%');
    assert.equal(righe[0][4], '2.480,00 €');
  });

  test('Registra incasso dalla scheda: precompilato sulla pratica, compare nell\'elenco, si modifica e si elimina', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/007')}`);
    await p.click('#btn-incasso');
    const f = finestra(p);
    await f.waitFor();
    assert.match(await f.locator('select').first().locator('option:checked').innerText(), /^2026\/007 — Via Appia 100/);
    assert.match(rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText()), /Totale dovuto \(compensi \+ IVA\) 8\.540,00 €/);
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('2.000');
    await f.getByLabel('Pagato da').selectOption({ label: 'Venditore' });
    await bottoneFinestra(p, 'Registra incasso').click();
    await attendiNotifica(p, /Incasso di 2\.000,00 € registrato sulla pratica 2026\/007/);
    await p.waitForFunction(() => /Incassato 2\.000,00/.test(document.querySelector('#contenuto').innerText.replace(/ /g, ' ')));
    assert.match(rimuoviSpazi(await p.locator('#contenuto').innerText()), /Da incassare 6\.540,00 €/);
    // modifica dell'incasso
    await p.getByRole('button', { name: /Modifica l'incasso del 16\/10\/2026/ }).click();
    await f.getByLabel('Importo (IVA inclusa)').fill('2.500,00');
    await bottoneFinestra(p, 'Salva').click();
    await attendiNotifica(p, /Incasso aggiornato/);
    await p.waitForFunction(() => /Incassato 2\.500,00/.test(document.querySelector('#contenuto').innerText.replace(/ /g, ' ')));
    assert.equal(await valoreSql(p, "SELECT importo_cent FROM incassi WHERE data = '2026-10-16'"), 250000);
    // eliminazione con conferma
    await p.getByRole('button', { name: /Elimina l'incasso del 16\/10\/2026/ }).click();
    assert.match(rimuoviSpazi(await f.innerText()), /Eliminare questo incasso\?/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM incassi WHERE data = '2026-10-16'"), 1);
    await p.getByRole('button', { name: /Elimina l'incasso del 16\/10\/2026/ }).click();
    await bottoneFinestra(p, 'Elimina incasso').click();
    await attendiNotifica(p, /Incasso eliminato/);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM incassi WHERE data = '2026-10-16'"), 0);
    await p.waitForFunction(() => /Nessun incasso registrato/.test(document.querySelector('#contenuto').innerText));
  });

  test('Liquida provvigioni dalla scheda: collaboratore e pratica già scelti', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/009')}`);
    await p.click('#btn-liquida');
    const f = finestra(p);
    await f.waitFor();
    assert.match(await f.getByLabel('Collaboratore').locator('option:checked').innerText(), /^Luca/);
    const righe = await f.locator('tbody tr').evaluateAll((tr) => tr.map((r) => ({ codice: r.children[1]?.textContent.match(/^\d{4}\/\d{3}/)?.[0], sel: r.querySelector('input[type=checkbox]')?.checked })));
    const sel = righe.filter((r) => r.sel).map((r) => r.codice);
    assert.deepEqual(sel, ['2026/009'], 'solo la pratica aperta è selezionata');
    assert.match(rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText()), /Totale della liquidazione 1\.056,00 €/);
    await bottoneFinestra(p, 'Registra liquidazione').click();
    await attendiNotifica(p, /Liquidazione di 1\.056,00 € registrata per Luca/);
    await p.waitForFunction(() => /Liquidazioni collegate[\s\S]*1\.056,00/.test(document.querySelector('#contenuto').innerText.replace(/ /g, ' ')));
    const righeProv = await celle(p, '#tabella-provvigioni tbody tr');
    assert.deepEqual([righeProv[0][6], righeProv[0][7]], ['1.056,00 €', '0,00 €']);
  });

  test('Elimina la pratica dal menu della scheda: conferma e ritorno all\'archivio', async () => {
    const p = app.pagina;
    const id = await p.evaluate(async () => {
      const { api, app } = window.__gi;
      return api.salvaPratica(app.archivio, { codice: 'DEL-2', stato: 'in_corso', data_pratica: '2026-10-10', immobile_indirizzo: 'Via Temporanea 2' }, []);
    });
    await vai(p, `#/pratiche/${id}`);
    await p.getByRole('button', { name: 'Altre azioni' }).click();
    await p.getByRole('menuitem', { name: 'Elimina la pratica…' }).click();
    await bottoneFinestra(p, 'Elimina la pratica').click();
    await attendiNotifica(p, /Pratica DEL-2 eliminata/);
    await p.waitForSelector('#contenuto h1:has-text("Archivio pratiche")');
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM pratiche WHERE codice = 'DEL-2'"), 0);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
