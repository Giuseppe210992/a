// Utilita' per i test nel browser (Chromium con Playwright).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const qui = path.dirname(fileURLToPath(import.meta.url));
export const RADICE = path.resolve(qui, '..', '..');
export const URL_APP = `file://${path.join(RADICE, 'dist', 'web', 'index.html')}`;

// Data "di oggi" usata nei test: cosi' i risultati non dipendono dal giorno in cui si lanciano.
export const ADESSO_FISSO = '2026-10-16T10:30:00+02:00';

// Lo scarto si calcola una sola volta per processo: tutte le finestre aperte durante le prove condividono la stessa linea del tempo
// (la seconda apertura del "programma" avviene dopo la prima, non alla stessa ora fissa).
const SCARTO_FISSO = new Date(ADESSO_FISSO).getTime() - Date.now();

/** Sposta l'orologio del browser in avanti/indietro mantenendolo in movimento (continuo anche dopo un ricaricamento). */
function scriptOrologio(adesso) {
  const scarto = adesso === ADESSO_FISSO ? SCARTO_FISSO : new Date(adesso).getTime() - Date.now();
  return `(() => {
    const Reale = Date; const scarto = ${scarto};
    function DataFinta(...a) {
      if (!new.target) return new Reale(Reale.now() + scarto).toString();
      return a.length === 0 ? new Reale(Reale.now() + scarto) : new Reale(...a);
    }
    DataFinta.prototype = Reale.prototype;
    DataFinta.now = () => Reale.now() + scarto;
    DataFinta.parse = Reale.parse; DataFinta.UTC = Reale.UTC;
    Object.setPrototypeOf(DataFinta, Reale);
    window.Date = DataFinta;
  })();`;
}

/**
 * GI_RITARDO=150 simula un computer in cui tutto risponde con comodo: il cambio di schermata (evento "hashchange"), i timer a zero
 * e la conferma di scrittura sul disco (IndexedDB) arrivano 150 ms piu' tardi. Il programma deve comportarsi allo stesso modo, solo piu' lentamente:
 * una prova che fallisce solo cosi' sta leggendo lo schermo troppo presto.
 */
function scriptRitardo(ms) {
  return `(() => {
    const ms = ${ms};
    const st = window.setTimeout;
    const aggiungi = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (tipo, fn, opz) {
      if (tipo === 'hashchange' && typeof fn === 'function') { const orig = fn; fn = function (e) { st.call(window, () => orig.call(this, e), ms); }; }
      return aggiungi.call(this, tipo, fn, opz);
    };
    window.setTimeout = function (fn, t, ...a) { return st.call(window, fn, (t === undefined || t <= 1) ? ms : t, ...a); };
    const d = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    if (d && d.set) Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, get: d.get,
      set(fn) { d.set.call(this, typeof fn === 'function' ? function (e) { st.call(window, () => fn.call(this, e), ms); } : fn); } });
  })();`;
}

