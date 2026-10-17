// Supporto di memorizzazione per chi apre l'interfaccia in un browser: niente archivio nel browser (nessun IndexedDB, nessuna memoria
// locale, nessun download), così non resta alcuna traccia da cancellare. I dati stanno solo nella cartella scelta dall'utente
// (ad esempio sulla chiavetta), con la stessa struttura del programma Windows:
//
//   <cartella>/Dati/archivio.sqlite          l'archivio (un solo file)
//   <cartella>/Dati/archivio.sqlite.bak      la versione precedente, conservata a ogni salvataggio
//   <cartella>/Dati/preferenze.json          tema, barra laterale e filtri
//   <cartella>/Backup/copia_<tipo>_<data>.sqlite
//   <cartella>/Esportazioni/                 CSV e archivi esportati

const TIPI = ['manuale', 'automatico', 'pre-ripristino', 'pre-importazione', 'pre-azzeramento'];
const RX_COPIA = /^copia_(manuale|automatico|pre-ripristino|pre-importazione|pre-azzeramento)_(\d{8}T\d{9}Z)\.sqlite$/;

export const cartellaSupportata = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/** Fa scegliere la cartella dei dati (serve un clic dell'utente). Lancia AbortError se annulla. */
export async function scegliCartellaDati() {
  const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (dir.queryPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!dir.requestPermission || (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Il browser non permette di scrivere in questa cartella.');
  }
  return dir;
}

const nonTrovato = (e) => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

async function leggiFile(dir, nome) {
  try {
    const f = await (await dir.getFileHandle(nome)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  } catch (e) {
    if (nonTrovato(e)) return null;
    throw e;
  }
}

async function scrivi(dir, nome, bytes) {
  const w = await (await dir.getFileHandle(nome, { create: true })).createWritable(); // la scrittura è atomica: il file cambia solo alla chiusura
  try { await w.write(bytes); await w.close(); } catch (e) { try { await w.abort(); } catch { /* già chiuso */ } throw e; }
}

export class DriverCartella {
  constructor(radice) {
    this.nome = 'cartella';
    this.radice = radice;
    this._sub = {};
  }

  async _dir(nome) {
    if (!this._sub[nome]) this._sub[nome] = await this.radice.getDirectoryHandle(nome, { create: true });
    return this._sub[nome];
  }

  async carica() {
    const dati = await this._dir('Dati');
    const principale = await leggiFile(dati, 'archivio.sqlite');
    if (principale && principale.length > 0) return principale;
    const bak = await leggiFile(dati, 'archivio.sqlite.bak');
    if (bak && bak.length > 0) return bak;
    return principale;
  }

  async salva(bytes) {
    const dati = await this._dir('Dati');
    try { const prima = await leggiFile(dati, 'archivio.sqlite'); if (prima && prima.length) await scrivi(dati, 'archivio.sqlite.bak', prima); } catch { /* la versione precedente è un di più */ }
    await scrivi(dati, 'archivio.sqlite', bytes);
  }

  async caricaPreferenze() {
    try {
      const b = await leggiFile(await this._dir('Dati'), 'preferenze.json');
      return b ? JSON.parse(new TextDecoder().decode(b)) : {};
    } catch { return {}; }
  }

  async salvaPreferenze(oggetto) {
    await scrivi(await this._dir('Dati'), 'preferenze.json', new TextEncoder().encode(JSON.stringify(oggetto)));
  }

  async elencaCopie() {
    const dir = await this._dir('Backup');
    const out = [];
    for await (const [nome, h] of dir.entries()) {
      const m = RX_COPIA.exec(nome);
      if (!m || h.kind !== 'file') continue;
      const t = m[2];
      const creatoIl = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}.${t.slice(15, 18)}Z`;
      out.push({ id: nome, tipo: m[1], creatoIl, dimensione: (await h.getFile()).size, nome });
    }
    return out.sort((a, b) => (a.creatoIl < b.creatoIl ? 1 : a.creatoIl > b.creatoIl ? -1 : (a.id < b.id ? 1 : -1)));
  }

  async creaCopia(bytes, tipo, creatoIl = new Date().toISOString()) {
    if (!TIPI.includes(tipo)) throw new Error(`Tipo di copia non valido: ${tipo}`);
    const dir = await this._dir('Backup');
    const nomeCopia = (t, c) => `copia_${t}_${c.replace(/[-:.]/g, '')}.sqlite`;
    let nome = nomeCopia(tipo, creatoIl);
    // due copie nello stesso millisecondo: la seconda prende un istante successivo
    for (let i = 0; await leggiFile(dir, nome) !== null; i++) {
      creatoIl = new Date(new Date(creatoIl).getTime() + 1).toISOString();
      nome = nomeCopia(tipo, creatoIl);
      if (i > 1000) throw new Error('Impossibile creare il nome della copia.');
    }
    await scrivi(dir, nome, bytes);
    return { id: nome, tipo, creatoIl, dimensione: bytes.length, nome };
  }

  async leggiCopia(id) {
    if (typeof id !== 'string' || !RX_COPIA.test(id)) throw new Error('Copia di sicurezza non valida.');
    const b = await leggiFile(await this._dir('Backup'), id);
    if (!b) throw new Error('La copia di sicurezza non esiste più.');
    return b;
  }

  async eliminaCopia(id) {
    if (typeof id !== 'string' || !RX_COPIA.test(id)) throw new Error('Copia di sicurezza non valida.');
    try { await (await this._dir('Backup')).removeEntry(id); } catch (e) { if (!nonTrovato(e)) throw e; }
  }

  /** Salva un file nella cartella Esportazioni (niente download: il browser non ne tiene la cronologia). */
  async esportaFile(bytes, nome) {
    const dir = await this._dir('Esportazioni');
    const punto = nome.lastIndexOf('.');
    const base = punto > 0 ? nome.slice(0, punto) : nome;
    const est = punto > 0 ? nome.slice(punto) : '';
    let finale = nome;
    for (let i = 2; await leggiFile(dir, finale) !== null; i++) finale = `${base} (${i})${est}`; // non si sovrascrive mai un file esportato prima
    await scrivi(dir, finale, bytes);
    return { salvato: true, percorso: `${this.radice.name}/Esportazioni/${finale}` };
  }

  /** Fa scegliere un file all'utente (non lascia nulla nel browser). Restituisce { nome, bytes } oppure null se annulla. */
  scegliFile(accept = '') {
    return new Promise((risolvi) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      let concluso = false;
      const fine = (v) => { if (concluso) return; concluso = true; input.remove(); risolvi(v); };
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) { fine(null); return; }
        try { fine({ nome: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); } catch { fine(null); }
      });
      input.addEventListener('cancel', () => fine(null));
      input.click();
    });
  }

  async info() {
    const n = this.radice.name || 'cartella scelta';
    return { tipo: 'file', persistente: true, percorsoDati: `${n}/Dati/archivio.sqlite`, percorsoBackup: `${n}/Backup`, portatile: false, nelBrowser: true };
  }

  async chiediPersistenza() { return true; }
}
