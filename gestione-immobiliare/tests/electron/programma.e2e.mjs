// Prova del programma Windows (Electron): si avvia davvero, salva su file, si chiude, si riapre e ritrova tutto.
// Da sorgente:      npm run test:programma   (serve "npm install" per scaricare Electron; su Linux: xvfb-run -a npm run test:programma)
// Programma pronto: GI_EXE="release/win-unpacked/Gestione Immobiliare.exe" npm run test:programma
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { inserisciDatiProva } from '../e2e/dati-prova.mjs';

const require = createRequire(import.meta.url);
const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ESEGUIBILE = process.env.GI_EXE || null;

function binarioElectron() {
  if (ESEGUIBILE) return ESEGUIBILE;
  try { return require('electron'); } catch { return null; }
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-programma-'));
const datiPercorso = path.join(base, 'dati');
const profilo = path.join(base, 'profilo');
fs.mkdirSync(profilo, { recursive: true });
const FILE_DA_IMPORTARE = path.join(base, 'da-importare.sqlite');

const argomenti = (cartellaProfilo = profilo) => (ESEGUIBILE ? [`--user-data-dir=${cartellaProfilo}`] : [RADICE, `--user-data-dir=${cartellaProfilo}`, '--no-sandbox']);
const ambiente = (extra = {}) => ({ ...process.env, GESTIONE_IMMOBILIARE_DATI: datiPercorso, GESTIONE_IMMOBILIARE_SENZA_FINESTRE: '1', ELECTRON_ENABLE_LOGGING: '1', ...extra });

async function avviaProgramma(extraAmbiente = {}, cartellaProfilo = profilo) {
  const app = await electron.launch({ executablePath: binarioElectron(), args: argomenti(cartellaProfilo), env: ambiente(extraAmbiente), timeout: 60000 });
  const finestra = await app.firstWindow({ timeout: 60000 });
  const errori = [];
  finestra.on('pageerror', (e) => errori.push(`pageerror: ${e.message}`));
  finestra.on('console', (m) => { if (m.type() === 'error') errori.push(`console: ${m.text()}`); });
  await finestra.waitForSelector('.sidebar', { state: 'attached', timeout: 60000 });
  await finestra.waitForFunction(() => window.__gi && window.__gi.app && window.__gi.app.archivio, null, { timeout: 60000 });
  return { app, finestra, errori };
}
const sql = (p, q, par = []) => p.evaluate(([qq, pp]) => window.__gi.app.archivio.tutti(qq, pp), [q, par]);
const valore = (p, q, par = []) => p.evaluate(([qq, pp]) => window.__gi.app.archivio.valore(qq, pp), [q, par]);

describe('Programma Windows (Electron)', { skip: binarioElectron() ? false : 'Electron non è installato (npm install)' }, () => {
  let s1; let s2;
  after(async () => {
    for (const s of [s1, s2]) { try { await s?.app.close(); } catch { /* già chiuso */ } }
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('si avvia, usa il file su disco e mostra l\'interfaccia senza accesso a Node', async () => {
    s1 = await avviaProgramma();
    const { finestra: p } = s1;
    assert.equal(await p.evaluate(() => window.__gi.app.hostProgramma), true, 'usa il supporto a file, non il browser');
    assert.equal(await p.evaluate(() => typeof window.require + '/' + typeof window.process + '/' + typeof window.Buffer), 'undefined/undefined/undefined', 'la pagina non ha accesso a Node');
    assert.deepEqual(await p.evaluate(() => Object.keys(window.gestionaleHost).sort()), ['archivio', 'copie', 'file', 'sistema']);
    assert.equal(await p.title(), 'Dashboard · Gestione Immobiliare');
    assert.match(await p.locator('.tb-titolo').innerText(), /Gestione Immobiliare/);
    const info = await p.evaluate(() => window.gestionaleHost.sistema.info());
    assert.equal(info.percorsoDati, path.join(datiPercorso, 'Dati', 'archivio.sqlite'));
    assert.ok(fs.existsSync(info.percorsoDati), 'il file dei dati è stato creato al primo avvio');
    await p.screenshot({ path: path.join(base, 'dashboard-vuota.png') });
    assert.deepEqual((await sql(p, 'SELECT nome, percentuale_fissa FROM collaboratori ORDER BY id')).map((r) => [r.nome, r.percentuale_fissa]), [['Luca', null], ['Giuseppe', null], ['Capo', 15], ['Segretaria', 4]]);
  });

  test('si inseriscono dati dall\'interfaccia: pratica, incasso, esportazione, backup', async () => {
    const { finestra: p } = s1;
    await inserisciDatiProva(p); // zone, scaglioni, 15 pratiche, incassi e liquidazioni
    // una pratica con il modulo vero
    await p.evaluate(() => { location.hash = '#/nuova'; });
    await p.waitForSelector('#form-pratica');
    const F = (e, o = {}) => p.locator('#form-pratica').getByLabel(e, o);
    await F(/^Zona\*?$/).selectOption({ label: 'Centro' });
    await F('Prezzo di vendita').fill('150.000');
    await F('Nominativo del venditore').fill('Mario Rossi');
    await F('Nominativo dell\'acquirente').fill('Anna Bianchi');
    await p.locator('#pagamenti-venditore').getByLabel('Bonifico').fill('1.220'); // 1.000 + IVA al 22%
    await p.waitForSelector('#ripartizione-automatica'); // la ripartizione arriva da sola dalla zona
    await p.click('#salva-pratica');
    // la zona ha già pratiche nello stesso mese: prima di salvare compare l'avviso del cumulo
    await p.locator('dialog.modale[open] button', { hasText: 'Salva la pratica' }).click();
    await p.waitForSelector('#contenuto h1:has-text("Zona Centro")');
    assert.match(await p.locator('#contenuto').innerText(), /2026\/016/);
    // il file su disco contiene davvero i dati: lo si apre con un altro processo di lettura
    const SQLmod = await import('../unit/helpers-db.mjs');
    const SQL = await SQLmod.motore();
    const db = new SQL.Database(fs.readFileSync(path.join(datiPercorso, 'Dati', 'archivio.sqlite')));
    assert.equal(db.exec('SELECT COUNT(*) FROM pratiche')[0].values[0][0], 16);
    db.close();
    // backup rapido: crea un file nella cartella Backup
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForSelector('#op-backup');
    await p.click('#op-backup');
    await p.waitForFunction(() => /Backup creato/.test(document.querySelector('.toast-area')?.textContent ?? ''));
    const copie = fs.readdirSync(path.join(datiPercorso, 'Backup'));
    assert.equal(copie.length, 1);
    assert.match(copie[0], /^copia_manuale_\d{8}T\d{9}Z\.sqlite$/);
    // esportazione in CSV (nella cartella Esportazioni, senza finestre in prova)
    await p.evaluate(() => { location.hash = '#/backup'; });
    await p.waitForSelector('#bk-csv');
    await p.click('#bk-csv');
    await p.locator('dialog.modale[open] button', { hasText: 'Esporta' }).last().click();
    await p.waitForFunction(() => /salvato/.test(document.querySelector('.toast-area')?.textContent ?? ''));
    const esportati = fs.readdirSync(path.join(datiPercorso, 'Esportazioni'));
    assert.equal(esportati.length, 1);
    const csv = fs.readFileSync(path.join(datiPercorso, 'Esportazioni', esportati[0]));
    assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV con BOM per Excel');
    assert.match(csv.toString('utf8'), /2026\/016/);
    // "Backup e archivio storico": i due pulsanti per aprire le cartelle rispondono (in prova Esplora file non si apre davvero)
    await p.evaluate(() => { location.hash = '#/backup'; });
    await p.getByRole('button', { name: 'Apri la cartella dei dati' }).waitFor();
    const cartellaDati = await p.evaluate(() => window.gestionaleHost.sistema.apriCartella('dati'));
    const cartellaBackup = await p.evaluate(() => window.gestionaleHost.sistema.apriCartella('backup'));
    assert.deepEqual([cartellaDati.aperta, cartellaDati.cartella], [true, path.join(datiPercorso, 'Dati')]);
    assert.deepEqual([cartellaBackup.aperta, cartellaBackup.cartella], [true, path.join(datiPercorso, 'Backup')]);
    await p.getByRole('button', { name: 'Apri la cartella dei dati' }).click();
    await p.getByRole('button', { name: 'Apri la cartella dei backup' }).click();
    await p.waitForTimeout(300);
    assert.doesNotMatch(await p.locator('.toast-area').innerText(), /Non riesco ad aprire la cartella/);
    // archivio completo da importare più avanti
    fs.copyFileSync(path.join(datiPercorso, 'Dati', 'archivio.sqlite'), FILE_DA_IMPORTARE);
    assert.deepEqual(s1.errori, []);
  });

  test('chiudendo e riaprendo il programma i dati ci sono ancora', async () => {
    await s1.app.close();
    s1 = null;
    s2 = await avviaProgramma();
    const { finestra: p } = s2;
    assert.equal(await valore(p, 'SELECT COUNT(*) FROM pratiche'), 16);
    assert.equal(await valore(p, "SELECT COUNT(*) FROM pratiche WHERE codice = '2026/016' AND immobile_indirizzo IS NULL AND compensi_da_pagamenti = 1 AND venditore_bonifico_cent = 122000"), 1);
    assert.equal(await valore(p, 'SELECT COUNT(*) FROM incassi'), 4);
    assert.equal(await valore(p, 'SELECT COUNT(*) FROM liquidazioni'), 3);
    assert.equal(await valore(p, 'PRAGMA integrity_check'), 'ok');
    await p.waitForSelector('.kpi');
    assert.match(await p.locator('.kpi', { hasText: 'Pratiche concluse' }).locator('.kpi-valore').innerText(), /\d/);
    // all'avvio è stata fatta anche la copia automatica del giorno
    await p.evaluate(() => { location.hash = '#/backup'; });
    await p.waitForSelector('#tabella-storico');
    const tipi = (await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).map((c) => c.tipo))).sort();
    assert.deepEqual(tipi, ['automatico', 'manuale']);
    assert.match(await p.locator('#contenuto').innerText(), /Nel file .*archivio\.sqlite/);
    assert.deepEqual(s2.errori, []);
  });

  test('importare un file e ripristinare una copia funzionano sul file reale', async () => {
    const { finestra: p } = s2;
    // si cancella una pratica, poi si ripristina la copia manuale
    await p.evaluate(async () => { const { api, app } = window.__gi; await api.eliminaPratica(app.archivio, app.archivio.valore("SELECT id FROM pratiche WHERE codice = '2026/014'")); });
    assert.equal(await valore(p, 'SELECT COUNT(*) FROM pratiche'), 15);
    const riga = p.locator('#tabella-storico tbody tr', { hasText: 'Manuale' });
    await riga.getByRole('button', { name: 'Ripristina' }).click();
    await p.locator('dialog.modale[open] button', { hasText: 'Ripristina questa copia' }).click();
    await p.waitForFunction(() => /Dati ripristinati: 16 pratiche/.test(document.querySelector('.toast-area')?.textContent ?? ''));
    assert.equal(await valore(p, 'SELECT COUNT(*) FROM pratiche'), 16);
    // il file su disco segue
    const SQL = await (await import('../unit/helpers-db.mjs')).motore();
    const db = new SQL.Database(fs.readFileSync(path.join(datiPercorso, 'Dati', 'archivio.sqlite')));
    assert.equal(db.exec('SELECT COUNT(*) FROM pratiche')[0].values[0][0], 16);
    db.close();
    assert.ok(fs.readdirSync(path.join(datiPercorso, 'Backup')).some((f) => f.includes('pre-ripristino')));
  });

  test('una seconda copia del programma non si apre: la prima resta in uso', async () => {
    const eseguibile = binarioElectron();
    const secondo = spawn(eseguibile, argomenti(), { env: ambiente(), stdio: 'ignore' });
    const codice = await new Promise((risolvi) => { secondo.on('exit', (c) => risolvi(c)); setTimeout(() => { secondo.kill(); risolvi('ancora aperto'); }, 30000); });
    assert.equal(codice, 0, 'la seconda copia si chiude subito');
    assert.equal(await valore(s2.finestra, 'SELECT COUNT(*) FROM pratiche'), 16, 'la prima copia continua a funzionare');
  });

  test('versione portatile (chiavetta): i dati nascono accanto al programma, non nei Documenti, e seguono la chiavetta', async () => {
    const chiavetta = path.join(base, 'chiavetta');
    const altroPc = path.join(base, 'chiavetta-spostata');
    const casa = path.join(base, 'casa'); // finta cartella personale: qui non deve nascere nulla
    for (const c of [chiavetta, casa]) fs.mkdirSync(c, { recursive: true });
    const comePortatile = (cartella) => ({ GESTIONE_IMMOBILIARE_DATI: '', PORTABLE_EXECUTABLE_DIR: cartella, HOME: casa, USERPROFILE: casa });
    const cartellaDati = path.join(chiavetta, 'Gestione Immobiliare - Dati');
    let sp = null;
    try {
      sp = await avviaProgramma(comePortatile(chiavetta), path.join(base, 'profilo-chiavetta-1'));
      const { finestra: p } = sp;
      const info = await p.evaluate(() => window.gestionaleHost.sistema.info());
      assert.equal(info.portatile, true);
      assert.equal(info.portatileTemporaneo, true, 'la finta chiavetta sta nella cartella temporanea del sistema: il programma lo segnala');
      assert.equal(info.percorsoDati, path.join(cartellaDati, 'Dati', 'archivio.sqlite'));
      assert.ok(fs.existsSync(info.percorsoDati), 'l\'archivio nasce accanto al programma');
      // la schermata lo dice chiaramente
      await p.evaluate(() => { location.hash = '#/backup'; });
      await p.waitForSelector('#nota-portatile');
      assert.match(await p.locator('#nota-portatile').innerText(), /Versione portatile.*Gestione Immobiliare - Dati.*togliere la chiavetta/s);
      assert.match(await p.locator('#avviso-temporanea').innerText(), /cartella temporanea.*ZIP.*possono andare persi/s);
      // un dato e una copia di sicurezza, fatti dall'interfaccia
      await p.evaluate(async () => { const { api, app } = window.__gi; await api.creaZona(app.archivio, { nome: 'Zona chiavetta' }); });
      await p.click('#bk-crea');
      await p.waitForFunction(() => /Backup creato/.test(document.querySelector('.toast-area')?.textContent ?? ''));
      assert.equal(fs.readdirSync(path.join(cartellaDati, 'Backup')).length, 1, 'anche la copia sta sulla chiavetta');
      assert.deepEqual(sp.errori, []);
      await sp.app.close();
      sp = null;
      // nulla è finito nella cartella personale del computer
      assert.deepEqual(fs.readdirSync(casa).filter((n) => /Documen|Gestione/i.test(n)), [], 'niente in Documenti');
      // "si porta la chiavetta su un altro computer": cartella copiata, stesso programma, dati ritrovati
      fs.cpSync(chiavetta, altroPc, { recursive: true });
      sp = await avviaProgramma(comePortatile(altroPc), path.join(base, 'profilo-chiavetta-2'));
      assert.equal(await valore(sp.finestra, "SELECT COUNT(*) FROM zone WHERE nome = 'Zona chiavetta'"), 1);
      assert.equal(await valore(sp.finestra, 'PRAGMA integrity_check'), 'ok');
      assert.deepEqual(sp.errori, []);
    } finally {
      try { await sp?.app.close(); } catch { /* già chiuso */ }
    }
  });
});
