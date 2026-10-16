// Guardia contro un errore tipico delle interfacce costruite a mano: passare null/false a append(), prepend()
// o replaceChildren() del browser scrive la parola "null" (o "false") nella pagina.
// Le funzioni del programma (h, monta) scartano i valori vuoti; le chiamate dirette no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');

function* tuttiIFile(dir) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) yield* tuttiIFile(p);
    else if (voce.name.endsWith('.js')) yield p;
  }
}

/** Restituisce il testo tra le parentesi che iniziano in `inizio` (che punta subito dopo la "("), e dove finisce. */
function corpoChiamata(src, inizio) {
  let profondita = 1;
  let i = inizio;
  while (i < src.length && profondita > 0) {
    const c = src[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
    } else if (c === '`') {
      i++;
      let prof = 0;
      while (i < src.length && !(src[i] === '`' && prof === 0)) {
        if (src[i] === '\\') i++;
        else if (src[i] === '$' && src[i + 1] === '{') { prof++; i++; }
        else if (src[i] === '}' && prof > 0) prof--;
        i++;
      }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '(' || c === '[' || c === '{') profondita++;
    else if (c === ')' || c === ']' || c === '}') profondita--;
    i++;
  }
  return src.slice(inizio, i - 1);
}

/** Divide gli argomenti al primo livello e svuota le parentesi annidate per guardare solo la forma esterna. */
function argomenti(corpo) {
  const out = [];
  let profondita = 0;
  let corrente = '';
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (c === "'" || c === '"') {
      const q = c;
      let s = c;
      i++;
      while (i < corpo.length && corpo[i] !== q) { if (corpo[i] === '\\') { s += corpo[i]; i++; } s += corpo[i]; i++; }
      s += q;
      if (profondita === 0) corrente += '""';
      continue;
    }
    if (c === '`') {
      i++;
      let prof = 0;
      while (i < corpo.length && !(corpo[i] === '`' && prof === 0)) {
        if (corpo[i] === '\\') i++;
        else if (corpo[i] === '$' && corpo[i + 1] === '{') { prof++; i++; }
        else if (corpo[i] === '}' && prof > 0) prof--;
        i++;
      }
      if (profondita === 0) corrente += '""';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { if (profondita === 0) corrente += c; profondita++; continue; }
    if (c === ')' || c === ']' || c === '}') { profondita--; if (profondita === 0) corrente += c; continue; }
    if (c === ',' && profondita === 0) { out.push(corrente.trim()); corrente = ''; continue; }
    if (profondita === 0) corrente += c;
  }
  if (corrente.trim()) out.push(corrente.trim());
  return out;
}

const VUOTO = '(null|undefined|false)';
function rischioso(arg) {
  if (/\.filter\(\)/.test(arg)) return false; // `[...].filter(Boolean)` svuotato dalla funzione sopra: gestito sotto
  if (new RegExp(`\\?\\s*${VUOTO}\\b`).test(arg) || new RegExp(`:\\s*${VUOTO}\\s*$`).test(arg)) return true;
  if (/(&&|\|\||\?\?)/.test(arg)) return true;
  return false;
}

test('append/prepend/replaceChildren non ricevono valori che possono essere null o false', () => {
  const problemi = [];
  for (const file of tuttiIFile(radice)) {
    const src = fs.readFileSync(file, 'utf8');
    const rx = /\.(append|prepend|replaceChildren)\(/g;
    let m;
    while ((m = rx.exec(src))) {
      const corpo = corpoChiamata(src, m.index + m[0].length);
      // la chiamata e' sicura se tutto l'elenco e' passato da .filter(Boolean)
      if (/^\.\.\.\s*\[[\s\S]*\]\s*\.filter\(\)\s*$/.test(argomenti(corpo).join(','))) continue;
      for (const a of argomenti(corpo)) {
        if (rischioso(a)) {
          const riga = src.slice(0, m.index).split('\n').length;
          problemi.push(`${path.relative(radice, file)}:${riga}  ${m[1]}(…${a.slice(0, 70)}…)`);
        }
      }
    }
  }
  assert.deepEqual(problemi, [], `Argomenti che possono scrivere "null" nella pagina:\n${problemi.join('\n')}`);
});

test('il controllo riconosce i casi pericolosi e lascia passare quelli sicuri', () => {
  const analizza = (codice) => {
    const m = /\.(append|prepend|replaceChildren)\(/.exec(codice);
    const corpo = corpoChiamata(codice, m.index + m[0].length);
    if (/^\.\.\.\s*\[[\s\S]*\]\s*\.filter\(\)\s*$/.test(argomenti(corpo).join(','))) return false;
    return argomenti(corpo).some(rischioso);
  };
  assert.equal(analizza("x.append(a ? h('i') : null)"), true);
  assert.equal(analizza("x.replaceChildren(h('b'), cond && h('i'))"), true);
  assert.equal(analizza("x.prepend(valore ?? null)"), true);
  assert.equal(analizza("x.append(h('div', null, a ? h('i') : null))"), false);
  assert.equal(analizza("x.replaceChildren(...[h('b'), a ? h('i') : null].filter(Boolean))"), false);
  assert.equal(analizza("x.append(...voci.map((v) => h('li', null, v)))"), false);
  assert.equal(analizza("x.append(testo, h('b', null, 'a, b'))"), false);
});
