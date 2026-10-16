// Utilita' per i test nel browser (Chromium con Playwright).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

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

// Nei test non si apre mai il selettore di file del sistema: si usa il download classico.
const SCRIPT_INIZIALE = `
  try { delete window.showSaveFilePicker; } catch (e) {}
  try { window.showSaveFilePicker = undefined; } catch (e) {}
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
  const errori = [];
  const seguiPagina = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') errori.push(`console: ${m.text()}`); });
    p.on('pageerror', (e) => errori.push(`pageerror: ${e.message}`));
  };
  ctx.on('page', seguiPagina);
  return { ctx, browser, errori, seguiPagina, chiudi: async () => { await ctx.close(); if (browser) await browser.close(); } };
}

export async function apriApp(pagina, hash = '') {
  await pagina.goto(URL_APP + hash);
  await pagina.waitForSelector('.sidebar', { state: 'attached', timeout: 15000 });
  await pagina.waitForFunction(() => window.__gi && window.__gi.app && window.__gi.app.archivio, null, { timeout: 15000 });
}

/** Apre una finestra pulita con l'applicazione gia' avviata (archivio vuoto). */
export async function avvia(opzioni = {}) {
  const c = await apriContesto(opzioni);
  const pagina = await c.ctx.newPage();
  await apriApp(pagina, opzioni.hash || '');
  return { ...c, pagina };
}

export function cartellaTemp(prefisso = 'gi-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefisso));
}

/** Naviga a un indirizzo interno (#/...) e attende che la schermata sia disegnata. */
export async function vai(pagina, hash) {
  // con lo stesso indirizzo la schermata non si ricostruisce: si passa prima dalla dashboard per averla sempre pulita
  if (await pagina.evaluate(() => location.hash) === hash) {
    await pagina.evaluate(() => { location.hash = '#/indirizzo-per-ricaricare'; });
    await pagina.waitForFunction(() => location.hash === '#/');
  }
  await pagina.evaluate((h) => { location.hash = h; }, hash);
  await pagina.waitForFunction((h) => location.hash === h || location.hash === h.replace(/\?.*/, '') || true, hash);
  await pagina.waitForSelector('#contenuto h1, #contenuto .vuoto', { timeout: 10000 });
  await pagina.waitForTimeout(60);
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
  await pagina.waitForTimeout(80);
}

export async function scegliZona(pagina, nome) {
  await pagina.selectOption('#filtro-zona', nome === null ? '' : { label: nome });
  await pagina.waitForTimeout(80);
}

export async function scegliCollaboratore(pagina, nome) {
  await pagina.selectOption('#filtro-collab', nome === null ? '' : { label: nome });
  await pagina.waitForTimeout(80);
}

export async function azzeraFiltri(pagina) {
  const bottone = pagina.locator('.striscia-filtri button:has-text("Azzera filtri")');
  if (await bottone.isVisible()) await bottone.click();
  await pagina.waitForTimeout(80);
}

/** Valori numerici dei sei riquadri come centesimi (o numero intero per i conteggi). */
export async function riquadri(pagina) {
  const nomi = {
    concluse: 'Compravendite concluse',
    compensi: 'Totale compensi registrati',
    maturate: 'Provvigioni maturate',
    daLiquidare: 'Provvigioni ancora da liquidare',
    valore: 'Valore complessivo immobili venduti',
    inCorso: 'Pratiche in corso',
  };
  const out = {};
  for (const [k, etichetta] of Object.entries(nomi)) {
    const t = await kpi(pagina, etichetta);
    out[k] = k === 'concluse' || k === 'inCorso' ? Number(t.replace(/\./g, '')) : centesimi(t);
  }
  return out;
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
  const [download] = await Promise.all([pagina.waitForEvent('download', { timeout: 15000 }), azione()]);
  const percorso = await download.path();
  return { nome: download.suggestedFilename(), bytes: fs.readFileSync(percorso) };
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

/** Attende che compaia una notifica con quel testo (espressione regolare). */
export async function attendiNotifica(pagina, re) {
  await pagina.waitForFunction(([src, flags]) => new RegExp(src, flags).test(document.querySelector('.toast-area')?.textContent.replace(/\u00a0/g, ' ') ?? ''), [re.source, re.flags]);
}

/** Pulsante di una finestra di dialogo, per nome. */
export const bottoneFinestra = (pagina, nome) => finestra(pagina).locator('button', { hasText: nome }).last();