// Nei test non si apre mai il selettore di cartelle del sistema: al suo posto c'e' una cartella finta (scritta su IndexedDB, perche' da file://
// l'OPFS non e' disponibile) che resta tra una chiusura e l'altra solo con un profilo persistente, e il clic su «Scegli la cartella dei dati»
// e' automatico, salvo window.__noAutoScegli. Il programma vero non usa mai IndexedDB: questo e' solo il disco finto dei test.
export const CARTELLA_PROVA = 'gi-dati';
const SCRIPT_CARTELLA_FINTA = `
  (() => {
    const apri = () => new Promise((ok, ko) => { const rq = indexedDB.open('gi-fs-prova', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('f'); rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error); });
    const tx = async (modo, f) => { const db = await apri(); return new Promise((ok, ko) => { const t = db.transaction('f', modo); let r; t.addEventListener('complete', () => { db.close(); ok(r); }); t.addEventListener('error', () => ko(t.error)); Promise.resolve(f(t.objectStore('f'))).then((v) => { r = v; }); }); };
    const rq = (q) => new Promise((ok, ko) => { q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
    const fs = {
      leggi: (p) => tx('readonly', (s) => rq(s.get(p))),
      scrivi: (p, b) => tx('readwrite', (s) => { s.put(b, p); }),
      elimina: (p) => tx('readwrite', (s) => { s.delete(p); }),
      chiavi: (pre) => tx('readonly', async (s) => (await rq(s.getAllKeys())).filter((k) => k.startsWith(pre))),
    };
    window.__fsProva = fs;
    const err = (n) => { const e = new Error(n); e.name = n; return e; };
    const dir = (percorso) => ({
      kind: 'directory', name: percorso.split('/').pop(),
      async getFileHandle(n, o = {}) {
        const p = percorso + '/' + n; let b = await fs.leggi(p);
        if (!b) { if (!o.create) throw err('NotFoundError'); b = new Uint8Array(0); await fs.scrivi(p, b); }
        return { kind: 'file', name: n,
          async getFile() { const x = await fs.leggi(p); return { size: x.length, async arrayBuffer() { return x.slice().buffer; } }; },
          async createWritable() { let d = new Uint8Array(0); return { async write(x) { d = new Uint8Array(x); }, async close() { await fs.scrivi(p, d); }, async abort() {} }; } };
      },
      async getDirectoryHandle(n) { return dir(percorso + '/' + n); },
      async removeEntry(n) { const p = percorso + '/' + n; if (!(await fs.leggi(p))) throw err('NotFoundError'); await fs.elimina(p); },
      async *entries() {
        const pre = percorso + '/'; const visti = new Set();
        for (const k of await fs.chiavi(pre)) { const resto = k.slice(pre.length); const nome = resto.split('/')[0]; if (visti.has(nome)) continue; visti.add(nome);
          if (resto.includes('/')) yield [nome, dir(pre + nome)]; else yield [nome, { kind: 'file', name: nome, async getFile() { const x = await fs.leggi(k); return { size: x.length }; } }]; }
      },
    });
    window.showDirectoryPicker = async () => dir('${CARTELLA_PROVA}');
    new MutationObserver(() => { const b = document.querySelector('#scegli-cartella'); if (b && !window.__noAutoScegli && !b.dataset.cliccato) { b.dataset.cliccato = '1'; b.click(); } }).observe(document, { childList: true, subtree: true });
  })();
`;
const SCRIPT_INIZIALE = SCRIPT_CARTELLA_FINTA + `
  // Le notifiche restano a lungo sullo schermo: a ogni clic o Invio quelle gia' presenti si segnano come "vecchie",
  // cosi' un test che aspetta l'esito di un'operazione non scambia per sua la notifica di un'operazione precedente.
  const segnaVecchie = () => { for (const t of document.querySelectorAll('.toast-area .toast')) t.dataset.vecchia = '1'; };
  window.addEventListener('pointerdown', segnaVecchie, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') segnaVecchie(); }, true);
  // intercetta chi aggiunge a un nodo "null"/"undefined"/"false" come testo (errore tipico di un'interfaccia costruita a mano)
  window.__testoSospetto = [];
  for (const nome of ['append', 'prepend', 'replaceChildren']) {
    const orig = Element.prototype[nome];
    Element.prototype[nome] = function (...args) {
      for (const a of args) if (a === null || a === undefined || a === false || a === 'null' || a === 'undefined') window.__testoSospetto.push(nome + ':' + String(a) + ' in <' + this.tagName.toLowerCase() + (this.className ? '.' + String(this.className.baseVal ?? this.className).split(' ')[0] : '') + '> ' + new Error().stack.split('\\n').slice(2, 4).map((r) => r.trim().replace(/^at /, '').replace(/\\(.*[/\\\\]/, '(')).join(' < '));
      return orig.apply(this, args);
    };
  }
`;

