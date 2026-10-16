// Archivio su file del programma Windows (electron/host-archivio.cjs) provato con file veri,
// insieme al vero archivio SQLite: scrittura atomica, copie di sicurezza, riapertura dopo la chiusura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DriverFile } from '../../src/js/data/drivers/host-file.js';
import { Archivio } from '../../src/js/data/db.js';
import { seedPrimoAvvio } from '../../src/js/data/inizializza.js';
import { salvaPratica, registraIncasso } from '../../src/js/data/repo/pratiche.js';
import { creaZona } from '../../src/js/data/repo/anagrafiche.js';
import { creaBackup, ripristinaBackup, backupAutomatico } from '../../src/js/data/backup.js';
import { motore } from './helpers-db.mjs';

const require = createRequire(import.meta.url);
const { creaHost, cartellaBaseDati, cartellaTemporanea, CARTELLA_PORTATILE } = require('../../electron/host-archivio.cjs');

const cartellaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gi-host-'));
const bytes = (...n) => Uint8Array.from(n);

/** Fa vedere al driver lo stesso ponte che il programma Windows espone alla pagina (ogni chiamata è asincrona). */
function ponte(host) {
  const a = (f) => async (...args) => f(...args);
  return {
    archivio: { carica: a(() => host.carica()), salva: a((b) => host.salva(b)) },
    copie: { elenca: a(() => host.elencaCopie()), crea: a((b, t) => host.creaCopia(b, t)), leggi: a((id) => host.leggiCopia(id)), elimina: a((id) => host.eliminaCopia(id)) },
    file: { salvaCome: a(() => ({ salvato: false, annullato: true })), apri: a(() => null) },
    sistema: { info: a(() => host.info()), apriCartella: a(() => ({ aperta: true })) },
  };
}

test('salvataggio atomico: nessun file temporaneo, la versione precedente resta come .bak', () => {
  const base = cartellaTemp();
  const host = creaHost(base);
  assert.equal(host.carica(), null, 'prima del primo salvataggio non c\'è nulla');
  host.salva(bytes(1, 2, 3));
  assert.deepEqual([...host.carica()], [1, 2, 3]);
  host.salva(bytes(4, 5, 6, 7));
  assert.deepEqual([...host.carica()], [4, 5, 6, 7]);
  assert.deepEqual([...fs.readFileSync(`${host.fileArchivio}.bak`)], [1, 2, 3], 'la versione precedente è conservata');
  assert.deepEqual(fs.readdirSync(host.cartellaDati).sort(), ['archivio.sqlite', 'archivio.sqlite.bak']);
  assert.equal(host.info().percorsoDati, path.join(base, 'Dati', 'archivio.sqlite'));
  fs.rmSync(base, { recursive: true, force: true });
});

test('se il file principale risulta vuoto (interruzione) si usa la versione precedente', () => {
  const base = cartellaTemp();
  const host = creaHost(base);
  host.salva(bytes(9, 9, 9));
  host.salva(bytes(8, 8, 8));
  fs.writeFileSync(host.fileArchivio, Buffer.alloc(0));
  assert.deepEqual([...host.carica()], [9, 9, 9]);
  fs.rmSync(base, { recursive: true, force: true });
});

