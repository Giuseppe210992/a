// Passaggio dell'archivio dalla versione 1 alla 2 (indirizzo non più obbligatorio, importi pagati per parte,
// ripartizione per zona): niente deve andare perso né scollegarsi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motore } from './helpers-db.mjs';
import { migra, versioneDatabase, VERSIONE_SCHEMA } from '../../src/js/data/schema.js';

const T = '2026-10-01T10:00:00.000Z';

async function archivioV1() {
  const SQL = await motore();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  migra(db, 1);
  assert.equal(versioneDatabase(db), 1);
  db.run(`INSERT INTO collaboratori (nome, creato_il, aggiornato_il) VALUES ('Luca', '${T}', '${T}'), ('Giuseppe', '${T}', '${T}')`);
  db.run(`INSERT INTO zone (nome, creato_il, aggiornato_il) VALUES ('Centro', '${T}', '${T}')`);
  const pratica = (n, extra = '') => db.run(
    `INSERT INTO pratiche (codice, stato, data_pratica, data_rogito, zona_id, immobile_indirizzo, immobile_comune, immobile_tipo, prezzo_vendita_cent,
       venditore, acquirente, compenso_venditore_cent, compenso_acquirente_cent, aliquota_iva, note, creato_il, aggiornato_il)
     VALUES ('2026/00${n}', 'conclusa', '2026-09-0${n}', '2026-09-1${n}', 1, 'Via Roma ${n}', 'Roccaverde', 'Appartamento', ${n}0000000,
       'Rossi', 'Bianchi', ${n}00000, ${n}00000, 22, 'nota ${n}', '${T}', '${T}')${extra}`);
  for (const n of [1, 2, 3]) pratica(n);
  db.run('DELETE FROM pratiche WHERE id = 3'); // un numero usato e poi cancellato: non deve essere riutilizzato dopo la migrazione
  db.run('INSERT INTO quote (pratica_id, collaboratore_id, percentuale) VALUES (1, 1, 60), (1, 2, 40), (2, 1, 100)');
  db.run(`INSERT INTO incassi (pratica_id, data, importo_cent, pagante, metodo, creato_il) VALUES (1, '2026-09-20', 100000, 'Venditore', 'Bonifico', '${T}')`);
  db.run(`INSERT INTO liquidazioni (collaboratore_id, data, creato_il) VALUES (1, '2026-10-01', '${T}')`);
  db.run('INSERT INTO liquidazioni_righe (liquidazione_id, pratica_id, importo_cent) VALUES (1, 1, 5000)');
  db.run('INSERT INTO scaglioni (zona_id, da_cent, percentuale) VALUES (NULL, 0, 5), (NULL, 260001, 8)');
  db.run(`INSERT INTO impostazioni (chiave, valore) VALUES ('calcolo.metodo', '"progressivo"')`);
  return db;
}

const conta = (db, t) => db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0];
const righe = (db, sql) => { const r = db.exec(sql); return r.length ? r[0].values : []; };

test('migrazione 1 → 2: pratiche, quote, incassi e liquidazioni restano tutti, con gli stessi numeri', async () => {
  const db = await archivioV1();
  const prima = {
    pratiche: righe(db, 'SELECT id, codice, stato, data_pratica, data_rogito, zona_id, immobile_indirizzo, immobile_comune, immobile_tipo, prezzo_vendita_cent, venditore, acquirente, compenso_venditore_cent, compenso_acquirente_cent, aliquota_iva, note, creato_il, aggiornato_il FROM pratiche ORDER BY id'),
    quote: righe(db, 'SELECT * FROM quote ORDER BY 1, 2'),
    incassi: righe(db, 'SELECT * FROM incassi'),
    righe: righe(db, 'SELECT * FROM liquidazioni_righe'),
  };
  assert.equal(migra(db), 1, 'riparte dalla versione 1');
  assert.equal(versioneDatabase(db), VERSIONE_SCHEMA);
  assert.equal(VERSIONE_SCHEMA, 2);
  assert.deepEqual(righe(db, 'SELECT id, codice, stato, data_pratica, data_rogito, zona_id, immobile_indirizzo, immobile_comune, immobile_tipo, prezzo_vendita_cent, venditore, acquirente, compenso_venditore_cent, compenso_acquirente_cent, aliquota_iva, note, creato_il, aggiornato_il FROM pratiche ORDER BY id'), prima.pratiche);
  assert.deepEqual(righe(db, 'SELECT * FROM quote ORDER BY 1, 2'), prima.quote);
  assert.deepEqual(righe(db, 'SELECT * FROM incassi'), prima.incassi);
  assert.deepEqual(righe(db, 'SELECT * FROM liquidazioni_righe'), prima.righe);
  assert.equal(conta(db, 'scaglioni'), 2);
  assert.equal(righe(db, "SELECT valore FROM impostazioni WHERE chiave = 'calcolo.metodo'")[0][0], '"progressivo"');
  // le pratiche di prima restano "vecchie": compenso senza IVA + IVA in cima, nessun pagamento registrato
  assert.deepEqual(righe(db, 'SELECT DISTINCT compensi_da_pagamenti, venditore_contanti_cent, venditore_bonifico_cent, acquirente_assegno_cent FROM pratiche'), [[0, 0, 0, 0]]);
  assert.deepEqual(righe(db, 'PRAGMA foreign_key_check'), []);
  assert.equal(righe(db, 'PRAGMA integrity_check')[0][0], 'ok');
});