/** Apre un contesto di Chromium. Con `profilo` i dati (IndexedDB) restano tra una chiusura e l'altra. */
export async function apriContesto({ profilo = null, viewport = { width: 1440, height: 900 }, colorScheme = 'light', locale = 'it-IT', scaricamenti = true, adesso = ADESSO_FISSO } = {}) {
  const opzioni = {
    headless: true, viewport, colorScheme, locale, timezoneId: 'Europe/Rome', acceptDownloads: scaricamenti,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  };
  let ctx; let browser = null;
  if (profilo) {
    ctx = await chromium.launchPersistentContext(profilo, opzioni);
  } else {
    browser = await chromium.launch({ headless: true, args: opzioni.args });
    ctx = await browser.newContext(opzioni);
  }
  if (adesso) await ctx.addInitScript(scriptOrologio(adesso));
  await ctx.addInitScript(SCRIPT_INIZIALE);
  const ritardo = Number(process.env.GI_RITARDO || 0);
  if (ritardo > 0) await ctx.addInitScript(scriptRitardo(ritardo));
  const errori = [];
  const seguiPagina = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') errori.push(`console: ${m.text()}`); });
    p.on('pageerror', (e) => errori.push(`pageerror: ${e.message}`));
  };
  ctx.on('page', seguiPagina);
  // GI_RALLENTA=4 fa girare il browser 4 volte piu' lento: serve a scovare le prove (e le schermate) che funzionano solo su un computer veloce.
  const rallenta = Number(process.env.GI_RALLENTA || 0);
  if (rallenta > 1) {
    const rallentaPagina = async (p) => { try { const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: rallenta }); } catch { /* pagina gia' chiusa */ } };
    ctx.on('page', rallentaPagina);
    for (const p of ctx.pages()) await rallentaPagina(p);
  }
  // GI_COPERTURA=/cartella raccoglie quali righe del programma le prove eseguono davvero (poi: node tools/rapporto-copertura.mjs /cartella).
  const cartellaCopertura = process.env.GI_COPERTURA || null;
  const conCopertura = new Set();
  if (cartellaCopertura) {
    fs.mkdirSync(cartellaCopertura, { recursive: true });
    const avviaCopertura = async (p) => { try { await p.coverage.startJSCoverage({ resetOnNavigation: false }); conCopertura.add(p); } catch { /* pagina gia' chiusa */ } };
    const nuovaPagina = ctx.newPage.bind(ctx);
    ctx.newPage = async () => { const p = await nuovaPagina(); await avviaCopertura(p); return p; };
    for (const p of ctx.pages()) await avviaCopertura(p);
  }
  const salvaCopertura = async () => {
    for (const p of conCopertura) {
      try {
        const voci = (await p.coverage.stopJSCoverage()).filter((v) => /\/app\.js(\?|$)/.test(v.url) && v.source);
        const compatte = voci.map((v) => {
          const fonte = crypto.createHash('sha1').update(v.source).digest('hex').slice(0, 12);
          const fileFonte = path.join(cartellaCopertura, `fonte-${fonte}.js`);
          if (!fs.existsSync(fileFonte)) fs.writeFileSync(fileFonte, v.source);
          return { fonte, functions: v.functions };
        });
        fs.writeFileSync(path.join(cartellaCopertura, `cop-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`), JSON.stringify(compatte));
      } catch { /* pagina chiusa prima del termine */ }
    }
  };
  return { ctx, browser, errori, seguiPagina, chiudi: async () => { await salvaCopertura(); await ctx.close(); if (browser) await browser.close(); } };
}

/**
 * Apre l'applicazione. Di norma si tolgono il capo e la segretaria (percentuali fisse sul totale delle provvigioni) che il
 * primo avvio crea: così i numeri delle prove sui soli collaboratori restano quelli calcolati a mano. Con
 * { conPercentualiFisse: true } restano.
 */
export async function apriApp(pagina, hash = '', { conPercentualiFisse = false } = {}) {
  await pagina.goto(URL_APP + hash);
  await pagina.waitForSelector('.sidebar', { state: 'attached', timeout: 15000 });
  await pagina.waitForFunction(() => window.__gi && window.__gi.app && window.__gi.app.archivio, null, { timeout: 15000 });
  if (!conPercentualiFisse) {
    await pagina.evaluate(async () => {
      const a = window.__gi.app.archivio;
      if (a.valore('SELECT COUNT(*) FROM collaboratori WHERE percentuale_fissa IS NOT NULL')) {
        await a.transazione(() => { a.esegui('DELETE FROM collaboratori WHERE percentuale_fissa IS NOT NULL'); });
      }
    });
  }
}

/** Apre una finestra pulita con l'applicazione gia' avviata (archivio vuoto). */
export async function avvia(opzioni = {}) {
  const c = await apriContesto(opzioni);
  const pagina = await c.ctx.newPage();
  await apriApp(pagina, opzioni.hash || '', opzioni);
  return { ...c, pagina };
}

export function cartellaTemp(prefisso = 'gi-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefisso));
}

/**
 * Attende che la pagina smetta di cambiare: nessuna modifica al contenuto per `ms` millisecondi (con un tetto di sicurezza).
 * Serve al posto delle pause fisse dopo un cambio di schermata o di filtro.
 */
export async function attendiQuiete(pagina, ms = 100, massimo = 5000) {
  await pagina.evaluate(([quiete, tetto]) => new Promise((fatto) => {
    let timer = null;
    const osservatore = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(fine, quiete); });
    const limite = setTimeout(fine, tetto);
    function fine() { osservatore.disconnect(); clearTimeout(timer); clearTimeout(limite); fatto(); }
    osservatore.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(fine, quiete);
  }), [ms, massimo]);
}

/** Quante volte il programma ha disegnato una schermata (lo scrive il router su #contenuto). */
export const montaggi = (pagina) => pagina.evaluate(() => Number(document.querySelector('#contenuto')?.dataset.montaggi ?? 0));

