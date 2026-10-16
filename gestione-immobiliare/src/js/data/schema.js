// Struttura del database SQLite e migrazioni.
// Il numero di versione e' salvato nel file stesso (PRAGMA user_version), insieme a un
// identificativo dell'applicazione (PRAGMA application_id): cosi' un backup si riconosce
// anche prima di aprirlo e non si puo' importare per errore un database di un altro programma.

export const ID_APPLICAZIONE = 0x47494d4d; // "GIMM"
export const VERSIONE_SCHEMA = 1;

const MIGRAZIONI = [
  {
    versione: 1,
    sql: `
      CREATE TABLE impostazioni (
        chiave TEXT PRIMARY KEY,
        valore TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE collaboratori (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL CHECK (length(trim(nome)) > 0),
        attivo INTEGER NOT NULL DEFAULT 1 CHECK (attivo IN (0, 1)),
        colore INTEGER NOT NULL DEFAULT 1 CHECK (colore BETWEEN 1 AND 8),
        note TEXT,
        creato_il TEXT NOT NULL,
        aggiornato_il TEXT NOT NULL
      );

      CREATE TABLE zone (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(nome)) > 0),
        attiva INTEGER NOT NULL DEFAULT 1 CHECK (attiva IN (0, 1)),
        colore INTEGER NOT NULL DEFAULT 1 CHECK (colore BETWEEN 1 AND 8),
        usa_scaglioni_propri INTEGER NOT NULL DEFAULT 0 CHECK (usa_scaglioni_propri IN (0, 1)),
        note TEXT,
        creato_il TEXT NOT NULL,
        aggiornato_il TEXT NOT NULL
      );

      CREATE TABLE scaglioni (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zona_id INTEGER REFERENCES zone(id) ON DELETE CASCADE,
        da_cent INTEGER NOT NULL CHECK (da_cent >= 0),
        percentuale REAL NOT NULL CHECK (percentuale >= 0 AND percentuale <= 100)
      );
      CREATE UNIQUE INDEX ux_scaglioni_soglia ON scaglioni (COALESCE(zona_id, 0), da_cent);

      CREATE TABLE pratiche (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codice TEXT NOT NULL UNIQUE COLLATE NOCASE,
        stato TEXT NOT NULL CHECK (stato IN ('in_corso', 'conclusa', 'annullata')),
        data_pratica TEXT NOT NULL,
        data_rogito TEXT,
        zona_id INTEGER REFERENCES zone(id) ON DELETE RESTRICT,
        immobile_indirizzo TEXT NOT NULL CHECK (length(trim(immobile_indirizzo)) > 0),
        immobile_comune TEXT,
        immobile_tipo TEXT,
        prezzo_vendita_cent INTEGER CHECK (prezzo_vendita_cent IS NULL OR prezzo_vendita_cent >= 0),
        prezzo_acquisto_cent INTEGER CHECK (prezzo_acquisto_cent IS NULL OR prezzo_acquisto_cent >= 0),
        venditore TEXT,
        acquirente TEXT,
        compenso_venditore_cent INTEGER NOT NULL DEFAULT 0 CHECK (compenso_venditore_cent >= 0),
        compenso_acquirente_cent INTEGER NOT NULL DEFAULT 0 CHECK (compenso_acquirente_cent >= 0),
        aliquota_iva REAL NOT NULL DEFAULT 22 CHECK (aliquota_iva >= 0 AND aliquota_iva <= 100),
        note TEXT,
        creato_il TEXT NOT NULL,
        aggiornato_il TEXT NOT NULL
      );
      CREATE INDEX ix_pratiche_stato ON pratiche (stato);
      CREATE INDEX ix_pratiche_rogito ON pratiche (data_rogito);
      CREATE INDEX ix_pratiche_zona ON pratiche (zona_id);

      CREATE TABLE quote (
        pratica_id INTEGER NOT NULL REFERENCES pratiche(id) ON DELETE CASCADE,
        collaboratore_id INTEGER NOT NULL REFERENCES collaboratori(id) ON DELETE RESTRICT,
        percentuale REAL NOT NULL CHECK (percentuale > 0 AND percentuale <= 100),
        PRIMARY KEY (pratica_id, collaboratore_id)
      ) WITHOUT ROWID;
      CREATE INDEX ix_quote_collaboratore ON quote (collaboratore_id);

      CREATE TABLE incassi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pratica_id INTEGER NOT NULL REFERENCES pratiche(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        importo_cent INTEGER NOT NULL CHECK (importo_cent > 0),
        pagante TEXT,
        metodo TEXT,
        note TEXT,
        creato_il TEXT NOT NULL
      );
      CREATE INDEX ix_incassi_pratica ON incassi (pratica_id);

      CREATE TABLE liquidazioni (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collaboratore_id INTEGER NOT NULL REFERENCES collaboratori(id) ON DELETE RESTRICT,
        data TEXT NOT NULL,
        metodo TEXT,
        note TEXT,
        creato_il TEXT NOT NULL
      );

      CREATE TABLE liquidazioni_righe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        liquidazione_id INTEGER NOT NULL REFERENCES liquidazioni(id) ON DELETE CASCADE,
        pratica_id INTEGER NOT NULL REFERENCES pratiche(id) ON DELETE RESTRICT,
        importo_cent INTEGER NOT NULL CHECK (importo_cent > 0)
      );
      CREATE INDEX ix_righe_liquidazione ON liquidazioni_righe (liquidazione_id);
      CREATE INDEX ix_righe_pratica ON liquidazioni_righe (pratica_id);

      CREATE TABLE registro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        tipo TEXT NOT NULL,
        dettaglio TEXT
      );
    `,
  },
];

export function versioneDatabase(db) {
  const r = db.exec('PRAGMA user_version');
  return r.length ? r[0].values[0][0] : 0;
}

export function idApplicazioneDatabase(db) {
  const r = db.exec('PRAGMA application_id');
  return r.length ? r[0].values[0][0] : 0;
}

/** Porta il database all'ultima versione. Restituisce la versione di partenza. */
export function migra(db) {
  const partenza = versioneDatabase(db);
  if (partenza > VERSIONE_SCHEMA) {
    throw new Error(
      `Questo archivio è stato creato da una versione più recente del programma (schema ${partenza}, questa versione conosce lo schema ${VERSIONE_SCHEMA}). Aggiorna il programma.`,
    );
  }
  for (const m of MIGRAZIONI) {
    if (m.versione <= partenza) continue;
    db.run('BEGIN');
    try {
      db.run(m.sql);
      db.run(`PRAGMA user_version = ${m.versione}`);
      db.run('COMMIT');
    } catch (e) {
      try { db.run('ROLLBACK'); } catch { /* gia' annullata */ }
      throw e;
    }
  }
  db.run(`PRAGMA application_id = ${ID_APPLICAZIONE}`);
  return partenza;
}
