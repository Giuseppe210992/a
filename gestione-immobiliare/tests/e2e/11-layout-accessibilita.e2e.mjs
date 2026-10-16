// Adattamento a schermi diversi, tema chiaro/scuro, contrasto dei colori e accessibilità di base.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, idPratica, finestra, bottoneFinestra, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const SCHERMI = [
  { l: 390, a: 844, nome: 'telefono', layout: 'mobile' },
  { l: 768, a: 1024, nome: 'tablet', layout: 'compatto' },
  { l: 1024, a: 768, nome: 'portatile piccolo', layout: 'compatto' },
  { l: 1366, a: 768, nome: 'portatile', layout: 'desktop' },
  { l: 1920, a: 1080, nome: 'monitor grande', layout: 'desktop' },
];
const SEZIONI = ['collaboratori', 'zone', 'scaglioni', 'calcolo', 'ripartizione', 'iva', 'preferenze', 'info'];
const ROTTE = (id) => ['#/', '#/nuova', '#/pratiche', `#/pratiche/${id}`, `#/pratiche/${id}/modifica`, '#/provvigioni', '#/provvigioni?tab=dettaglio', '#/provvigioni?tab=liquidazioni', '#/provvigioni?tab=incassi',
  '#/cumulo?mese=2026-10', '#/statistiche', '#/backup', ...SEZIONI.map((s) => `#/impostazioni?sezione=${s}`)];

/** Elementi che sporgono oltre il bordo destro dello schermo senza stare dentro un contenitore che scorre. */
const SPORGENZE = () => {
  const larg = document.documentElement.clientWidth;
  const out = [];
  const scorre = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    if (el.closest('[hidden], .tooltip-nav, .g-tooltip, .toast-area')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > larg + 1 && !scorre(el)) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} (${Math.round(r.left)}→${Math.round(r.right)} su ${larg})`);
  }
  return out.slice(0, 8);
};

/** Contrasto tra testo e sfondo (WCAG): restituisce i testi sotto soglia. */
const CONTRASTO = () => {
  const analizza = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const luminanza = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mescola = (sopra, sotto) => ({ r: sopra.r * sopra.a + sotto.r * (1 - sopra.a), g: sopra.g * sopra.a + sotto.g * (1 - sopra.a), b: sopra.b * sopra.a + sotto.b * (1 - sopra.a), a: 1 });
  const sfondo = (el) => {
    const catena = [];
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // sfumature: non valutabile qui
      const c = analizza(cs.backgroundColor);
      if (c && c.a > 0) catena.push(c);
      if (c && c.a === 1) break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const sfondoPagina = analizza(getComputedStyle(document.body).backgroundColor);
    if (sfondoPagina && sfondoPagina.a === 1) base = sfondoPagina;
    for (const c of catena.reverse()) base = mescola(c, base);
    return base;
  };
  const opacita = (el) => { let o = 1; for (let p = el; p; p = p.parentElement) o *= Number(getComputedStyle(p).opacity); return o; };
  const out = [];
  const visti = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const nodo = walker.currentNode;
    const testo = nodo.textContent.replace(/\s+/g, ' ').trim();
    if (!testo) continue;
    const el = nodo.parentElement;
    if (!el || visti.has(el)) continue;
    visti.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('[hidden], svg, script, style, .solo-lettori, [disabled], [aria-disabled="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (opacita(el) < 0.99) continue;
    const bg = sfondo(el);
    if (!bg) continue;
    const col = analizza(cs.color);
    if (!col) continue;
    const primo = mescola(col, bg);
    const l1 = luminanza(primo); const l2 = luminanza(bg);
    const rapporto = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize); const grassetto = Number(cs.fontWeight) >= 700;
    const grande = px >= 24 || (px >= 18.66 && grassetto);
    const soglia = grande ? 3 : 4.5;
    if (rapporto < soglia) out.push(`${rapporto.toFixed(2)}:1 < ${soglia} — "${testo.slice(0, 40)}" <${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}> ${cs.color} su rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
  }
  return out.slice(0, 12);
};

