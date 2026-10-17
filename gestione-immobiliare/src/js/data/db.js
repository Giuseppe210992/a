// Archivio: wrapper sul database SQLite (sql.js) con salvataggio duraturo.
//
// Ogni modifica passa da transazione(): se la funzione fallisce, la modifica viene annullata per intero;
// se riesce, l'intero database viene scritto sul supporto (file o cartella) PRIMA che
// la chiamata si consideri conclusa. Cosi' un "Salvato" mostrato all'utente e' sempre vero.

import { migra, versioneDatabase, idApplicazioneDatabase, ID_APPLICAZIONE, VERSIONE_SCHEMA } from './schema.js';

let promessaSql = null;

/** Carica il motore SQLite una sola volta. initSqlJs e wasmBinary arrivano dal chiamante (browser o test). */
export function caricaMotore(initSqlJs, wasmBinary) {
  if (!promessaSql) promessaSql = initSqlJs({ wasmBinary });
  return promessaSql;
}

export class ErroreArchivio extends Error {
  constructor(messaggio, codice = 'archivio') {
    super(messaggio);
    this.name = 'ErroreArchivio';
    this.codice = codice;
  }
}

function aperturaSicura(SQL, bytes) {
  const db = new SQL.Database(bytes);
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

/** Controlla che i byte siano un archivio di Gestione Immobiliare leggibile. */
export function ispezionaBytes(SQL, bytes) {
  const esito = { valido: false, motivo: null, versione: null, integrita: null, riepilogo: null };
  if (!bytes || bytes.length < 100) { esito.motivo = 'Il file è vuoto o troppo piccolo per essere un archivio.'; return esito; }
  const intestazione = String.fromCharCode(...bytes.slice(0, 15));
  if (intestazione !== 'SQLite format 3') { esito.motivo = 'Il file non è un archivio di Gestione Immobiliare (non è un database SQLite).'; return esito; }
  let db;
  try {
    db = new SQL.Database(bytes);
  } catch (e) {
    esito.motivo = 'Il file è danneggiato e non può essere aperto.';
    return esito;
  }
  try {
    const app = idApplicazioneDatabase(db);
    if (app !== ID_APPLICAZIONE) { esito.motivo = 'Questo database non appartiene a Gestione Immobiliare.'; return esito; }
    esito.versione = versioneDatabase(db);
    if (esito.versione > VERSIONE_SCHEMA) {
      esito.motivo = 'L\'archivio è stato creato da una versione più recente del programma.';
      return esito;
    }
    const ic = db.exec('PRAGMA integrity_check');
    const risposta = ic.length ? ic[0].values.map((r) => r[0]) : ['ok'];
    esito.integrita = risposta.length === 1 && risposta[0] === 'ok' ? 'ok' : risposta.slice(0, 5).join('; ');
    if (esito.integrita !== 'ok') { esito.motivo = `Il file è danneggiato: ${esito.integrita}`; return esito; }
    const conta = (tab) => db.exec(`SELECT COUNT(*) FROM ${tab}`)[0].values[0][0];
    const date = db.exec('SELECT MIN(COALESCE(data_rogito, data_pratica)), MAX(COALESCE(data_rogito, data_pratica)) FROM pratiche')[0].values[0];
    esito.riepilogo = {
      pratiche: conta('pratiche'),
      collaboratori: conta('collaboratori'),
      zone: conta('zone'),
      incassi: conta('incassi'),
      liquidazioni: conta('liquidazioni'),
      primaData: date[0],
      ultimaData: date[1],
    };
    esito.valido = true;
    return esito;
  } catch (e) {
    esito.motivo = `Il file non ha la struttura attesa (${e.message}).`;
    return esito;
  } finally {
    db.close();
  }
}

export class Archivio {
  /**
   * @param {object} SQL      motore sql.js gia' inizializzato
   * @param {object} driver   supporto di memorizzazione (vedi drivers/)
   */
  constructor(SQL, driver) {
    this.SQL = SQL;
    this.driver = driver;
    this.db = null;
    this.versione = 0;          // aumenta a ogni modifica: serve a invalidare le cache e ridisegnare
    this._inTransazione = false;
    this._ascoltatori = new Set();
    this._ascoltatoriStato = new Set();
    this._catena = Promise.resolve();
    this.ultimoSalvataggio = null;
    this.primoAvvio = false;
    this.statoSalvataggio = { stato: 'inattivo', errore: null };
  }

  /** Apre l'archivio dal supporto; se non esiste lo crea. Se e' illeggibile lancia ErroreArchivio. */
  async apri() {
    const bytes = await this.driver.carica();
    if (bytes && bytes.length) {
      const esito = ispezionaBytes(this.SQL, bytes);
      if (!esito.valido) {
        const e = new ErroreArchivio(esito.motivo, 'illeggibile');
        e.esito = esito;
        throw e;
      }
      this.db = aperturaSicura(this.SQL, bytes);
      migra(this.db);
      this.db.run('PRAGMA foreign_keys = ON');
      if (esito.versione < VERSIONE_SCHEMA) await this._scrivi();
    } else {
      this.db = aperturaSicura(this.SQL);
      migra(this.db);
      this.db.run('PRAGMA foreign_keys = ON');
      this.primoAvvio = true;
    }
    return this;
  }

  // ------------------------------------------------------------ lettura

  tutti(sql, parametri = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(parametri);
      const righe = [];
      while (stmt.step()) righe.push(stmt.getAsObject());
      return righe;
    } finally {
      stmt.free();
    }
  }

  uno(sql, parametri = []) {
    return this.tutti(sql, parametri)[0];
  }

  valore(sql, parametri = []) {
    const r = this.uno(sql, parametri);
    return r ? Object.values(r)[0] : undefined;
  }

  // ------------------------------------------------------------ scrittura

  /** Esegue una scrittura fuori da transazione() (solo dentro una transazione aperta). */
  esegui(sql, parametri = []) {
    if (!this._inTransazione) throw new ErroreArchivio('Scrittura fuori da una transazione.', 'interno');
    this.db.run(sql, parametri);
    return this.db.getRowsModified();
  }

  ultimoId() {
    return this.db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  }

  /**
   * Esegue fn() in transazione, salva su supporto e avvisa chi ascolta.
   * fn deve essere sincrona. Se lancia un errore, non cambia nulla.
   * Chiamata da dentro un'altra transazione, fn viene eseguita subito nella stessa transazione
   * (valore restituito o errore lanciato direttamente); altrimenti restituisce una Promise.
   */
  transazione(fn, opzioni = {}) {
    if (this._inTransazione) return fn(this);
    return this._transazioneEsterna(fn, opzioni);
  }

  async _transazioneEsterna(fn, { silenzioso = false } = {}) {
    this._inTransazione = true;
    this.db.run('BEGIN');
    let risultato;
    try {
      risultato = fn(this);
      this.db.run('COMMIT');
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch { /* niente da annullare */ }
      throw e;
    } finally {
      this._inTransazione = false;
    }
    this.versione += 1;
    await this._scrivi();
    if (!silenzioso) this._notifica();
    return risultato;
  }

  /** Scrive il database sul supporto, una scrittura per volta, nell'ordine delle richieste. */
  _scrivi() {
    const lavoro = this._catena.then(async () => {
      this._impostaStato('salvataggio');
      try {
        const bytes = this.esporta();
        await this.driver.salva(bytes);
        this.ultimoSalvataggio = new Date().toISOString();
        this._impostaStato('salvato');
      } catch (e) {
        this._impostaStato('errore', e);
        throw new ErroreArchivio(`Impossibile salvare i dati: ${e.message}`, 'salvataggio');
      }
    });
    this._catena = lavoro.catch(() => {});
    return lavoro;
  }

  /** Riprova a scrivere sul supporto l'ultimo stato (dopo un errore di salvataggio). */
  async riprovaSalvataggio() {
    await this._scrivi();
    this._notifica();
  }

  /** Byte del database (sql.js chiude e riapre la connessione: si riattivano i vincoli). */
  esporta() {
    const bytes = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON');
    return bytes;
  }

  /** Sostituisce l'intero contenuto con un altro archivio (importazione / ripristino). */
  async sostituisciCon(bytes) {
    const esito = ispezionaBytes(this.SQL, bytes);
    if (!esito.valido) throw new ErroreArchivio(esito.motivo, 'non_valido');
    const nuovo = aperturaSicura(this.SQL, bytes);
    try {
      migra(nuovo);
      nuovo.run('PRAGMA foreign_keys = ON');
    } catch (e) {
      nuovo.close();
      throw e;
    }
    const vecchio = this.db;
    this.db = nuovo;
    try {
      this.versione += 1;
      await this._scrivi();
    } catch (e) {
      // Il salvataggio non e' riuscito: si torna all'archivio precedente.
      this.db = vecchio;
      nuovo.close();
      throw e;
    }
    vecchio.close();
    this._notifica();
  }

  // ------------------------------------------------------------ eventi

  /** Chiama cb ogni volta che i dati cambiano. Restituisce la funzione per smettere di ascoltare. */
  alCambiamento(cb) {
    this._ascoltatori.add(cb);
    return () => this._ascoltatori.delete(cb);
  }

  alloStato(cb) {
    this._ascoltatoriStato.add(cb);
    return () => this._ascoltatoriStato.delete(cb);
  }

  _notifica() {
    for (const cb of [...this._ascoltatori]) {
      try { cb(this.versione); } catch (e) { console.error(e); }
    }
  }

  _impostaStato(stato, errore = null) {
    this.statoSalvataggio = { stato, errore: errore ? errore.message : null };
    for (const cb of [...this._ascoltatoriStato]) {
      try { cb(this.statoSalvataggio); } catch (e) { console.error(e); }
    }
  }

  /** Attende che le scritture in corso siano concluse (utile prima di chiudere). */
  async scarica() {
    await this._catena;
  }

  chiudi() {
    if (this.db) this.db.close();
    this.db = null;
  }
}