/** Esegue un'azione che cambia schermata (un clic su un collegamento, ad esempio) e attende che la nuova schermata sia disegnata. */
export async function conNavigazione(pagina, azione) {
  const prima = await montaggi(pagina);
  await azione();
  await pagina.waitForFunction((n) => Number(document.querySelector('#contenuto')?.dataset.montaggi ?? 0) > n, prima, { timeout: 15000 });
  await pagina.waitForSelector('#contenuto h1, #contenuto .vuoto', { timeout: 15000 });
}

/** Naviga a un indirizzo interno (#/...) e attende che la schermata sia disegnata. */
export async function vai(pagina, hash) {
  // con lo stesso indirizzo la schermata non si ricostruisce: si passa prima da un indirizzo sconosciuto (che riporta alla dashboard)
  if (await pagina.evaluate(() => location.hash) === hash) {
    await conNavigazione(pagina, () => pagina.evaluate(() => { location.hash = '#/indirizzo-per-ricaricare'; }));
    await pagina.waitForFunction(() => location.hash === '#/');
    // l'indirizzo sconosciuto porta alla dashboard appena disegnata: se la destinazione era quella, siamo gia' arrivati
    if (hash === '#/') { await attendiQuiete(pagina, 80); return; }
  }
  await conNavigazione(pagina, () => pagina.evaluate((h) => { location.hash = h; }, hash));
  await attendiQuiete(pagina, 80);
}

/** Importo scritto in italiano ("1.234,56 €" o "1.235 €") -> centesimi. */
export function centesimi(testo) {
  const s = String(testo).replace(/[^\d,.\-−]/g, '').replace(/−/g, '-');
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Math.round(n * 100);
}

/** Testo del valore di un riquadro della dashboard dato il suo nome. */
export async function kpi(pagina, etichetta) {
  const loc = pagina.locator('.kpi', { has: pagina.locator('.kpi-etichetta', { hasText: new RegExp(`^${etichetta}$`) }) });
  return (await loc.locator('.kpi-valore').first().innerText()).trim();
}

export async function testoSospetto(pagina) {
  return pagina.evaluate(() => window.__testoSospetto.splice(0));
}

export function rimuoviSpazi(t) { return String(t).replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }

// ------------------------------------------------------------ filtri della barra superiore

/** Sceglie il periodo con una delle scorciatoie del selettore ("Mese scorso", "Anno corrente", ...). */
export async function scegliPeriodo(pagina, scorciatoia) {
  await pagina.click('.periodo-btn');
  await pagina.waitForSelector('.sel-periodo');
  await pagina.click(`.sel-periodo .sel-scorciatoie button:has-text("${scorciatoia}")`);
  await pagina.keyboard.press('Escape');
  await pagina.waitForSelector('.sel-periodo', { state: 'detached' });
  await attendiQuiete(pagina, 80);
}

export async function scegliZona(pagina, nome) {
  await pagina.selectOption('#filtro-zona', nome === null ? '' : { label: nome });
  await attendiQuiete(pagina, 80);
}

export async function scegliCollaboratore(pagina, nome) {
  await pagina.selectOption('#filtro-collab', nome === null ? '' : { label: nome });
  await attendiQuiete(pagina, 80);
}

export async function azzeraFiltri(pagina) {
  const bottone = pagina.locator('.striscia-filtri button:has-text("Azzera filtri")');
  if (await bottone.isVisible()) await bottone.click();
  await attendiQuiete(pagina, 80);
}

/** Valori numerici dei tre riquadri come centesimi (o numero intero per le pratiche concluse). */
export async function riquadri(pagina) {
  const nomi = {
    concluse: 'Pratiche concluse',
    compensi: 'Compensi dell\'agenzia',
    maturate: 'Provvigioni pagate',
  };
  const out = {};
  for (const [k, etichetta] of Object.entries(nomi)) {
    const t = await kpi(pagina, etichetta);
    out[k] = k === 'concluse' ? Number(t.replace(/\./g, '')) : centesimi(t);
  }
  return out;
}

/** Riga dei totali della tabella delle Statistiche: concluse, compensi, incassi, provvigioni, margine, valore venduto (centesimi). */
export async function totaliStatistiche(pagina) {
  const celle = await pagina.locator('#tabella-statistiche tfoot td').allInnerTexts();
  const [concluse, compensi, incassi, provvigioni, margine, valore] = celle.slice(1).map((t) => (t.includes('€') ? centesimi(t) : Number(rimuoviSpazi(t).replace(/\./g, ''))));
  return { concluse, compensi, incassi, provvigioni, margine, valore };
}

// ------------------------------------------------------------ database, file scaricati, finestre

/** Esegue una SELECT sull'archivio aperto nella pagina e restituisce le righe come oggetti. */
export function sql(pagina, query, parametri = []) {
  return pagina.evaluate(([q, par]) => window.__gi.app.archivio.tutti(q, par), [query, parametri]);
}

