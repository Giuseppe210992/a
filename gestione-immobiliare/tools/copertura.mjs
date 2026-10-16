// Misura quante righe del programma le prove nel browser eseguono davvero e quali no.
// Uso:  npm run copertura            (riepilogo per file)
//       npm run copertura -- --dettagli   (anche l'elenco delle righe mai eseguite)
//
// Costruisce l'interfaccia non minimizzata, esegue tutte le prove nel browser raccogliendo la copertura di V8,
// stampa il rapporto e rimette l'interfaccia normale. Ci vogliono circa 5 minuti.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-copertura-'));
const argomenti = process.argv.slice(2);

function esegui(comando, args, env = {}) {
  const r = spawnSync(comando, args, { cwd: radice, stdio: 'inherit', env: { ...process.env, ...env } });
  return r.status ?? 1;
}

let esito = esegui(process.execPath, ['build.mjs', '--leggibile']);
if (esito === 0) {
  esito = esegui(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=600000', 'tests/e2e/*.e2e.mjs'], { GI_COPERTURA: cartella });
  if (esito !== 0) console.error('\nAlcune prove sono fallite: la copertura che segue è parziale.\n');
  esegui(process.execPath, ['tools/rapporto-copertura.mjs', cartella, ...argomenti]);
}
esegui(process.execPath, ['build.mjs']); // rimette l'interfaccia minimizzata
fs.rmSync(cartella, { recursive: true, force: true });
process.exit(esito);
