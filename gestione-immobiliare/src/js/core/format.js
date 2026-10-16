// Formati italiani: importi in euro, percentuali, numeri e date.
// Tutti gli importi del programma sono interi in CENTESIMI: niente errori di arrotondamento.

const NBSP = ' ';

const fmtEuro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const fmtEuroInt = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', useGrouping: 'always', minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const fmtNum = new Intl.NumberFormat('it-IT', { useGrouping: 'always', maximumFractionDigits: 2 });
const fmtNumDec = new Intl.NumberFormat('it-IT', { useGrouping: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const fmtCompatto = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

/** 123456 -> "1.234,56 €" */
export function eur(cent) {
  if (cent === null || cent === undefined || Number.isNaN(cent)) return '—';
  return fmtEuro.format(cent / 100);
}

/** 123456 -> "1.235 €" (senza decimali, per riquadri e assi) */
export function eurInt(cent) {
  if (cent === null || cent === undefined || Number.isNaN(cent)) return '—';
  return fmtEuroInt.format(cent / 100);
}

/** Importo con segno esplicito: +1.234,56 € / -1.234,56 € */
export function eurSegno(cent) {
  if (cent === null || cent === undefined || Number.isNaN(cent)) return '—';
  return (cent > 0 ? '+' : cent < 0 ? '−' : '') + fmtEuro.format(Math.abs(cent) / 100);
}

/** Etichetta compatta per gli assi: 0, 5 k, 1,2 M (in euro, non in centesimi). */
export function eurCompatto(cent) {
  const v = Math.abs(cent) / 100;
  const s = cent < 0 ? '−' : '';
  if (v >= 1e6) return s + fmtCompatto.format(v / 1e6) + NBSP + 'M';
  if (v >= 1e3) return s + fmtCompatto.format(v / 1e3) + NBSP + 'k';
  return s + fmtNum.format(v);
}

/** Numero intero o con decimali, formato italiano. */
export function num(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return fmtNum.format(n);
}

export function numDec(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return fmtNumDec.format(n);
}

/** 35 -> "35%", 35.5 -> "35,5%" */
export function pct(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  return fmtPct.format(p) + '%';
}

/** Variazione percentuale con segno: +12,5% */
export function pctSegno(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return (p > 0 ? '+' : p < 0 ? '−' : '') + fmtPct.format(Math.abs(p)) + '%';
}

/**
 * Legge un importo scritto dall'utente e lo restituisce in centesimi.
 * Accetta "1.234,56", "1234,56", "1234.56", "€ 1.234", "1 234,5".
 * Restituisce null se vuoto o non valido.
 */
export function leggiEuro(testo) {
  if (testo === null || testo === undefined) return null;
  let s = String(testo).trim().replace(/[€\s ]/g, '');
  if (s === '') return null;
  let negativo = false;
  if (s.startsWith('-') || s.startsWith('−')) { negativo = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const haVirgola = s.includes(',');
  const punti = (s.match(/\./g) || []).length;
  if (haVirgola) {
    // La virgola e' il separatore decimale, i punti sono migliaia.
    if ((s.match(/,/g) || []).length > 1) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (punti > 1) {
    s = s.replace(/\./g, '');
  } else if (punti === 1) {
    // "1.234" = mille duecento trentaquattro; "12.5" / "1234.56" = decimali.
    if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cent = Math.round(n * 100);
  return negativo ? -cent : cent;
}

/** Legge una percentuale ("35", "35,5", "35%") e restituisce un numero, o null. */
export function leggiPercentuale(testo) {
  if (testo === null || testo === undefined) return null;
  const s = String(testo).trim().replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Per i campi di input: centesimi -> "1234,56" (senza simbolo ne' migliaia). */
export function euroPerInput(cent) {
  if (cent === null || cent === undefined) return '';
  const negativo = cent < 0;
  const a = Math.abs(cent);
  const intero = Math.floor(a / 100);
  const dec = String(a % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}${intero},${dec}`;
}

/** Per i campi di input: percentuale -> "35,5" */
export function pctPerInput(p) {
  if (p === null || p === undefined) return '';
  return String(p).replace('.', ',');
}

// ---------------------------------------------------------------- date

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export const nomiMesi = MESI;
export const nomiMesiBrevi = MESI_BREVI;

function parti(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** "2026-10-16" -> "16/10/2026" */
export function dataIt(iso) {
  const p = parti(iso);
  if (!p) return '—';
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/** "2026-10-16" -> "venerdì 16 ottobre 2026" */
export function dataEstesa(iso) {
  const p = parti(iso);
  if (!p) return '—';
  const g = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${GIORNI[g]} ${p.d} ${MESI[p.m - 1]} ${p.y}`;
}

/** "2026-10" o "2026-10-16" -> "ottobre 2026" */
export function meseAnno(chiave) {
  const m = /^(\d{4})-(\d{2})/.exec(chiave || '');
  if (!m) return '—';
  return `${MESI[+m[2] - 1]} ${m[1]}`;
}

/** "2026-10" -> "ott 26" */
export function meseBreve(chiave) {
  const m = /^(\d{4})-(\d{2})/.exec(chiave || '');
  if (!m) return '—';
  return `${MESI_BREVI[+m[2] - 1]} ${m[1].slice(2)}`;
}

/** Data e ora locali da un timestamp ISO: "16/10/2026 14:35" */
export function dataOra(isoTimestamp) {
  if (!isoTimestamp) return '—';
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Dimensione file leggibile: 1,4 MB */
export function dimensioneFile(byte) {
  if (byte === null || byte === undefined) return '—';
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${fmtCompatto.format(byte / 1024)} KB`;
  return `${fmtCompatto.format(byte / 1024 / 1024)} MB`;
}

/** Prima lettera maiuscola. */
export function maiuscola(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Normalizza per la ricerca: minuscole e senza accenti. */
export function normalizza(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Testo per file CSV (campo con delimitatore ';'). */
export function csvCampo(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Importo in centesimi -> "1234,56" per CSV/Excel italiano. */
export function csvEuro(cent) {
  if (cent === null || cent === undefined) return '';
  return euroPerInput(cent);
}
