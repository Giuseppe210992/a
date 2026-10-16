import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ICONE } from '../../src/js/core/icone.js';

// Un nome di icona sbagliato non dà errore: disegna un riquadro vuoto. Questa prova li scopre.
function fileJs(cartella) {
  return fs.readdirSync(cartella, { withFileTypes: true }).flatMap(voce => {
    const percorso = path.join(cartella, voce.name);
    if (voce.isDirectory()) return fileJs(percorso);
    return percorso.endsWith('.js') ? [percorso] : [];
  });
}

test('ogni icona richiesta per nome nel codice esiste nel set incorporato', () => {
  const radice = path.join(import.meta.dirname, '..', '..', 'src', 'js');
  const mancanti = [];
  for (const file of fileJs(radice)) {
    const testo = fs.readFileSync(file, 'utf8');
    for (const m of testo.matchAll(/icona\(\s*'([a-z0-9-]+)'/g)) {
      if (!ICONE[m[1]]) mancanti.push(`${m[1]} (${path.relative(radice, file)})`);
    }
  }
  assert.deepEqual(mancanti, [], `Icone non definite: ${mancanti.join(', ')}`);
});

test('ogni icona del set ha un disegno non vuoto', () => {
  for (const [nome, disegno] of Object.entries(ICONE)) {
    assert.ok(typeof disegno === 'string' && disegno.includes('<'), `L'icona «${nome}» è vuota`);
  }
});
