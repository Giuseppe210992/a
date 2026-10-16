// Rapporto sulle parti del programma che le prove nel browser NON hanno mai eseguito.
//
// Uso:
//   node build.mjs --leggibile                      (interfaccia non minimizzata: serve per leggere i nomi)
//   GI_COPERTURA=/percorso/cartella node --test --test-concurrency=1 "tests/e2e/*.e2e.mjs"
//   node tools/rapporto-copertura.mjs /percorso/cartella [--dettagli]
//
// Ogni finestra di prova scrive in GI_COPERTURA un file JSON con la copertura di V8; qui i file vengono uniti
// (una riga conta come eseguita se lo è stata in almeno una prova) e attribuiti ai file sorgente tramite i
// commenti "// src/..." che esbuild lascia nel pacchetto non minimizzato.

import fs from 'node:fs';
import path from 'node:path';

const cartella = process.argv[2];
const dettagli = process.argv.includes('--dettagli');
if (!cartella || !fs.existsSync(cartella)) {
  console.error('Indica la cartella con i file di copertura: node tools/rapporto-copertura.mjs <cartella> [--dettagli]');
  process.exit(2);
}

// 1) unione delle coperture: per ogni versione del pacchetto, un contatore per carattere (eseguito in almeno una prova)
const pacchetti = new Map(); // hash -> { sorgente, eseguito }
let file = 0;
for (const nome of fs.readdirSync(cartella).filter((n) => n.startsWith('cop-') && n.endsWith('.json'))) {
  const dati = JSON.parse(fs.readFileSync(path.join(cartella, nome), 'utf8'));
  for (const voce of dati) {
    if (!pacchetti.has(voce.fonte)) {
      const sorgente = fs.readFileSync(path.join(cartella, `fonte-${voce.fonte}.js`), 'utf8');
      pacchetti.set(voce.fonte, { sorgente, eseguito: new Uint8Array(sorgente.length) });
    }
    const { sorgente, eseguito } = pacchetti.get(voce.fonte);
    const intervalli = voce.functions.flatMap((f) => f.ranges);
    // dal più esterno al più interno: l'ultimo che copre un carattere decide
    intervalli.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const questo = new Int32Array(sorgente.length).fill(-1);
    for (const r of intervalli) questo.fill(r.count, r.startOffset, r.endOffset);
    for (let i = 0; i < questo.length; i++) if (questo[i] > 0) eseguito[i] = 1;
  }
  file++;
}
if (!pacchetti.size) {
  console.error('Nessuna copertura di app.js trovata nella cartella.');
  process.exit(2);
}
if (pacchetti.size > 1) console.error(`Attenzione: ${pacchetti.size} versioni diverse del pacchetto; uso la più grande.`);
const { sorgente, eseguito } = [...pacchetti.values()].sort((a, b) => b.sorgente.length - a.sorgente.length)[0];

// 2) righe e file sorgente
const righe = [];
let inizio = 0;
for (const testo of sorgente.split('\n')) {
  righe.push({ testo, da: inizio, a: inizio + testo.length });
  inizio += testo.length + 1;
}
let modulo = '(avvio)';
const perModulo = new Map();
for (let indice = 0; indice < righe.length; indice++) {
  const r = righe[indice];
  const m = /^\s*\/\/ ((?:src|node_modules)\/[^\s]+)$/.exec(r.testo);
  if (m) { modulo = m[1]; continue; }
  const t = r.testo.trim();
  if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || /^[)}\];,]+$/.test(t)) continue; // niente codice
  let codice = 0; let eseguite = 0;
  for (let i = r.da; i < r.a; i++) {
    if (/\s/.test(sorgente[i])) continue;
    codice++; if (eseguito[i]) eseguite++;
  }
  if (!codice) continue;
  const stato = eseguite === 0 ? 'no' : eseguite === codice ? 'si' : 'parte';
  if (!perModulo.has(modulo)) perModulo.set(modulo, { righe: 0, si: 0, parte: 0, no: 0, nonEseguite: [] });
  const dm = perModulo.get(modulo);
  dm.righe++; dm[stato]++;
  if (stato !== 'si') dm.nonEseguite.push({ n: indice + 1, stato, testo: t });
}

// 3) rapporto
const lista = [...perModulo.entries()].filter(([nome]) => nome.startsWith('src/')).sort((a, b) => (a[1].si / a[1].righe) - (b[1].si / b[1].righe));
let tot = 0; let totSi = 0;
console.log(`Copertura delle righe di codice del pacchetto (${file} file di copertura uniti)\n`);
console.log('righe  eseguite   %   file');
for (const [nome, d] of lista) {
  tot += d.righe; totSi += d.si + d.parte * 0.5;
  const pct = Math.round(((d.si + d.parte * 0.5) / d.righe) * 100);
  console.log(`${String(d.righe).padStart(5)}  ${String(d.si).padStart(7)}  ${String(pct).padStart(3)}%  ${nome}${d.parte ? `  (${d.parte} righe in parte)` : ''}`);
}
console.log(`\nTotale: ${tot} righe, ${Math.round((totSi / tot) * 100)}% eseguite (le righe eseguite solo in parte valgono metà).`);

if (dettagli) {
  for (const [nome, d] of lista) {
    if (!d.nonEseguite.length) continue;
    console.log(`\n=== ${nome}`);
    for (const x of d.nonEseguite) console.log(`${String(x.n).padStart(6)} ${x.stato === 'no' ? '✗' : '~'} ${x.testo.slice(0, 170)}`);
  }
}
