// Struttura del database SQLite e migrazioni.
// Il numero di versione e' salvato nel file stesso (PRAGMA user_version), insieme a un
// identificativo dell'applicazione (PRAGMA application_id): cosi' un backup si riconosce
// anche prima di aprirlo e non si puo' importare per errore un database di un altro programma.

export const ID_APPLICAZIONE = 0x47494d4d; // "GIMM"
export const VERSIONE_SCHEMA = 2;

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
  {
    versione: 2,
    // La tabella "pratiche" viene ricostruita: per il tempo della modifica i vincoli tra tabelle si spengono
    // (altrimenti eliminare la vecchia tabella cancellerebbe a cascata quote e incassi).
    senzaVincoli: true,
    sql: `
      -- 1) pratiche: l'indirizzo dell'immobile non e' piu' obbligatorio (conta la zona) e per ogni parte
      --    (venditore, acquirente) si registra quanto e' stato pagato in contanti (senza IVA), con bonifico
      --    e con assegno (IVA compresa). Le pratiche gia' presenti restano com'erano (compensi_da_pagamenti = 0).
      CREATE TEMP TABLE sequenza_pratiche AS SELECT seq FROM sqlite_sequence WHERE name = 'pratiche';

      CREATE TABLE pratiche_nuova (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codice TEXT NOT NULL UNIQUE COLLATE NOCASE,
        stato TEXT NOT NULL CHECK (stato IN ('in_corso', 'conclusa', 'annullata')),
        data_pratica TEXT NOT NULL,
        data_rogito TEXT,
        zona_id INTEGER REFERENCES zone(id) ON DELETE RESTRICT,
        immobile_indirizzo TEXT,
        immobile_comune TEXT,
        immobile_tipo TEXT,
        prezzo_vendita_cent INTEGER CHECK (prezzo_vendita_cent IS NULL OR prezzo_vendita_cent >= 0),
        prezzo_acquisto_cent INTEGER CHECK (prezzo_acquisto_cent IS NULL OR prezzo_acquisto_cent >= 0),
        venditore TEXT,
        acquirente TEXT,
        compensi_da_pagamenti INTEGER NOT NULL DEFAULT 0 CHECK (compensi_da_pagamenti IN (0, 1)),
        venditore_contanti_cent INTEGER NOT NULL DEFAULT 0 CHECK (venditore_contanti_cent >= 0),
        venditore_bonifico_cent INTEGER NOT NULL DEFAULT 0 CHECK (venditore_bonifico_cent >= 0),
        venditore_assegno_cent INTEGER NOT NULL DEFAULT 0 CHECK (venditore_assegno_cent >= 0),
        acquirente_contanti_cent INTEGER NOT NULL DEFAULT 0 CHECK (acquirente_contanti_cent >= 0),
        acquirente_bonifico_cent INTEGER NOT NULL DEFAULT 0 CHECK (acquirente_bonifico_cent >= 0),
        acquirente_assegno_cent INTEGER NOT NULL DEFAULT 0 CHECK (acquirente_assegno_cent >= 0),
        compenso_venditore_cent INTEGER NOT NULL DEFAULT 0 CHECK (compenso_venditore_cent >= 0),
        compenso_acquirente_cent INTEGER NOT NULL DEFAULT 0 CHECK (compenso_acquirente_cent >= 0),
        aliquota_iva REAL NOT NULL DEFAULT 22 CHECK (aliquota_iva >= 0 AND aliquota_iva <= 100),
        note TEXT,
        creato_il TEXT NOT NULL,
        aggiornato_il TEXT NOT NULL
      );
      INSERT INTO pratiche_nuova (
        id, codice, stato, data_pratica, data_rogito, zona_id, immobile_indirizzo, immobile_comune, immobile_tipo,
        prezzo_vendita_cent, prezzo_acquisto_cent, venditore, acquirente, compenso_venditore_cent, compenso_acquirente_cent,
        aliquota_iva, note, creato_il, aggiornato_il
      ) SELECT
        id, codice, stato, data_pratica, data_rogito, zona_id, immobile_indirizzo, immobile_comune, immobile_tipo,
        prezzo_vendita_cent, prezzo_acquisto_cent, venditore, acquirente, compenso_venditore_cent, compenso_acquirente_cent,
        aliquota_iva, note, creato_il, aggiornato_il
      FROM pratiche;
      DROP TABLE pratiche;
      ALTER TABLE pratiche_nuova RENAME TO pratiche;
      CREATE INDEX ix_pratiche_stato ON pratiche (stato);
      CREATE INDEX ix_pratiche_rogito ON pratiche (data_rogito);
      CREATE INDEX ix_pratiche_zona ON pratiche (zona_id);
      -- il contatore dei numeri di riga non deve tornare indietro (un numero gia' usato non si riusa)
      UPDATE sqlite_sequence SET seq = (SELECT seq FROM sequenza_pratiche) WHERE name = 'pratiche' AND seq < (SELECT seq FROM sequenza_pratiche);
      INSERT INTO sqlite_sequence (name, seq) SELECT 'pratiche', seq FROM sequenza_pratiche WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'pratiche');
      DROP TABLE sequenza_pratiche;

      -- 2) ripartizione automatica: come si divide una pratica tra i collaboratori a seconda della zona
      CREATE TABLE zone_quote (
        zona_id INTEGER NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
        collaboratore_id INTEGER NOT NULL REFERENCES collaboratori(id) ON DELETE RESTRICT,
        percentuale REAL NOT NULL CHECK (percentuale > 0 AND percentuale <= 100),
        PRIMARY KEY (zona_id, collaboratore_id)
      ) WITHOUT ROWID;
      CREATE INDEX ix_zone_quote_collaboratore ON zone_quote (collaboratore_id);
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

const violazioniVincoli = (db) => {
  const r = db.exec('PRAGMA foreign_key_check');
  return r.length ? r[0].values.length : 0;
};

/**
 * Porta il database all'ultima versione (o, per le prove, fino a `versioneMassima`).
 * Restituisce la versione di partenza.
 */
export function migra(db, versioneMassima = VERSIONE_SCHEMA) {
  const partenza = versioneDatabase(db);
  if (partenza > VERSIONE_SCHEMA) {
    throw new Error(
      `Questo archivio è stato creato da una versione più recente del programma (schema ${partenza}, questa versione conosce lo schema ${VERSIONE_SCHEMA}). Aggiorna il programma.`,
    );
  }
  for (const m of MIGRAZIONI) {
    if (m.versione <= partenza || m.versione > versioneMassima) continue;
    // I vincoli tra tabelle si spengono PRIMA di aprire la transazione (dentro una transazione non hanno effetto).
    if (m.senzaVincoli) db.run('PRAGMA foreign_keys = OFF');
    try {
      const prima = m.senzaVincoli ? violazioniVincoli(db) : 0;
      db.run('BEGIN');
      try {
        db.run(m.sql);
        // La ricostruzione di una tabella non deve introdurre riferimenti spezzati (quelli gia' presenti restano com'erano).
        if (m.senzaVincoli && violazioniVincoli(db) > prima) throw new Error(`La modifica dell'archivio alla versione ${m.versione} avrebbe lasciato dati scollegati: archivio non modificato.`);
        db.run(`PRAGMA user_version = ${m.versione}`);
        db.run('COMMIT');
      } catch (e) {
        try { db.run('ROLLBACK'); } catch { /* gia' annullata */ }
        throw e;
      }
    } finally {
      if (m.senzaVincoli) db.run('PRAGMA foreign_keys = ON');
    }
  }
  db.run(`PRAGMA application_id = ${ID_APPLICAZIONE}`);
  return partenza;
}
