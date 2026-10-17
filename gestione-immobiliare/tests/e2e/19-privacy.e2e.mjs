// Privacy: nel browser non deve restare nessuna traccia (memoria locale, IndexedDB, cookie, cache, download): i dati stanno solo
// nella cartella scelta. Nei test la cartella è un disco finto (IndexedDB "gi-fs-prova"), l'unica cosa ammessa nel browser.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { apriContesto, apriApp, vai, rimuoviSpazi, valoreSql, scarica, CARTELLA_PROVA, URL_APP } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

describe('Privacy: nessuna traccia nel browser', () => {
  let c;
  after(async () => { await c?.chiudi(); });

  test('prima di scegliere la cartella si vede solo la schermata di scelta, senza dati né struttura', async () => {
    c = await apriContesto({});
    const p = await c.ctx.newPage();
    await p.addInitScript(() => { window.__noAutoScegli = true; });
    await p.goto(URL_APP);
    await p.waitForSelector('#scegli-cartella');
    const t = rimuoviSpazi(await p.locator('body').innerText());
    assert.match(t, /Scegli la cartella dove tenere i dati/);
    assert.match(t, /il browser non conserva nulla/);
    assert.equal(await p.locator('.sidebar').count(), 0);
    assert.equal(await p.evaluate(() => !!window.__gi), false);
    // annullando la scelta (AbortError) resta lì, senza errori
    await p.evaluate(() => { window.showDirectoryPicker = async () => { const e = new Error('annullato'); e.name = 'AbortError'; throw e; }; });
    await p.click('#scegli-cartella');
    await p.waitForTimeout(200);
    assert.equal(await p.locator('#scegli-cartella').count(), 1);
    assert.equal(await p.locator('#msg-cartella').innerText(), '');
    await p.close();
  });

  test('un browser che non può scegliere cartelle lo dice e non salva da nessun altro posto', async () => {
    const p = await c.ctx.newPage();
    await p.addInitScript(() => { window.__haPicker = false; Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, get() { return undefined; }, set() {} }); });
    await p.goto(URL_APP);
    await p.waitForSelector('#app h1');
    const t = rimuoviSpazi(await p.locator('body').innerText());
    assert.match(t, /Questo browser non può salvare i dati/);
    assert.match(t, /Chrome o Microsoft Edge/);
    assert.equal(await p.locator('#scegli-cartella').count(), 0);
    await p.close();
  });

  test('lavorando, esportando e facendo backup il browser non conserva nulla: solo la cartella dei dati', async () => {
    const p = await c.ctx.newPage();
    await apriApp(p);
    await inserisciDatiProva(p);
    await vai(p, '#/impostazioni?sezione=calcolo');
    await p.click('.tb-azioni button[aria-label^="Passa al tema"]');
    await p.click('.sb-riduci');
    await vai(p, '#/');
    await p.click('#op-backup');
    await p.waitForFunction(() => /Backup creato/.test(document.querySelector('.toast-area')?.textContent ?? ''));
    // un'esportazione non scarica nulla: finisce nella cartella Esportazioni
    let scaricato = false;
    p.on('download', () => { scaricato = true; });
    const file = await scarica(p, async () => { await vai(p, '#/pratiche'); await p.getByRole('button', { name: 'Esporta l\'elenco' }).click(); });
    assert.match(file.nome, /^Pratiche_2026-10-16\.csv$/);
    assert.equal(scaricato, false, 'nessun download nella cronologia del browser');
    // niente nel browser
    const tracce = await p.evaluate(async () => ({
      locale: window.localStorage.length,
      sessione: window.sessionStorage.length,
      cookie: document.cookie,
      db: (await indexedDB.databases()).map((d) => d.name).filter((n) => n !== 'gi-fs-prova'),
      cache: window.caches ? await caches.keys() : [],
      sw: await (async () => { try { return (await navigator.serviceWorker.getRegistrations()).length; } catch { return 0; } })(),
    }));
    assert.deepEqual(tracce, { locale: 0, sessione: 0, cookie: '', db: [], cache: [], sw: 0 });
    // i dati ci sono nella cartella: archivio, backup, esportazione e preferenze
    const chiavi = await p.evaluate((c0) => window.__fsProva.chiavi(c0 + '/'), CARTELLA_PROVA);
    assert.ok(chiavi.includes(`${CARTELLA_PROVA}/Dati/archivio.sqlite`));
    assert.ok(chiavi.some((k) => /\/Backup\/copia_manuale_\d{8}T\d{9}Z\.sqlite$/.test(k)));
    assert.ok(chiavi.includes(`${CARTELLA_PROVA}/Dati/preferenze.json`));
    const pref = JSON.parse(new TextDecoder().decode(Buffer.from(await p.evaluate(async (k) => Array.from(await window.__fsProva.leggi(k)), `${CARTELLA_PROVA}/Dati/preferenze.json`))));
    assert.equal(pref.sidebar, 'ridotta');
    assert.ok(pref.tema === 'dark' || pref.tema === 'light');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 15);
    // nella schermata Backup la cartella è spiegata
    await vai(p, '#/backup');
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /Nel file gi-dati\/Dati\/archivio\.sqlite/);
    assert.match(t, /Nel browser non resta nessuna traccia/);
    await p.close();
  });
});
