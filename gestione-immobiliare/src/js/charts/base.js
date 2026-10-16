// Fondamenta dei grafici: scale, testi misurati, tooltip, legenda e tabella alternativa.
// Ogni grafico e' SVG puro (nessuna libreria), si ridisegna quando cambia la larghezza
// e usa le variabili CSS dei temi chiaro/scuro: il cambio tema non richiede di ridisegnare.
import { h, s } from '../core/dom.js';
import { icona } from '../core/icone.js';

// ------------------------------------------------------------ scale

export function passoPulito(grezzo, intero = false) {
  const esp = 10 ** Math.floor(Math.log10(grezzo));
  const f = grezzo / esp;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  let passo = m * esp;
  if (intero) passo = Math.max(1, Math.ceil(passo));
  return passo;
}

/** Scala da 0 a un massimo "tondo", con 3-5 tacche. */
export function scalaVerticale(massimo, { intero = false, tacche = 4 } = {}) {
  let max = massimo;
  if (!(max > 0)) max = intero ? 4 : 100000; // senza dati: asse di cortesia
  const passo = passoPulito(max / tacche, intero);
  const n = Math.max(1, Math.ceil(max / passo - 1e-9));
  return { max: n * passo, passo, tacche: Array.from({ length: n + 1 }, (_, i) => i * passo) };
}

// ------------------------------------------------------------ misura del testo

let canvas = null;
const cacheMisure = new Map();
export function larghezzaTesto(testo, px = 12, peso = 400) {
  const k = `${px}|${peso}|${testo}`;
  if (cacheMisure.has(k)) return cacheMisure.get(k);
  let w;
  try {
    canvas = canvas || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${peso} ${px}px system-ui, "Segoe UI", sans-serif`;
    w = ctx.measureText(testo).width;
  } catch {
    w = testo.length * px * 0.58;
  }
  if (!w) w = testo.length * px * 0.58;
  if (cacheMisure.size > 2000) cacheMisure.clear();
  cacheMisure.set(k, w);
  return w;
}

export function tronca(testo, maxPx, px = 12, peso = 400) {
  if (larghezzaTesto(testo, px, peso) <= maxPx) return testo;
  let t = testo;
  while (t.length > 1 && larghezzaTesto(`${t}…`, px, peso) > maxPx) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// ------------------------------------------------------------ geometria

/** Barra con l'estremita' (alto) arrotondata di 4px e la base squadrata. */
export function barraVerticale(x, yAlto, larghezza, altezza, { arrotonda = true } = {}) {
  if (altezza <= 0) return '';
  const r = arrotonda ? Math.min(4, larghezza / 2, altezza) : 0;
  const y = yAlto, b = yAlto + altezza;
  return `M${x},${b}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : `V${y}`}H${x + larghezza - r}${r ? `Q${x + larghezza},${y} ${x + larghezza},${y + r}` : `H${x + larghezza}`}V${b}Z`;
}

/** Barra orizzontale con l'estremita' destra arrotondata. */
export function barraOrizzontale(xInizio, y, lunghezza, spessore, { arrotonda = true } = {}) {
  if (lunghezza <= 0) return '';
  const r = arrotonda ? Math.min(4, spessore / 2, lunghezza) : 0;
  const x2 = xInizio + lunghezza;
  return `M${xInizio},${y}H${x2 - r}${r ? `Q${x2},${y} ${x2},${y + r}` : `H${x2}`}V${y + spessore - r}${r ? `Q${x2},${y + spessore} ${x2 - r},${y + spessore}` : `V${y + spessore}`}H${xInizio}Z`;
}

// ------------------------------------------------------------ tooltip

export function creaTooltip(host) {
  const el = h('div', { class: 'g-tooltip', role: 'status', hidden: true });
  host.append(el);
  return {
    mostra(x, y, intestazione, righe, nota = null) {
      el.replaceChildren(
        h('div', { class: 'g-tt-testa' }, intestazione),
        ...righe.map((r) => h('div', { class: 'g-tt-riga' },
          r.colore !== undefined ? h('span', { class: `g-tt-chiave g-serie-${r.colore}${r.linea ? ' linea' : ''}`, 'aria-hidden': 'true' }) : null,
          h('span', { class: 'g-tt-nome' }, r.nome),
          h('strong', { class: 'g-tt-valore' }, r.valore))),
        nota ? h('div', { class: 'g-tt-nota' }, nota) : null,
      );
      el.hidden = false;
      const w = el.offsetWidth, hh = el.offsetHeight;
      const maxX = host.clientWidth - w - 4;
      let left = x + 14;
      if (left > maxX) left = x - w - 14;
      left = Math.max(4, Math.min(left, maxX));
      let top = y - hh - 12;
      if (top < 0) top = y + 16;
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(0, top)}px`;
    },
    nascondi() { el.hidden = true; },
    rimuovi() { el.remove(); },
  };
}