test('copie di sicurezza: elenco dalla più recente, lettura, eliminazione, tipi e nomi controllati', () => {
  const base = cartellaTemp();
  const host = creaHost(base);
  const a = host.creaCopia(bytes(1), 'manuale', '2026-10-01T08:00:00.000Z');
  const b = host.creaCopia(bytes(2, 2), 'automatico', '2026-10-02T09:30:15.123Z');
  const c = host.creaCopia(bytes(3, 3, 3), 'pre-ripristino', '2026-10-03T10:00:00.000Z');
  assert.deepEqual(host.elencaCopie().map((x) => [x.tipo, x.creatoIl, x.dimensione]), [
    ['pre-ripristino', '2026-10-03T10:00:00.000Z', 3], ['automatico', '2026-10-02T09:30:15.123Z', 2], ['manuale', '2026-10-01T08:00:00.000Z', 1],
  ]);
  assert.deepEqual([...host.leggiCopia(b.id)], [2, 2]);
  host.eliminaCopia(a.id);
  assert.equal(host.elencaCopie().length, 2);
  assert.throws(() => host.leggiCopia(a.id), /non esiste più/);
  // due copie nello stesso istante non si sovrascrivono
  const d1 = host.creaCopia(bytes(7), 'manuale', '2026-10-05T00:00:00.000Z');
  const d2 = host.creaCopia(bytes(8), 'manuale', '2026-10-05T00:00:00.000Z');
  assert.notEqual(d1.id, d2.id);
  assert.deepEqual([...host.leggiCopia(d1.id)], [7]);
  // nomi e tipi non ammessi (nessun accesso fuori dalla cartella dei backup)
  for (const id of ['../Dati/archivio.sqlite', '..\\Dati\\archivio.sqlite', 'copia_manuale_x.sqlite', '/etc/passwd', 'copia_altro_20261001T080000000Z.sqlite', 42, null]) {
    assert.throws(() => host.leggiCopia(id), /non valida/, String(id));
    assert.throws(() => host.eliminaCopia(id), /non valida/, String(id));
  }
  assert.throws(() => host.creaCopia(bytes(1), 'strano'), /Tipo di copia non valido/);
  assert.ok(fs.existsSync(host.fileArchivio) === false, 'le operazioni sulle copie non toccano l\'archivio');
  void c;
  fs.rmSync(base, { recursive: true, force: true });
});

