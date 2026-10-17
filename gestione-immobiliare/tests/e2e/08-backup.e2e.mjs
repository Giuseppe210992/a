// Backup e archivio storico: creare, esportare, importare, ripristinare, eliminare copie, verificare l'integrità, azzerare.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  avvia, vai, rimuoviSpazi, sql, valoreSql, finestra, bottoneFinestra, attendiNotifica, testoSospetto, scarica, apriSqlite, riquadri, cartellaTemp,
} from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;
const copie = (p) => p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).map((c) => ({ id: c.id, tipo: c.tipo, dimensione: c.dimensione, creatoIl: c.creatoIl })));
const righeStorico = (p) => p.locator('#tabella-storico tbody tr').evaluateAll((tr) => tr.map((r) => ({ id: r.dataset.copia, testo: r.innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() })));

describe('Backup e archivio storico', () => {
  let app;
  let prima;
  const cartella = cartellaTemp('gi-backup-');
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); await vai(app.pagina, '#/'); prima = await riquadri(app.pagina); });
  after(async () => { await app.chiudi(); fs.rmSync(cartella, { recursive: true, force: true }); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await vai(p, '#/backup');
    await p.waitForSelector('#bk-crea');
  });

  test('stato iniziale: dove sono i dati, cosa contengono, nessun backup ancora, integrità in ordine', async () => {
    const p = app.pagina;
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Nessun backup ancora eseguito/);
    assert.match(t, /Nel file gi-dati\/Dati\/archivio\.sqlite/);
    assert.match(t, /15 pratiche · 4 incassi · 3 liquidazioni/);
    assert.match(t, /Copie nell'archivio storico 0/);
    assert.match(t, /Nel browser non resta nessuna traccia/);
    assert.match(t, /Tutto in ordine/);
    const controlli = await p.$$eval('#integrita .controllo', (a) => a.map((x) => ({ ok: x.classList.contains('ok'), testo: x.textContent.trim() })));
    assert.ok(controlli.length >= 4);
    assert.ok(controlli.every((c) => c.ok), `controlli di integrità: ${JSON.stringify(controlli)}`);
    assert.match(t, /Ancora nessuna copia/);
    assert.equal(await p.locator('#bk-crea, #bk-esporta, #bk-importa, #bk-csv, #bk-verifica, #bk-azzera').count(), 6);
  });

  test('"Crea un backup ora": la copia compare nell\'archivio storico e lo stato diventa "protetti"', async () => {
    const p = app.pagina;
    await p.click('#bk-crea');
    await attendiNotifica(p, /Backup creato \(\d/);
    await p.waitForFunction(() => document.querySelector('#tabella-storico') !== null);
    const righe = await righeStorico(p);
    assert.equal(righe.length, 1);
    assert.match(righe[0].testo, /^16\/10\/2026 \d\d:\d\d Manuale \d/);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /I tuoi dati sono protetti/);
    assert.match(t, /Ultimo backup: 16\/10\/2026 \d\d:\d\d \(oggi\)/);
    assert.match(t, /Copie nell'archivio storico 1/);
    // il contenuto della copia è l'archivio completo
    const bytes = await p.evaluate(async (id) => Array.from(await window.__gi.app.driver.leggiCopia(id)), righe[0].id);
    const db = await apriSqlite(Uint8Array.from(bytes));
    assert.equal(db.valore('SELECT COUNT(*) FROM pratiche'), 15);
    db.chiudi();
  });

  test('esportare l\'archivio completo scarica un file valido; la copia dello storico si esporta come file', async () => {
    const p = app.pagina;
    const file = await scarica(p, () => p.click('#bk-esporta'));
    assert.match(file.nome, /^GestioneImmobiliare_esportazione_2026-10-16_\d{4}\.sqlite$/);
    const db = await apriSqlite(file.bytes);
    assert.equal(db.valore('SELECT COUNT(*) FROM pratiche'), 15);
    assert.equal(db.valore('PRAGMA integrity_check'), 'ok');
    db.chiudi();
    await attendiNotifica(p, /Archivio esportato \(/);
    const riga = (await righeStorico(p))[0];
    const copia = await scarica(p, () => p.locator(`#tabella-storico tr[data-copia="${riga.id}"] button[aria-label^="Esporta la copia"]`).click());
    assert.match(copia.nome, /^GestioneImmobiliare_backup_2026-10-16_\d{4}\.sqlite$/);
    assert.equal(Buffer.from(copia.bytes.subarray(0, 15)).toString('latin1'), 'SQLite format 3');
    await attendiNotifica(p, /Copia esportata/);
  });

  test('"Esporta in CSV" apre la scelta dei file; "Verifica l\'integrità" conferma che è tutto a posto', async () => {
    const p = app.pagina;
    await p.click('#bk-csv');
    assert.match(rimuoviSpazi(await finestra(p).innerText()), /Esporta i dati/);
    await bottoneFinestra(p, 'Annulla').click();
    await p.click('#bk-verifica');
    await attendiNotifica(p, /Verifica completata: nessun problema/);
  });

  test('ripristino: la conferma mostra cosa contiene la copia, Annulla non cambia nulla, Ripristina riporta lo stato e salva prima i dati attuali', async () => {
    const p = app.pagina;
    // stato S0 = quello della copia scelta; poi si aggiunge una pratica
    const copiaS0 = (await righeStorico(p)).find((r) => /Manuale/.test(r.testo));
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      await api.salvaPratica(app.archivio, { codice: 'DOPO-1', stato: 'in_corso', data_pratica: '2026-10-15', immobile_indirizzo: 'Via Dopo il Backup 1' }, []);
    });
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 16);
    const n0 = (await copie(p)).length;
    await p.locator(`#tabella-storico tr[data-copia="${copiaS0.id}"]`).getByRole('button', { name: 'Ripristina' }).click();
    const f = finestra(p);
    await f.waitFor();
    const t = rimuoviSpazi(await f.innerText());
    assert.match(t, /Ripristinare questa copia\?/);
    assert.match(t, /La copia contiene 15 pratiche, 4 incassi e 3 liquidazioni \(pratiche dal 14\/01\/2026 al /);
    assert.match(t, /Prima del ripristino viene salvata automaticamente una copia dei dati di adesso/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 16, 'Annulla: nulla cambia');
    assert.equal((await copie(p)).length, n0);
    await p.locator(`#tabella-storico tr[data-copia="${copiaS0.id}"]`).getByRole('button', { name: 'Ripristina' }).click();
    await bottoneFinestra(p, 'Ripristina questa copia').click();
    await attendiNotifica(p, /Dati ripristinati: 15 pratiche/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 15);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM pratiche WHERE codice = 'DOPO-1'"), 0);
    const dopo = await copie(p);
    assert.equal(dopo.length, n0 + 1);
    assert.ok(dopo.some((c) => c.tipo === 'pre-ripristino'), 'copia di sicurezza "prima di un ripristino"');
    // lo storico mostra la nuova copia e il registro la nota
    await p.waitForFunction((n) => document.querySelectorAll('#tabella-storico tbody tr').length === n, n0 + 1);
    assert.match(rimuoviSpazi(await p.locator('#tabella-storico').innerText()), /Prima di un ripristino/);
    // si può tornare indietro: ripristinando la copia "prima del ripristino" ricompare la pratica
    const pre = (await righeStorico(p)).find((r) => /Prima di un ripristino/.test(r.testo));
    await p.locator(`#tabella-storico tr[data-copia="${pre.id}"]`).getByRole('button', { name: 'Ripristina' }).click();
    assert.match(rimuoviSpazi(await f.innerText()), /La copia contiene 16 pratiche/);
    await bottoneFinestra(p, 'Ripristina questa copia').click();
    await attendiNotifica(p, /Dati ripristinati: 16 pratiche/);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM pratiche WHERE codice = 'DOPO-1'"), 1);
    // ripulisco
    await p.evaluate(async () => { const { api, app } = window.__gi; await api.eliminaPratica(app.archivio, app.archivio.valore("SELECT id FROM pratiche WHERE codice = 'DOPO-1'")); });
    await vai(p, '#/');
    assert.deepEqual(await riquadri(p), prima);
  });

  test('registro delle attività: ripristini, importazioni ed eliminazioni restano annotati', async () => {
    const p = app.pagina;
    await p.locator('details:has(summary:has-text("Registro delle attività importanti")) summary').click();
    const t = rimuoviSpazi(await p.locator('details:has(summary:has-text("Registro")) table').innerText());
    assert.match(t, /Ripristino di un backup/);
    assert.match(t, /Pratica eliminata DOPO-1/);
    assert.match(t, /Archivio creato/);
  });

  test('si elimina una copia solo dopo conferma', async () => {
    const p = app.pagina;
    const prima0 = await copie(p);
    const riga = (await righeStorico(p)).find((r) => /Prima di un ripristino/.test(r.testo));
    await p.locator(`#tabella-storico tr[data-copia="${riga.id}"] button[aria-label^="Elimina la copia"]`).click();
    const f = finestra(p);
    assert.match(rimuoviSpazi(await f.innerText()), /Eliminare questa copia\?/);
    assert.match(rimuoviSpazi(await f.innerText()), /verrà eliminata definitivamente/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal((await copie(p)).length, prima0.length);
    await p.locator(`#tabella-storico tr[data-copia="${riga.id}"] button[aria-label^="Elimina la copia"]`).click();
    await bottoneFinestra(p, 'Elimina la copia').click();
    await attendiNotifica(p, /Copia eliminata/);
    assert.equal((await copie(p)).length, prima0.length - 1);
    await p.waitForFunction((n) => document.querySelectorAll('#tabella-storico tbody tr').length === n, prima0.length - 1);
  });

  test('importa da questa pagina: file non valido rifiutato, file valido sostituisce i dati con copia di sicurezza', async () => {
    const p = app.pagina;
    const falso = path.join(cartella, 'sbagliato.sqlite');
    fs.writeFileSync(falso, Buffer.alloc(300, 7));
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bk-importa')]);
    await fc.setFiles(falso);
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Il file non può essere importato/);
    await bottoneFinestra(p, 'Ho capito').click();
    // archivio con 1 sola pratica, creato con lo stesso motore
    const buono = path.join(cartella, 'piccolo.sqlite');
    const c = await avvia();
    try {
      await c.pagina.evaluate(async () => {
        const { api, app } = window.__gi;
        const z = await api.creaZona(app.archivio, { nome: 'Altrove' });
        await api.salvaPratica(app.archivio, { codice: 'X-1', stato: 'in_corso', data_pratica: '2026-10-01', zona_id: z, immobile_indirizzo: 'Via Importata 1' }, []);
      });
      const bytes = await c.pagina.evaluate(() => Array.from(window.__gi.app.archivio.esporta()));
      fs.writeFileSync(buono, Buffer.from(bytes));
    } finally { await c.chiudi(); }
    const n0 = (await copie(p)).length;
    const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bk-importa')]);
    await fc2.setFiles(buono);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Il file contiene 1 pratiche, 2 collaboratori, 1 zone, 0 incassi e 0 liquidazioni/);
    await bottoneFinestra(p, 'Sostituisci i dati').click();
    await attendiNotifica(p, /Importazione completata: 1 pratiche caricate/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 1);
    assert.equal(await valoreSql(p, 'SELECT immobile_indirizzo FROM pratiche'), 'Via Importata 1');
    assert.equal((await copie(p)).length, n0 + 1);
    assert.ok((await copie(p)).some((x) => x.tipo === 'pre-importazione'));
    // e si torna indietro dall'archivio storico
    await p.waitForFunction(() => /Prima di un'importazione/.test(document.querySelector('#tabella-storico')?.textContent ?? ''));
    const pre = (await righeStorico(p)).find((r) => /Prima di un'importazione/.test(r.testo));
    await p.locator(`#tabella-storico tr[data-copia="${pre.id}"]`).getByRole('button', { name: 'Ripristina' }).click();
    await bottoneFinestra(p, 'Ripristina questa copia').click();
    await attendiNotifica(p, /Dati ripristinati: 15 pratiche/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 15);
  });

  test('"Cancella tutti i dati": serve scrivere CANCELLA, la copia di sicurezza viene salvata, i collaboratori iniziali restano', async () => {
    const p = app.pagina;
    const n0 = (await copie(p)).length;
    await p.click('#bk-azzera');
    const f = finestra(p);
    await f.waitFor();
    const conferma = bottoneFinestra(p, 'Cancella tutto');
    assert.equal(await conferma.isDisabled(), true, 'prima di scrivere la parola il pulsante è spento');
    assert.match(rimuoviSpazi(await f.innerText()), /Per confermare scrivi CANCELLA/);
    await f.getByLabel('Scrivi CANCELLA per confermare').fill('cancel');
    assert.equal(await conferma.isDisabled(), true);
    await f.getByLabel('Scrivi CANCELLA per confermare').fill('CANCELLA');
    assert.equal(await conferma.isDisabled(), false);
    // si può ancora cambiare idea
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 15);
    await p.click('#bk-azzera');
    await f.getByLabel('Scrivi CANCELLA per confermare').fill('cancella');
    await bottoneFinestra(p, 'Cancella tutto').click();
    await attendiNotifica(p, /Archivio azzerato/);
    assert.deepEqual(await sql(p, 'SELECT (SELECT COUNT(*) FROM pratiche) AS pratiche, (SELECT COUNT(*) FROM zone) AS zone, (SELECT COUNT(*) FROM incassi) AS incassi, (SELECT COUNT(*) FROM liquidazioni) AS liq, (SELECT COUNT(*) FROM scaglioni) AS scaglioni'),
      [{ pratiche: 0, zone: 0, incassi: 0, liq: 0, scaglioni: 5 }]); // gli scaglioni tornano quelli dell'agenzia (5 righe)
    assert.deepEqual((await sql(p, 'SELECT da_cent, percentuale FROM scaglioni WHERE zona_id IS NULL ORDER BY da_cent')).map((r) => `${r.da_cent}/${r.percentuale}`), ['0/5', '260001/8', '520001/11', '780001/15', '1300001/20']);
    assert.deepEqual((await sql(p, 'SELECT nome FROM collaboratori ORDER BY id')).map((r) => r.nome), ['Luca', 'Giuseppe', 'Capo', 'Segretaria']);
    const dopo = await copie(p);
    assert.equal(dopo.length, n0 + 1);
    assert.ok(dopo.some((c) => c.tipo === 'pre-azzeramento'));
    // dalla copia di sicurezza si recupera tutto
    await p.waitForFunction(() => /Prima dell'azzeramento/.test(document.querySelector('#tabella-storico')?.textContent ?? ''));
    const riga = (await righeStorico(p)).find((r) => /Prima dell'azzeramento/.test(r.testo));
    await p.locator(`#tabella-storico tr[data-copia="${riga.id}"]`).getByRole('button', { name: 'Ripristina' }).click();
    await bottoneFinestra(p, 'Ripristina questa copia').click();
    await attendiNotifica(p, /Dati ripristinati: 15 pratiche/);
    await vai(p, '#/');
    assert.deepEqual(await riquadri(p), prima);
  });

  test('incongruenze (non errori): un incasso oltre il dovuto compare tra le segnalazioni e negli avvisi', async () => {
    const p = app.pagina;
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const id = app.archivio.valore("SELECT id FROM pratiche WHERE codice = '2026/001'");
      await api.registraIncasso(app.archivio, { praticaId: id, data: '2026-10-10', importoCent: 100000 }); // 001 era già saldata
    });
    await vai(p, '#/backup');
    await p.click('#bk-verifica');
    await attendiNotifica(p, /Verifica completata: \d+ segnalazion/);
    const t = rimuoviSpazi(await p.locator('#integrita').innerText());
    assert.match(t, /da controllare/);
    assert.match(t, /2026\/001/);
    await vai(p, '#/');
    await p.waitForSelector('#avvisi .avviso');
    assert.match(rimuoviSpazi(await p.locator('#avvisi').innerText()), /Incongruenze da controllare nei dati/);
    await p.evaluate(async () => {
      const { api, app } = window.__gi;
      const i = app.archivio.valore("SELECT id FROM incassi WHERE data = '2026-10-10'");
      await api.eliminaIncasso(app.archivio, i);
    });
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