test('migrazione 1 → 2: i collegamenti funzionano ancora (eliminare una pratica porta via le sue quote e i suoi incassi, ma non quella con liquidazioni)', async () => {
  const db = await archivioV1();
  migra(db);
  db.run('PRAGMA foreign_keys = ON');
  assert.throws(() => db.run('DELETE FROM pratiche WHERE id = 1'), /FOREIGN KEY/i, 'la pratica 1 ha una liquidazione');
  db.run('DELETE FROM pratiche WHERE id = 2');
  assert.deepEqual(righe(db, 'SELECT pratica_id FROM quote ORDER BY pratica_id, collaboratore_id').flat(), [1, 1], 'le quote della pratica 2 sono sparite');
  db.run('DELETE FROM liquidazioni_righe');
  db.run('DELETE FROM pratiche WHERE id = 1');
  assert.equal(conta(db, 'quote'), 0);
  assert.equal(conta(db, 'incassi'), 0, 'anche gli incassi se ne vanno con la pratica');
  // una pratica con zona inesistente viene rifiutata come prima
  assert.throws(() => db.run(`INSERT INTO pratiche (codice, stato, data_pratica, zona_id, creato_il, aggiornato_il) VALUES ('X', 'conclusa', '2026-10-01', 99, '${T}', '${T}')`), /FOREIGN KEY/i);
});

test('migrazione 1 → 2: un numero di pratica già usato e poi cancellato non viene riutilizzato', async () => {
  const db = await archivioV1();
  migra(db);
  db.run(`INSERT INTO pratiche (codice, stato, data_pratica, creato_il, aggiornato_il) VALUES ('2026/009', 'conclusa', '2026-10-01', '${T}', '${T}')`);
  assert.equal(righe(db, 'SELECT last_insert_rowid()')[0][0], 4, 'la 3 era stata usata: la prossima è la 4');
});

test('migrazione 1 → 2: l\'indirizzo non è più obbligatorio, ci sono i sei importi per parte e la ripartizione per zona', async () => {
  const db = await archivioV1();
  migra(db);
  db.run(`INSERT INTO pratiche (codice, stato, data_pratica, zona_id, compensi_da_pagamenti, venditore_bonifico_cent, acquirente_contanti_cent, creato_il, aggiornato_il)
          VALUES ('2026/010', 'conclusa', '2026-10-17', 1, 1, 366000, 200000, '${T}', '${T}')`);
  assert.deepEqual(righe(db, "SELECT immobile_indirizzo, venditore_bonifico_cent, acquirente_contanti_cent, venditore_assegno_cent FROM pratiche WHERE codice = '2026/010'"), [[null, 366000, 200000, 0]]);
  assert.throws(() => db.run(`UPDATE pratiche SET venditore_assegno_cent = -1 WHERE codice = '2026/010'`), /CHECK/i, 'gli importi non possono essere negativi');
  db.run('INSERT INTO zone_quote (zona_id, collaboratore_id, percentuale) VALUES (1, 1, 60), (1, 2, 40)');
  assert.throws(() => db.run('INSERT INTO zone_quote (zona_id, collaboratore_id, percentuale) VALUES (1, 1, 10)'), /UNIQUE|PRIMARY/i, 'una zona non ripete lo stesso collaboratore');
  assert.throws(() => db.run('INSERT INTO zone_quote (zona_id, collaboratore_id, percentuale) VALUES (1, 2, 0)'), /UNIQUE|CHECK|PRIMARY/i);
  assert.throws(() => db.run('DELETE FROM collaboratori WHERE id = 1'), /FOREIGN KEY/i, 'un collaboratore usato da una zona non si elimina');
  db.run('DELETE FROM zone WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM pratiche WHERE zona_id = 1)'); // la zona ha pratiche: resta
  assert.equal(conta(db, 'zone_quote'), 2);
});

test('migrazione 1 → 2: dati già scollegati nell\'archivio vecchio non bloccano l\'apertura (restano come erano, li segnala la verifica)', async () => {
  const db = await archivioV1();
  db.run('PRAGMA foreign_keys = OFF');
  db.run('INSERT INTO quote (pratica_id, collaboratore_id, percentuale) VALUES (77, 1, 50)'); // pratica inesistente
  assert.doesNotThrow(() => migra(db));
  assert.equal(versioneDatabase(db), 2);
  assert.equal(righe(db, 'PRAGMA foreign_key_check').length, 1, 'il problema c\'era e c\'è ancora: la migrazione non lo nasconde né lo peggiora');
  assert.equal(conta(db, 'pratiche'), 2);
});

test('un archivio nuovo parte già dalla versione 2 e una seconda migrazione non cambia nulla', async () => {
  const SQL = await motore();
  const db = new SQL.Database();
  assert.equal(migra(db), 0);
  assert.equal(versioneDatabase(db), 2);
  assert.equal(migra(db), 2);
  assert.equal(righe(db, 'PRAGMA foreign_keys')[0][0], 1, 'i vincoli tra tabelle restano accesi');
});
