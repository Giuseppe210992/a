'use strict';
// Archivio su file per il programma Windows: tutta la logica che tocca il disco, senza dipendere da Electron
// (così si prova con i test normali). Cartella base predefinita: Documenti\Gestione Immobiliare.
//
//   <base>\Dati\archivio.sqlite        l'archivio (un solo file)
//   <base>\Dati\archivio.sqlite.bak    la versione precedente, conservata a ogni salvataggio
//   <base>\Backup\copia_<tipo>_<data>.sqlite   le copie di sicurezza (archivio storico)

const fs = require('node:fs');
const path = require('node:path');

const TIPI = ['manuale', 'automatico', 'pre-ripristino', 'pre-importazione', 'pre-azzeramento'];
const RX_COPIA = /^copia_(manuale|automatico|pre-ripristino|pre-importazione|pre-azzeramento)_(\d{8}T\d{9}Z)\.sqlite$/;

function attesa(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ambiente senza SharedArrayBuffer */ }
}

/** Riprova qualche volta: su Windows un antivirus o l'indicizzazione possono tenere il file occupato per un attimo. */
function conRiprove(operazione, tentativi = 6) {
  let ultimo = null;
  for (let i = 0; i < tentativi; i++) {
    try { return operazione(); } catch (e) {
      ultimo = e;
      if (!['EPERM', 'EBUSY', 'EACCES', 'EMFILE'].includes(e.code)) throw e;
      attesa(40 * (i + 1));
    }
  }
  throw ultimo;
}

/** Uint8Array / ArrayBuffer / Buffer -> Buffer, senza copiare quando non serve. */
function comeBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.from(bytes);
}

/** Scrive un file in modo che non resti mai a metà: prima in un file temporaneo, poi lo si sostituisce. */
function scriviAtomico(destinazione, bytes) {
  const tmp = `${destinazione}.tmp`;
  const dati = comeBuffer(bytes);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, dati, 0, dati.length, 0);
    fs.fsyncSync(fd); // i dati sono davvero sul disco prima di sostituire il file buono
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(destinazione)) {
    try { conRiprove(() => fs.copyFileSync(destinazione, `${destinazione}.bak`)); } catch { /* la versione precedente è un di più */ }
  }
  conRiprove(() => fs.renameSync(tmp, destinazione));
}

function creaHost(cartellaBase) {
  const cartellaDati = path.join(cartellaBase, 'Dati');
  const cartellaBackup = path.join(cartellaBase, 'Backup');
  const fileArchivio = path.join(cartellaDati, 'archivio.sqlite');
  fs.mkdirSync(cartellaDati, { recursive: true });
  fs.mkdirSync(cartellaBackup, { recursive: true });

  const nomeCopia = (tipo, creatoIl) => `copia_${tipo}_${creatoIl.replace(/[-:.]/g, '')}.sqlite`;
  const daNome = (nome) => {
    const m = RX_COPIA.exec(nome);
    if (!m) return null;
    const t = m[2]; // 20261016T103000123Z
    const creatoIl = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}.${t.slice(15, 18)}Z`;
    return { tipo: m[1], creatoIl };
  };
  const percorsoCopia = (id) => {
    if (typeof id !== 'string' || !RX_COPIA.test(id)) throw new Error('Copia di sicurezza non valida.');
    return path.join(cartellaBackup, id);
  };

  return {
    cartellaBase, cartellaDati, cartellaBackup, fileArchivio,

    /** Contenuto dell'archivio, o null se non c'è ancora. Se il file principale è vuoto per un'interruzione, usa la versione precedente. */
    carica() {
      if (fs.existsSync(fileArchivio)) {
        const dati = conRiprove(() => fs.readFileSync(fileArchivio));
        if (dati.length > 0) return dati;
        const bak = `${fileArchivio}.bak`;
        if (fs.existsSync(bak)) { const b = fs.readFileSync(bak); if (b.length > 0) return b; }
        return dati;
      }
      return null;
    },

    salva(bytes) { scriviAtomico(fileArchivio, bytes); },

    elencaCopie() {
      const out = [];
      for (const nome of fs.readdirSync(cartellaBackup)) {
        const meta = daNome(nome);
        if (!meta) continue;
        const st = fs.statSync(path.join(cartellaBackup, nome));
        out.push({ id: nome, tipo: meta.tipo, creatoIl: meta.creatoIl, dimensione: st.size, nome });
      }
      return out.sort((a, b) => (a.creatoIl < b.creatoIl ? 1 : a.creatoIl > b.creatoIl ? -1 : (a.id < b.id ? 1 : -1)));
    },

    creaCopia(bytes, tipo, creatoIl = new Date().toISOString()) {
      if (!TIPI.includes(tipo)) throw new Error(`Tipo di copia non valido: ${tipo}`);
      let nome = nomeCopia(tipo, creatoIl);
      // due copie nello stesso millisecondo: la seconda prende un istante successivo
      for (let i = 0; fs.existsSync(path.join(cartellaBackup, nome)); i++) {
        creatoIl = new Date(new Date(creatoIl).getTime() + 1).toISOString();
        nome = nomeCopia(tipo, creatoIl);
        if (i > 1000) throw new Error('Impossibile creare il nome della copia.');
      }
      scriviAtomico(path.join(cartellaBackup, nome), bytes);
      return { id: nome, tipo, creatoIl, dimensione: comeBuffer(bytes).length, nome };
    },

    leggiCopia(id) {
      const p = percorsoCopia(id);
      if (!fs.existsSync(p)) throw new Error('La copia di sicurezza non esiste più.');
      return fs.readFileSync(p);
    },

    eliminaCopia(id) {
      const p = percorsoCopia(id);
      if (fs.existsSync(p)) conRiprove(() => fs.unlinkSync(p));
    },

    info() {
      return { percorsoDati: fileArchivio, percorsoBackup: cartellaBackup };
    },

    /** Scrive un file scelto dall'utente (esportazioni). */
    scriviFile(percorso, bytes) { scriviAtomico(percorso, bytes); },
  };
}

module.exports = { creaHost, scriviAtomico, comeBuffer, TIPI, RX_COPIA };
