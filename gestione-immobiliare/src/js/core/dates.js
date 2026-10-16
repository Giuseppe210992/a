// Calcoli sulle date. Le date sono sempre stringhe ISO "AAAA-MM-GG" (senza fuso orario)
// e l'aritmetica usa UTC, cosi' l'ora legale non puo' spostare i giorni.
import { meseAnno, dataIt, nomiMesi } from './format.js';

const p2 = (n) => String(n).padStart(2, '0');

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Scarta le date impossibili (es. 31/02).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d, dt };
}

export function dataValida(iso) {
  return parseISO(iso) !== null;
}

function daUTC(dt) {
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

/** Oggi nel fuso orario locale, come "AAAA-MM-GG". */
export function oggi(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function aggiungiGiorni(iso, n) {
  const p = parseISO(iso);
  return daUTC(new Date(Date.UTC(p.y, p.m - 1, p.d + n)));
}

export function giorniTra(daIso, aIso) {
  const a = parseISO(daIso), b = parseISO(aIso);
  return Math.round((b.dt - a.dt) / 86400000);
}

export function chiaveMese(iso) {
  return iso ? iso.slice(0, 7) : null;
}

export function inizioMese(chiave) {
  return `${chiave.slice(0, 7)}-01`;
}

export function fineMese(chiave) {
  const y = +chiave.slice(0, 4), m = +chiave.slice(5, 7);
  return daUTC(new Date(Date.UTC(y, m, 0)));
}

export function aggiungiMesi(chiave, n) {
  const y = +chiave.slice(0, 4), m = +chiave.slice(5, 7);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}`;
}

/** ['2026-01', '2026-02', ...] da una chiave mese all'altra (estremi inclusi). */
export function mesiTra(daChiave, aChiave) {
  const out = [];
  let k = daChiave;
  let guardia = 0;
  while (k <= aChiave && guardia++ < 1200) {
    out.push(k);
    k = aggiungiMesi(k, 1);
  }
  return out;
}

export function anniTra(daAnno, aAnno) {
  const out = [];
  for (let a = daAnno; a <= aAnno; a++) out.push(a);
  return out;
}

export function nelPeriodo(iso, periodo) {
  if (!iso || !periodo) return false;
  return iso >= periodo.da && iso <= periodo.a;
}

/**
 * Risolve il filtro periodo scelto dall'utente in un intervallo [da, a] inclusivo.
 * tipo: 'mese' | 'anno' | 'intervallo' | 'tutto'
 * Per 'tutto' si usano gli estremi dei dati (limiti) oppure l'anno corrente se non ci sono dati.
 */
export function risolviPeriodo(f, oggiIso = oggi(), limiti = null) {
  const tipo = f.tipo;
  if (tipo === 'mese') {
    const k = `${f.anno}-${p2(f.mese)}`;
    return { tipo, da: inizioMese(k), a: fineMese(k), etichetta: meseAnno(k), chiaveMese: k };
  }
  if (tipo === 'anno') {
    return { tipo, da: `${f.anno}-01-01`, a: `${f.anno}-12-31`, etichetta: `Anno ${f.anno}` };
  }
  if (tipo === 'intervallo') {
    let da = parseISO(f.da) ? f.da : oggiIso;
    let a = parseISO(f.a) ? f.a : oggiIso;
    if (da > a) [da, a] = [a, da];
    return { tipo, da, a, etichetta: `${dataIt(da)} – ${dataIt(a)}` };
  }
  // tutto
  const anno = oggiIso.slice(0, 4);
  const da = limiti?.da ?? `${anno}-01-01`;
  const a = limiti?.a && limiti.a > oggiIso ? limiti.a : oggiIso;
  return { tipo: 'tutto', da, a, etichetta: 'Tutto lo storico' };
}

/** Periodo immediatamente precedente, di pari durata (per confrontare le variazioni). */
export function periodoPrecedente(periodo) {
  if (periodo.tipo === 'tutto') return null;
  if (periodo.tipo === 'mese') {
    const k = aggiungiMesi(periodo.chiaveMese, -1);
    return { tipo: 'mese', da: inizioMese(k), a: fineMese(k), etichetta: meseAnno(k), chiaveMese: k };
  }
  if (periodo.tipo === 'anno') {
    const anno = +periodo.da.slice(0, 4) - 1;
    return { tipo: 'anno', da: `${anno}-01-01`, a: `${anno}-12-31`, etichetta: `Anno ${anno}` };
  }
  const durata = giorniTra(periodo.da, periodo.a) + 1;
  const a = aggiungiGiorni(periodo.da, -1);
  const da = aggiungiGiorni(a, -(durata - 1));
  return { tipo: 'intervallo', da, a, etichetta: `${dataIt(da)} – ${dataIt(a)}` };
}

export function nomeMeseLungo(n) {
  return nomiMesi[n - 1];
}

/** Descrizione breve per il tooltip del periodo precedente: "rispetto a settembre 2026". */
export function etichettaConfronto(periodoPrec) {
  return periodoPrec ? `rispetto a ${periodoPrec.etichetta.toLowerCase()}` : '';
}