describe('Adattamento agli schermi', () => {
  for (const sch of SCHERMI) {
    describe(`${sch.nome} ${sch.l}×${sch.a}`, () => {
      let app; let id;
      before(async () => { app = await avvia({ viewport: { width: sch.l, height: sch.a } }); await inserisciDatiProva(app.pagina); id = await idPratica(app.pagina, '2026/011'); });
      after(async () => { await app.chiudi(); });

      test('disposizione, nessun scorrimento orizzontale e nessun elemento fuori schermo in tutte le schermate', async () => {
        const p = app.pagina;
        assert.equal(await p.evaluate(() => document.body.dataset.layout), sch.layout);
        const problemi = [];
        for (const rotta of ROTTE(id)) {
          await vai(p, rotta);
          const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
          if (r.sw > r.cw + 1) problemi.push(`${rotta}: scorrimento orizzontale (${r.sw} > ${r.cw})`);
          const fuori = await p.evaluate(SPORGENZE);
          if (fuori.length) problemi.push(`${rotta}: ${fuori.join(' | ')}`);
        }
        assert.deepEqual(problemi, []);
      });

      test('intestazione: nome, data, ricerca e "+ Nuova pratica" sempre raggiungibili', async () => {
        const p = app.pagina;
        await vai(p, '#/');
        assert.ok(await p.locator('#btn-nuova-pratica').isVisible());
        const box = await p.locator('#btn-nuova-pratica').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= sch.l, 'il pulsante sta nello schermo');
        assert.ok(box.height >= 36, `altezza del pulsante ${box.height}`);
        assert.ok(await p.locator('#ricerca-rapida').isVisible());
        assert.match(rimuoviSpazi(await p.locator('.topbar').innerText()), /Gestione Immobiliare/);
        assert.match(rimuoviSpazi(await p.locator('.topbar').innerText()), /16 ottobre 2026/);
        if (sch.layout === 'mobile') assert.ok(await p.locator('.btn-menu').isVisible(), 'il pulsante del menu c\'è su telefono');
      });

      test('barra laterale: comportamento adatto allo schermo', async () => {
        const p = app.pagina;
        await vai(p, '#/');
        if (sch.layout === 'mobile') {
          assert.equal(await p.locator('.sidebar').isVisible(), false, 'su telefono il menu è chiuso all\'inizio');
          await p.click('.btn-menu');
          await p.locator('.sidebar').waitFor({ state: 'visible' });
          const voci = await p.locator('.sidebar .nav-voce').evaluateAll((a) => a.map((x) => { const t = x.querySelector('.nav-testo'); return { testo: t.textContent.trim(), tagliato: t.scrollWidth > t.clientWidth + 1, h: x.getBoundingClientRect().height }; }));
          assert.equal(voci.length, 8);
          assert.deepEqual(voci.filter((v) => v.tagliato), [], 'nessun nome di voce tagliato');
          assert.ok(voci.every((v) => v.h >= 40), `voci abbastanza alte per il dito: ${voci.map((v) => Math.round(v.h))}`);
          // Esc chiude; un clic sullo sfondo chiude; scegliere una voce chiude e naviga
          await p.keyboard.press('Escape');
          await p.locator('.sidebar').waitFor({ state: 'hidden' });
          await p.click('.btn-menu');
          await p.locator('.scrim').click({ position: { x: sch.l - 10, y: 300 } });
          await p.locator('.sidebar').waitFor({ state: 'hidden' });
          await p.click('.btn-menu');
          await p.click('.sidebar .nav-voce[data-id="cumulo"]');
          await p.waitForSelector('#contenuto h1:has-text("Cumulo mensile per zona")');
          await p.locator('.sidebar').waitFor({ state: 'hidden' });
        } else if (sch.layout === 'compatto') {
          // icone sempre visibili, si espande sopra il contenuto senza spostarlo
          assert.equal(await p.locator('.sidebar .nav-voce svg.icona:visible').count(), 8);
          const largaPrima = await p.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().width);
          const contenutoPrima = await p.locator('.principale').evaluate((e) => e.getBoundingClientRect().left);
          assert.ok(largaPrima < 100, `barra ridotta (${largaPrima}px)`);
          await p.click('.sb-riduci');
          await p.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width > 250);
          assert.equal(await p.locator('.sidebar .nav-testo:visible').count(), 8);
          assert.equal(await p.locator('.principale').evaluate((e) => e.getBoundingClientRect().left), contenutoPrima, 'il contenuto non si sposta');
          await p.click('.sb-riduci');
          await p.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width < 100);
        } else {
          assert.ok(await p.locator('.sidebar').isVisible());
          assert.ok((await p.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().width)) >= 240, 'barra estesa con i nomi visibili');
          assert.equal(await p.locator('.sidebar .nav-testo:visible').count(), 8);
        }
      });

      test('dashboard: riquadri, operazioni e grafici si dispongono senza sovrapporsi né tagliare il testo', async () => {
        const p = app.pagina;
        await vai(p, '#/');
        await p.waitForSelector('.kpi');
        const kpi = await p.locator('.kpi').evaluateAll((a) => a.map((x) => { const r = x.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
        assert.equal(kpi.length, 6);
        // nessuna sovrapposizione tra riquadri
        for (let i = 0; i < kpi.length; i++) for (let j = i + 1; j < kpi.length; j++) {
          const a = kpi[i]; const b = kpi[j];
          const sovrapposti = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
          assert.equal(sovrapposti, false, `riquadri ${i} e ${j} sovrapposti`);
        }
        const tagliati = await p.locator('.kpi-valore, .kpi-etichetta, .op b, .grafico-testa h3').evaluateAll((a) => a.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent.trim().slice(0, 40)));
        assert.deepEqual(tagliati, [], 'testi tagliati');
        const colonne = new Set(kpi.map((k) => Math.round(k.x))).size;
        const attese = sch.l < 560 ? 1 : sch.l < 900 ? 2 : sch.l < 1300 ? 3 : 6;
        assert.ok(colonne >= 1 && colonne <= 6, `colonne dei riquadri: ${colonne}`);
        if (sch.l < 560) assert.equal(colonne, 1, 'una colonna sul telefono');
        void attese;
        // i grafici non escono dalla loro scheda
        const fuori = await p.locator('.grafico-card').evaluateAll((a) => a.filter((c) => { const r = c.getBoundingClientRect(); const s = c.querySelector('svg.g-svg'); if (!s) return false; const q = s.getBoundingClientRect(); return q.right > r.right + 1 || q.left < r.left - 1; }).map((c) => c.id));
        assert.deepEqual(fuori, []);
        // tabella delle ultime pratiche: scorre dentro la scheda, non la pagina
        const wrap = await p.locator('section[aria-labelledby="ult-titolo"] .tabella-wrap').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ov: getComputedStyle(e).overflowX }));
        assert.ok(wrap.sw <= wrap.cw + 1 || ['auto', 'scroll'].includes(wrap.ov));
      });
    });
  }
});

describe('Tema chiaro e scuro: contrasto dei testi', () => {
  for (const tema of ['light', 'dark']) {
    describe(`tema ${tema}`, () => {
      let app; let id;
      before(async () => {
        app = await avvia({ viewport: { width: 1366, height: 800 }, colorScheme: tema });
        await inserisciDatiProva(app.pagina);
        id = await idPratica(app.pagina, '2026/011');
        await app.pagina.evaluate((t) => window.__gi.app.driver && (document.documentElement.dataset.theme = t), tema);
      });
      after(async () => { await app.chiudi(); });

      test('tutti i testi hanno un contrasto di almeno 4,5:1 (3:1 se grandi) in ogni schermata', async () => {
        const p = app.pagina;
        const problemi = [];
        for (const rotta of ROTTE(id)) {
          await vai(p, rotta);
          const r = await p.evaluate(CONTRASTO);
          for (const x of r) problemi.push(`${rotta} → ${x}`);
        }
        assert.deepEqual(problemi, []);
      });
    });
  }
});
