// Piccoli attrezzi per costruire l'interfaccia senza librerie esterne.
// Regola di sicurezza: i testi dell'utente entrano nella pagina SOLO come testo (mai come HTML).

const NS_SVG = 'http://www.w3.org/2000/svg';

function aggiungi(el, figli) {
  for (const f of figli.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

/**
 * h('div', { class: 'a', onclick: fn, dataset: { x: 1 } }, 'testo', altroElemento)
 * Proprieta' speciali: class/classe, dataset, style (oggetto), on<evento>, e le proprieta'
 * dei campi (value, checked, disabled, selected, ...) vengono impostate come proprieta'.
 */
export function h(tag, props, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'classe') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'selected', 'disabled', 'readOnly', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  aggiungi(el, figli);
  return el;
}

export function s(tag, props, ...figli) {
  const el = document.createElementNS(NS_SVG, tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'classe') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, String(v));
  }
  aggiungi(el, figli);
  return el;
}

export const $ = (sel, radice = document) => radice.querySelector(sel);
export const $$ = (sel, radice = document) => [...radice.querySelectorAll(sel)];

export function svuota(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Sostituisce il contenuto di un elemento. */
export function monta(contenitore, ...figli) {
  svuota(contenitore);
  aggiungi(contenitore, figli);
  return contenitore;
}

/** Evidenzia nel testo le parole cercate (restituisce nodi sicuri, mai HTML). */
export function evidenzia(testo, termini) {
  const str = String(testo ?? '');
  const parole = termini.filter(Boolean);
  if (!parole.length) return [str];
  const norm = str.normalize('NFD');
  // Mappa posizioni (senza accenti) -> posizioni nel testo originale
  const mappa = [];
  let senza = '';
  for (let i = 0; i < str.length; i++) {
    const parte = str[i].normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const c of parte) { senza += c.toLowerCase(); mappa.push(i); }
  }
  void norm;
  const intervalli = [];
  for (const p of parole) {
    let da = 0;
    while (true) {
      const i = senza.indexOf(p, da);
      if (i < 0) break;
      intervalli.push([mappa[i], mappa[i + p.length - 1] + 1]);
      da = i + p.length;
    }
  }
  if (!intervalli.length) return [str];
  intervalli.sort((a, b) => a[0] - b[0]);
  const uniti = [];
  for (const iv of intervalli) {
    const ultimo = uniti[uniti.length - 1];
    if (ultimo && iv[0] <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], iv[1]);
    else uniti.push([...iv]);
  }
  const out = [];
  let pos = 0;
  for (const [a, b] of uniti) {
    if (a > pos) out.push(str.slice(pos, a));
    out.push(h('mark', null, str.slice(a, b)));
    pos = b;
  }
  if (pos < str.length) out.push(str.slice(pos));
  return out;
}

/** Esegue fn al prossimo ciclo, una sola volta anche se richiesta piu' volte. */
export function unaVolta(fn) {
  let pianificata = false;
  return () => {
    if (pianificata) return;
    pianificata = true;
    queueMicrotask(() => { pianificata = false; fn(); });
  };
}

export function ritarda(fn, ms) {
  let t = null;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.annulla = () => clearTimeout(t);
  return f;
}
