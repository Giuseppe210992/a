// Accessibilità di base (tastiera, nomi dei controlli, titoli, finestre) e funzionamento senza Internet.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { avvia, apriContesto, apriApp, vai, rimuoviSpazi, idPratica, finestra, bottoneFinestra, RADICE, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const SEZIONI = ['collaboratori', 'zone', 'scaglioni', 'calcolo', 'ripartizione', 'iva', 'preferenze', 'info'];
const ROTTE = (id) => ['#/', '#/nuova', '#/pratiche', `#/pratiche/${id}`, `#/pratiche/${id}/modifica`, '#/provvigioni', '#/provvigioni?tab=dettaglio', '#/provvigioni?tab=liquidazioni', '#/provvigioni?tab=incassi',
  '#/cumulo?mese=2026-10', '#/statistiche', '#/backup', ...SEZIONI.map((s) => `#/impostazioni?sezione=${s}`)];

/** Controlli senza un nome comprensibile per uno screen reader. */
const SENZA_NOME = () => {
  const nomeDi = (el) => {
    const aria = el.getAttribute('aria-label'); if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.textContent).join(' ').replace(/\*/g, '').trim(); if (t) return t; }
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) { const t = el.textContent.replace(/\s+/g, ' ').trim(); if (t) return t; }
    if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type) && el.value) return el.value;
    const ti = el.getAttribute('title'); if (ti && ti.trim()) return ti.trim();
    return '';
  };
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=option], summary, [tabindex="0"]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"]')) continue;
    if (!nomeDi(el)) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`);
  }
  return out.slice(0, 10);
};

/** Primo Tab dopo un ricaricamento: se la pagina non ha ancora preso il cursore, il Tab non arriva a nessun elemento. Si riprova. */
async function primoTab(p) {
  for (let i = 0; i < 5; i++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate(() => document.activeElement && document.activeElement !== document.body)) return;
    await p.waitForTimeout(50);
  }
}

describe('Accessibilità', () => {
  let app; let id;
  before(async () => { app = await avvia({ viewport: { width: 1366, height: 800 } }); await inserisciDatiProva(app.pagina); id = await idPratica(app.pagina, '2026/011'); });
  after(async () => { await app.chiudi(); });

  test('lingua italiana, titolo, CSP restrittiva e nessuna risorsa esterna', async () => {
    const p = app.pagina;
    assert.equal(await p.evaluate(() => document.documentElement.lang), 'it');
    assert.match(await p.title(), /Gestione Immobiliare/);
    const csp = await p.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(csp, /https?:/);
    // nessuna risorsa esterna nel codice compilato (solo il nome-spazio SVG, che non è un indirizzo da scaricare)
    for (const f of ['index.html', 'app.js', 'app.css']) {
      const testo = fs.readFileSync(path.join(RADICE, 'dist', 'web', f), 'utf8');
      const url = [...testo.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]).filter((u) => !/^http:\/\/www\.w3\.org\/2000\/svg/.test(u));
      assert.deepEqual(url, [], `indirizzi esterni in ${f}`);
    }
  });

  test('ogni schermata ha un solo titolo principale, i punti di riferimento giusti e nessun id doppio', async () => {
    const p = app.pagina;
    const problemi = [];
    for (const rotta of ROTTE(id)) {
      await vai(p, rotta);
      const r = await p.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
        const doppi = ids.filter((x, i) => ids.indexOf(x) !== i);
        return {
          h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav[aria-label], aside[aria-label]').length,
          header: document.querySelectorAll('header').length, doppi: [...new Set(doppi)],
          saltaH: [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1]),
        };
      });
      if (r.h1 !== 1) problemi.push(`${rotta}: ${r.h1} titoli h1`);
      if (r.main !== 1) problemi.push(`${rotta}: ${r.main} main`);
      if (r.nav < 1) problemi.push(`${rotta}: manca la navigazione con nome`);
      if (r.header < 1) problemi.push(`${rotta}: manca l'intestazione`);
      if (r.doppi.length) problemi.push(`${rotta}: id doppi ${r.doppi.join(',')}`);
      // i livelli dei titoli non saltano (h1 → h3 senza h2)
      for (let i = 1; i < r.saltaH.length; i++) if (r.saltaH[i] - r.saltaH[i - 1] > 1) { problemi.push(`${rotta}: titoli h${r.saltaH[i - 1]} → h${r.saltaH[i]}`); break; }
    }
    assert.deepEqual(problemi, []);
  });

  test('ogni pulsante, collegamento e campo ha un nome comprensibile', async () => {
    const p = app.pagina;
    const problemi = [];
    for (const rotta of ROTTE(id)) {
      await vai(p, rotta);
      for (const x of await p.evaluate(SENZA_NOME)) problemi.push(`${rotta}: ${x}`);
    }
    assert.deepEqual(problemi, []);
  });

  test('con la tastiera: "Salta al contenuto", ordine logico e cursore sempre visibile', async () => {
    const p = app.pagina;
    await p.reload(); // come all'apertura del programma: la tastiera parte dall'inizio della pagina
    await p.waitForFunction(() => window.__gi?.app?.archivio);
    await primoTab(p);
    assert.equal(await p.evaluate(() => document.activeElement.className), 'salta-contenuto');
    assert.equal(await p.evaluate(() => document.activeElement.getBoundingClientRect().top >= 0), true, 'compare quando ha il cursore');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'contenuto');
    // da capo: la sequenza dei primi elementi
    await p.reload();
    await p.waitForFunction(() => window.__gi?.app?.archivio);
    const visti = [];
    const senzaSegno = [];
    for (let i = 0; i < 28; i++) {
      if (i === 0) await primoTab(p); else await p.keyboard.press('Tab');
      const info = await p.evaluate(() => {
        const e = document.activeElement; const cs = getComputedStyle(e);
        const segno = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
        return { nome: (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.id || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 40), segno: !!segno, visibile: e.getBoundingClientRect().width > 0 };
      });
      visti.push(info.nome);
      if (!info.segno) senzaSegno.push(info.nome);
    }
    assert.deepEqual(senzaSegno, [], `elementi senza indicatore del cursore: ${senzaSegno}`);
    // salto al contenuto, poi la barra laterale (marchio e 8 voci, nell'ordine richiesto), poi l'intestazione
    assert.equal(visti[0], 'Salta al contenuto');
    assert.deepEqual(visti.slice(2, 10), ['Dashboard', 'Nuova pratica', 'Archivio pratiche', 'Provvigioni e liquidazioni', 'Cumulo mensile per zona', 'Statistiche e grafici', 'Backup e archivio storico', 'Impostazioni']);
    assert.ok(!visti.includes('Apri il menu'), 'il pulsante del menu del telefono non compare con la tastiera su un computer');
    assert.ok(visti.some((x) => /Ricerca rapida/.test(x)) && visti.some((x) => x === 'Nuova pratica'));
    assert.ok(new Set(visti).size >= 20, `elementi raggiungibili con Tab: ${new Set(visti).size}`);
  });

  test('menu laterale usabile da tastiera: Invio sulla voce apre la schermata', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.locator('.sidebar .nav-voce[data-id="statistiche"]').focus();
    await p.keyboard.press('Enter');
    await p.waitForSelector('#contenuto h1:has-text("Statistiche e grafici")');
    assert.equal(await p.locator('.sidebar .nav-voce[data-id="statistiche"]').getAttribute('aria-current'), 'page');
  });

  test('finestre di dialogo: il cursore entra, resta dentro, Esc chiude e il cursore torna dov\'era', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.locator('#op-incasso').focus();
    await p.keyboard.press('Enter');
    await finestra(p).waitFor();
    assert.equal(await p.evaluate(() => document.activeElement.closest('dialog.modale') !== null), true, 'il cursore è dentro la finestra');
    for (let i = 0; i < 18; i++) {
      await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(() => document.activeElement.closest('dialog.modale') !== null), true, `Tab ${i + 1}: il cursore non esce dalla finestra`);
    }
    assert.equal(await p.locator('dialog.modale').getAttribute('aria-labelledby'), 'modale-titolo');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelectorAll('dialog.modale').length === 0);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'op-incasso');
  });

  test('grafici: raggiungibili con Tab e con frecce; la tabella equivalente è uno dei pulsanti', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const g = p.locator('#grafico-compensi');
    await g.locator('svg.g-svg').focus();
    assert.equal(await g.locator('svg.g-svg').getAttribute('role'), 'group');
    assert.match(await g.locator('svg.g-svg').getAttribute('aria-label'), /Usa le frecce per scorrere i valori/);
    await p.keyboard.press('ArrowLeft');
    await g.locator('.g-tooltip').waitFor({ state: 'visible' });
    assert.ok(await g.getByRole('button', { name: /Tabella/ }).isVisible());
  });

  test('movimento ridotto: con la preferenza del sistema le animazioni si spengono', async () => {
    const p = app.pagina;
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await vai(p, '#/');
    const durate = await p.evaluate(() => ['.sidebar', '.kpi', '.btn', '.toast-area'].map((s) => { const e = document.querySelector(s); if (!e) return 0; const cs = getComputedStyle(e); return Math.max(parseFloat(cs.transitionDuration) || 0, parseFloat(cs.animationDuration) || 0); }));
    assert.ok(durate.every((d) => d <= 0.01), `durate delle transizioni con movimento ridotto: ${durate}`);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});

describe('Senza connessione a Internet', () => {
  test('il programma si apre, funziona in tutte le schermate e non contatta nessun indirizzo', async () => {
    const c = await apriContesto({});
    try {
      await c.ctx.setOffline(true);
      const richieste = [];
      const pagina = await c.ctx.newPage();
      c.seguiPagina(pagina);
      pagina.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) richieste.push(r.url()); });
      await apriApp(pagina);
      await inserisciDatiProva(pagina);
      const id = await idPratica(pagina, '2026/011');
      for (const rotta of ROTTE(id)) await vai(pagina, rotta);
      // esportazione e backup funzionano offline
      await vai(pagina, '#/');
      await pagina.click('#op-backup');
      await pagina.waitForFunction(() => /Backup creato/.test(document.querySelector('.toast-area')?.textContent ?? ''));
      assert.deepEqual(richieste, [], 'richieste di rete');
      assert.deepEqual(c.errori, [], 'errori in console');
      assert.equal(await pagina.evaluate(() => navigator.onLine), false);
    } finally { await c.chiudi(); }
  });
});
