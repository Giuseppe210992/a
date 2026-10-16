// Utilita' per i test nel browser (Chromium con Playwright).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const qui = path.dirname(fileURLToPath(import.meta.url));
export const RADICE = path.resolve(qui, '..', '..');
export const URL_APP = `file://${path.join(RADICE, 'dist', 'web', 'index.html')}`;

// Nei test non si apre mai il selettore di file del sistema: si usa il download classico.
const SCRIPT_INIZIALE = `
  try { delete window.showSaveFilePicker; } catch (e) {}
  try { window.showSaveFilePicker = undefined; } catch (e) {}
  // intercetta chi aggiunge a un nodo "null"/"undefined"/"false" come testo (errore tipico di un'interfaccia costruita a mano)
  window.__testoSospetto = [];
  for (const nome of ['append', 'prepend', 'replaceChildren']) {
    const orig = Element.prototype[nome];
    Element.prototype[nome] = function (...args) {
      for (const a of args) if (a === null || a === undefined || a === false || a === 'null' || a === 'undefined') window.__testoSospetto.push(nome + ':' + String(a));
      return orig.apply(this, args);
    };
  }
`;

/** Apre un contesto di Chromium. Con `profilo` i dati (IndexedDB) restano tra una chiusura e l'altra. */
export async function apriContesto({ profilo = null, viewport = { width: 1440, height: 900 }, colorScheme = 'light', locale = 'it-IT', scaricamenti = true } = {}) {
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