test('con il vero archivio: i dati restano dopo la chiusura e la riapertura del programma', async () => {
  const SQL = await motore();
  const base = cartellaTemp();
  let driver = new DriverFile(ponte(creaHost(base)));
  let archivio = await new Archivio(SQL, driver).apri();
  assert.equal(archivio.primoAvvio, true);
  await seedPrimoAvvio(archivio);
  const zona = await creaZona(archivio, { nome: 'Centro' });
  const id = await salvaPratica(archivio, { codice: '2026/001', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-10-14', zona_id: zona, immobile_indirizzo: 'Via del File 1', compenso_venditore_cent: 300000, compenso_acquirente_cent: 300000 }, [{ collaboratore_id: 1, percentuale: 100 }]);
  await registraIncasso(archivio, { praticaId: id, data: '2026-10-15', importoCent: 200000 });
  await archivio.scarica();
  archivio.chiudi();
  // "riaperto" in un altro momento: nuovo ponte, nuovo driver, nuovo archivio sullo stesso file
  driver = new DriverFile(ponte(creaHost(base)));
  archivio = await new Archivio(SQL, driver).apri();
  assert.equal(archivio.primoAvvio, false);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM pratiche'), 1);
  assert.equal(archivio.valore('SELECT immobile_indirizzo FROM pratiche'), 'Via del File 1');
  assert.equal(archivio.valore('SELECT SUM(importo_cent) FROM incassi'), 200000);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM collaboratori'), 2);
  assert.equal(archivio.valore('PRAGMA integrity_check'), 'ok');
  assert.equal(fs.statSync(path.join(base, 'Dati', 'archivio.sqlite')).size > 4096, true);
  archivio.chiudi();
  fs.rmSync(base, { recursive: true, force: true });
});

test('backup e ripristino su file: la copia contiene i dati di quel momento e il ripristino li riporta', async () => {
  const SQL = await motore();
  const base = cartellaTemp();
  const driver = new DriverFile(ponte(creaHost(base)));
  const archivio = await new Archivio(SQL, driver).apri();
  await seedPrimoAvvio(archivio);
  const app = { SQL, driver, archivio };
  await salvaPratica(archivio, { codice: 'A-1', stato: 'in_corso', data_pratica: '2026-10-01', immobile_indirizzo: 'Prima' }, []);
  const copia = await creaBackup(app, 'manuale');
  await salvaPratica(archivio, { codice: 'A-2', stato: 'in_corso', data_pratica: '2026-10-02', immobile_indirizzo: 'Dopo' }, []);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM pratiche'), 2);
  const esito = await ripristinaBackup(app, copia.id);
  assert.equal(esito.esito.riepilogo.pratiche, 1);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM pratiche'), 1);
  const tipi = (await driver.elencaCopie()).map((c) => c.tipo).sort();
  assert.deepEqual(tipi, ['manuale', 'pre-ripristino']);
  assert.ok(await backupAutomatico(app), 'copia automatica del giorno');
  assert.equal(await backupAutomatico(app), null, 'una sola al giorno');
  // anche il file su disco è quello ripristinato
  const rileggi = await new Archivio(SQL, new DriverFile(ponte(creaHost(base)))).apri();
  assert.equal(rileggi.valore('SELECT COUNT(*) FROM pratiche'), 1);
  rileggi.chiudi(); archivio.chiudi();
  fs.rmSync(base, { recursive: true, force: true });
});

test('se la scrittura sul disco non riesce, l\'errore arriva alla schermata e il file buono resta intatto', async () => {
  const SQL = await motore();
  const base = cartellaTemp();
  const host = creaHost(base);
  const archivio = await new Archivio(SQL, new DriverFile(ponte(host))).apri();
  await seedPrimoAvvio(archivio);
  const prima = fs.readFileSync(host.fileArchivio);
  fs.mkdirSync(`${host.fileArchivio}.tmp`); // il file temporaneo non si può creare: la scrittura fallisce
  await assert.rejects(salvaPratica(archivio, { codice: 'E-1', stato: 'in_corso', data_pratica: '2026-10-01', immobile_indirizzo: 'Errore' }, []), /Impossibile salvare i dati/);
  assert.equal(archivio.statoSalvataggio.stato, 'errore');
  assert.deepEqual(fs.readFileSync(host.fileArchivio), prima, 'il file su disco non è stato toccato');
  // risolto il problema, "Riprova a salvare" scrive anche la modifica rimasta in memoria
  fs.rmdirSync(`${host.fileArchivio}.tmp`);
  await archivio.riprovaSalvataggio();
  assert.equal(archivio.statoSalvataggio.stato, 'salvato');
  const rileggi = await new Archivio(SQL, new DriverFile(ponte(creaHost(base)))).apri();
  assert.equal(rileggi.valore("SELECT COUNT(*) FROM pratiche WHERE codice = 'E-1'"), 1);
  rileggi.chiudi(); archivio.chiudi();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------- dove stanno i dati: sul computer, oppure accanto al programma portatile (chiavetta)

const daNonUsare = () => { throw new Error('la cartella Documenti non doveva servire'); };

test('dove stanno i dati: Documenti per il programma installato, accanto al programma per quello portatile', () => {
  const documenti = () => path.join('D', 'Documenti');
  assert.deepEqual(
    cartellaBaseDati({ env: {}, documenti }),
    { cartella: path.join('D', 'Documenti', 'Gestione Immobiliare'), portatile: false },
    'installato: nella cartella Documenti');
  assert.deepEqual(
    cartellaBaseDati({ env: { PORTABLE_EXECUTABLE_DIR: path.join('E:', 'Chiavetta') }, documenti: daNonUsare }),
    { cartella: path.join('E:', 'Chiavetta', 'Gestione Immobiliare - Dati'), portatile: true },
    'portatile: accanto al programma, senza nemmeno chiedere dov\'è Documenti');
  assert.equal(CARTELLA_PORTATILE, 'Gestione Immobiliare - Dati', 'il nome è scritto nelle istruzioni e nella schermata Backup');
});

test('dove stanno i dati: una cartella scelta di proposito vince sempre, un valore vuoto non conta', () => {
  assert.deepEqual(
    cartellaBaseDati({ env: { GESTIONE_IMMOBILIARE_DATI: 'X', PORTABLE_EXECUTABLE_DIR: 'E:' }, documenti: daNonUsare }),
    { cartella: 'X', portatile: false });
  assert.deepEqual(
    cartellaBaseDati({ env: { GESTIONE_IMMOBILIARE_DATI: '', PORTABLE_EXECUTABLE_DIR: 'E:' }, documenti: daNonUsare }),
    { cartella: path.join('E:', 'Gestione Immobiliare - Dati'), portatile: true });
});

test('chiavetta: si riconosce il programma aperto da una cartella temporanea (tipicamente dentro lo ZIP scaricato)', () => {
  const tmp = path.resolve('sistema', 'Temp');
  assert.equal(cartellaTemporanea(path.join(tmp, 'Temp1_Gestione-Immobiliare-per-Windows.zip'), tmp), true, 'aperto dentro lo ZIP da Esplora file');
  assert.equal(cartellaTemporanea(path.join(tmp, '7zO1A2B3C'), tmp), true, 'aperto da un programma di archivi');
  assert.equal(cartellaTemporanea(path.resolve('Scaricati', 'Gestione-Immobiliare-per-Windows.zip', 'Portatile'), tmp), true, 'percorso che passa da un .zip');
  assert.equal(cartellaTemporanea(path.resolve('Chiavetta'), tmp), false, 'chiavetta o cartella normale');
  assert.equal(cartellaTemporanea(path.resolve('sistema', 'Temporanei'), tmp), false, 'un nome che inizia solo allo stesso modo non conta');
  assert.equal(cartellaTemporanea(path.resolve('Scaricati'), tmp), false);
});

test('chiavetta: i dati e le copie vanno accanto al programma, non sul computer, e seguono la chiavetta se la copi altrove', async () => {
  const SQL = await motore();
  const chiavetta = cartellaTemp();
  const { cartella, portatile } = cartellaBaseDati({ env: { PORTABLE_EXECUTABLE_DIR: chiavetta }, documenti: daNonUsare });
  assert.equal(portatile, true);

  // un archivio vero, con una zona e una pratica, salvato e copiato come fa il programma
  const driver = new DriverFile(ponte(creaHost(cartella)));
  const archivio = await new Archivio(SQL, driver).apri();
  await seedPrimoAvvio(archivio);
  const zona = await creaZona(archivio, { nome: 'Zona prova' });
  await salvaPratica(archivio, { codice: 'USB-1', stato: 'in_corso', data_pratica: '2026-10-01', zona_id: zona, immobile_indirizzo: 'Via della Chiavetta 1' }, []);
  await creaBackup({ SQL, driver, archivio }, 'manuale');
  await archivio.scarica();
  archivio.chiudi();

  assert.ok(fs.existsSync(path.join(chiavetta, 'Gestione Immobiliare - Dati', 'Dati', 'archivio.sqlite')), 'archivio accanto al programma');
  const copie = fs.readdirSync(path.join(chiavetta, 'Gestione Immobiliare - Dati', 'Backup'));
  assert.equal(copie.length, 1, 'anche la copia di sicurezza è sulla chiavetta');
  assert.match(copie[0], /^copia_manuale_.*\.sqlite$/);

  // la chiavetta (o la sua cartella) copiata altrove porta con sé gli stessi dati
  const altroPc = cartellaTemp();
  fs.cpSync(chiavetta, altroPc, { recursive: true });
  const riaperto = await new Archivio(SQL, new DriverFile(ponte(creaHost(
    cartellaBaseDati({ env: { PORTABLE_EXECUTABLE_DIR: altroPc }, documenti: daNonUsare }).cartella)))).apri();
  assert.equal(riaperto.primoAvvio, false);
  assert.equal(riaperto.valore('SELECT immobile_indirizzo FROM pratiche'), 'Via della Chiavetta 1');
  assert.equal(riaperto.valore('SELECT nome FROM zone WHERE id = ?', [zona]), 'Zona prova');
  riaperto.chiudi();
  fs.rmSync(chiavetta, { recursive: true, force: true });
  fs.rmSync(altroPc, { recursive: true, force: true });
});