export function valoreSql(pagina, query, parametri = []) {
  return pagina.evaluate(([q, par]) => window.__gi.app.archivio.valore(q, par), [query, parametri]);
}

export const idPratica = (pagina, codice) => valoreSql(pagina, 'SELECT id FROM pratiche WHERE codice = ?', [codice]);

/** Esegue `azione` (che provoca un download) e restituisce { nome, bytes }. */
export async function scarica(pagina, azione) {
  // il programma non scarica nulla (il browser ne terrebbe la cronologia): scrive nella cartella Esportazioni dei dati
  const pre = `${CARTELLA_PROVA}/Esportazioni/`;
  const elenco = () => pagina.evaluate((p) => window.__fsProva.chiavi(p), pre);
  const prima = new Set(await elenco());
  await azione();
  const limite = Date.now() + 15000;
  for (;;) {
    const nuovo = (await elenco()).find((n) => !prima.has(n));
    if (nuovo) {
      const dati = await pagina.evaluate(async (n) => Array.from(await window.__fsProva.leggi(n)), nuovo);
      return { nome: nuovo.slice(pre.length), bytes: Buffer.from(dati) };
    }
    if (Date.now() > limite) throw new Error('Nessun file esportato nella cartella Esportazioni.');
    await new Promise((ok) => setTimeout(ok, 100));
  }
}

/** Sostituisce il file dell'archivio nella cartella dei dati di prova (per simulare un file danneggiato). */
export function scriviArchivioSuCartella(pagina, byte) {
  return pagina.evaluate(async ([c, dati]) => {
    await window.__fsProva.scrivi(`${c}/Dati/archivio.sqlite`, new Uint8Array(dati));
    await window.__fsProva.elimina(`${c}/Dati/archivio.sqlite.bak`);
  }, [CARTELLA_PROVA, Array.from(byte)]);
}

/** Legge un CSV italiano (separatore ";", BOM, campi tra virgolette) e restituisce { intestazioni, righe, bom }. */
export function leggiCsv(bytes) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const testo = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const righe = [];
  let riga = []; let campo = ''; let tra = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (tra) {
      if (c === '"' && testo[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') tra = false; else campo += c;
    } else if (c === '"') tra = true;
    else if (c === ';') { riga.push(campo); campo = ''; }
    else if (c === '\r') { /* ignora */ } else if (c === '\n') { riga.push(campo); righe.push(riga); riga = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || riga.length) { riga.push(campo); righe.push(riga); }
  const [intestazioni, ...dati] = righe;
  return { intestazioni, righe: dati, bom };
}

/** Apre un file SQLite scaricato con lo stesso motore del programma e permette di interrogarlo. */
export async function apriSqlite(bytes) {
  const { motore } = await import('../unit/helpers-db.mjs');
  const SQL = await motore();
  const db = new SQL.Database(bytes);
  const tutti = (q, par = []) => {
    const st = db.prepare(q); st.bind(par);
    const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out;
  };
  return { db, tutti, valore: (q, par) => Object.values(tutti(q, par)[0] ?? {})[0], chiudi: () => db.close() };
}

/** Finestra di dialogo aperta (una sola alla volta). */
export const finestra = (pagina) => pagina.locator('dialog.modale[open]');

/** Testo dell'ultima notifica visibile. */
export async function testoNotifiche(pagina) {
  return rimuoviSpazi(await pagina.locator('.toast-area').innerText());
}

/** Attende che compaia una NUOVA notifica (comparsa dopo l'ultimo clic o Invio) con quel testo (espressione regolare). */
export async function attendiNotifica(pagina, re) {
  await pagina.waitForFunction(([src, flags]) => {
    const rx = new RegExp(src, flags);
    return [...document.querySelectorAll('.toast-area .toast:not([data-vecchia])')].some((t) => rx.test(t.textContent.replace(/\u00a0/g, ' ')));
  }, [re.source, re.flags]);
}

/** Pulsante di una finestra di dialogo, per nome. */
export const bottoneFinestra = (pagina, nome) => finestra(pagina).locator('button', { hasText: nome }).last();

/** Apre la finestra «Registra un incasso» dalla scheda della prima pratica (l'incasso non è più un'operazione della dashboard). */
export async function apriIncasso(pagina) {
  const id = await pagina.evaluate(() => window.__gi.app.archivio.valore('SELECT id FROM pratiche ORDER BY id LIMIT 1'));
  await vai(pagina, `#/pratiche/${id}`);
  await pagina.click('#btn-incasso');
}