// ------------------------------------------------------------ legenda

/** Legenda con interruttori: un clic nasconde/mostra la serie. Per una sola serie non serve. */
export function creaLegenda(serie, nascoste, alCambio, { forma = 'quadrato' } = {}) {
  if (serie.length < 2) return null;
  return h('ul', { class: 'g-legenda', 'aria-label': 'Legenda' }, serie.map((sr) => {
    const spenta = nascoste.has(sr.id);
    return h('li', null, h('button', {
      type: 'button', class: 'g-legenda-voce', 'aria-pressed': String(!spenta), title: spenta ? 'Mostra la serie' : 'Nascondi la serie',
      onclick: () => {
        if (nascoste.has(sr.id)) nascoste.delete(sr.id);
        else if (serie.length - nascoste.size > 1) nascoste.add(sr.id);
        alCambio();
      },
    }, h('span', { class: `g-legenda-chiave g-serie-${sr.colore} ${forma}` }), h('span', null, sr.nome)));
  }));
}

// ------------------------------------------------------------ tabella alternativa

/** Tabella equivalente del grafico: categorie in riga, serie in colonna. */
export function tabellaDaSpec(spec, { totale = false } = {}) {
  const fmt = spec.formato?.valore || String;
  const conTot = totale && spec.serie.length > 1;
  return h('div', { class: 'tabella-wrap' },
    h('table', { class: 'tabella tabella-compatta' },
      h('caption', { class: 'solo-lettori' }, spec.titolo || 'Dati del grafico'),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, spec.nomeCategorie || 'Periodo'),
        ...spec.serie.map((sr) => h('th', { scope: 'col', class: 'num' }, sr.nome)),
        conTot ? h('th', { scope: 'col', class: 'num' }, 'Totale') : null)),
      h('tbody', null, spec.categorie.map((c, i) => h('tr', null,
        h('th', { scope: 'row' }, c.etichettaLunga || c.etichetta, c.dim ? h('span', { class: 'sottotesto' }, ' (fuori periodo)') : null),
        ...spec.serie.map((sr) => h('td', { class: 'num' }, fmt(sr.valori[i]))),
        conTot ? h('td', { class: 'num forte' }, fmt(spec.serie.reduce((a, sr) => a + (sr.valori[i] || 0), 0))) : null))),
      spec.totali ? h('tfoot', null, h('tr', null,
        h('td', null, 'Nel periodo'),
        ...spec.serie.map((sr) => h('td', { class: 'num' }, fmt(spec.totali[sr.id] ?? 0))),
        conTot ? h('td', { class: 'num' }, '') : null)) : null,
    ),
  );
}

// ------------------------------------------------------------ montaggio responsive

/**
 * Collega una funzione di disegno a un contenitore: la richiama quando cambia la larghezza.
 * disegna(host, spec, larghezza, stato) deve riempire host (svuotato prima).
 */
export function montaGrafico(host, disegna, statoIniziale = {}) {
  let spec = null;
  let ultimaLarghezza = 0;
  const stato = { nascoste: new Set(), attivo: -1, ...statoIniziale };
  const ridisegna = () => {
    if (!spec) return;
    const w = Math.floor(host.clientWidth);
    if (w < 40) return;
    ultimaLarghezza = w;
    host.replaceChildren();
    disegna(host, spec, w, stato, ridisegna);
  };
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (Math.floor(host.clientWidth) !== ultimaLarghezza) ridisegna();
    });
    ro.observe(host);
  }
  return {
    aggiorna(nuovaSpec) { spec = nuovaSpec; ridisegna(); },
    ridisegna,
    stato,
    distruggi() { if (ro) ro.disconnect(); },
  };
}

/** Messaggio al posto del grafico quando non ci sono dati nel periodo. */
export function statoVuotoGrafico(messaggio, nomeIcona = 'chart-no-axes-column') {
  return h('div', { class: 'g-vuoto' }, icona(nomeIcona, { dimensione: 28 }), h('p', null, messaggio));
}

export { h, s };
