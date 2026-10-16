// Apre un vero database SQLite (sql.js) in memoria, come fa il programma.
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { caricaMotore, Archivio } from '../../src/js/data/db.js';
import { DriverMemoria } from '../../src/js/data/drivers/memoria.js';
import { seedPrimoAvvio } from '../../src/js/data/inizializza.js';
import { calcolaModello } from '../../src/js/data/calc/modello.js';
import { leggiDati } from '../../src/js/data/repo/pratiche.js';
import { leggiImpostazioni, opzioniCalcolo } from '../../src/js/data/repo/impostazioni.js';

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));

export const motore = () => caricaMotore(initSqlJs, wasm);

export async function nuovaApp(driver = new DriverMemoria()) {
  const SQL = await motore();
  const archivio = await new Archivio(SQL, driver).apri();
  if (archivio.primoAvvio) await seedPrimoAvvio(archivio);
  return { SQL, driver, archivio };
}

/** Riapre l'archivio dal supporto, come dopo aver chiuso e riaperto il programma. */
export async function riapri(app) {
  app.archivio.chiudi();
  const archivio = await new Archivio(app.SQL, app.driver).apri();
  return { ...app, archivio };
}

export function modelloDi(archivio) {
  return calcolaModello(leggiDati(archivio), opzioniCalcolo(leggiImpostazioni(archivio)));
}
