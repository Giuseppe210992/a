// Supporto di memorizzazione nel browser (IndexedDB): usato quando si apre l'interfaccia
// in un browser invece che nel programma Windows. I dati restano nel profilo del browser.

function aprilIdb() {
  return new Promise((risolvi, rifiuta) => {
    if (typeof indexedDB === 'undefined') { rifiuta(new Error('IndexedDB non disponibile in questo browser.')); return; }
    const rq = indexedDB.open('gestione-immobiliare', 1);
    rq.onupgradeneeded = () => {
      const idb = rq.result;
      idb.createObjectStore('archivio');
      idb.createObjectStore('copie', { keyPath: 'id', autoIncrement: true });
      idb.createObjectStore('copie_dati');
    };
    rq.onsuccess = () => risolvi(rq.result);
    rq.onerror = () => rifiuta(rq.error || new Error('Impossibile aprire l\'archivio del browser.'));
    rq.onblocked = () => rifiuta(new Error('L\'archivio del browser è bloccato da un\'altra scheda aperta.'));
  });
}

/** Esegue una transazione e attende il commit definitivo (non solo la richiesta). */
function transazione(idb, stores, modo, lavoro) {
  return new Promise((risolvi, rifiuta) => {
    const tx = idb.transaction(stores, modo);
    let esito;
    tx.oncomplete = () => risolvi(esito);
    tx.onerror = () => rifiuta(tx.error || new Error('Errore di scrittura nell\'archivio del browser.'));
    tx.onabort = () => rifiuta(tx.error || new Error('Scrittura annullata dal browser (spazio esaurito?).'));
    Promise.resolve(lavoro(tx)).then((v) => { esito = v; }, (e) => { try { tx.abort(); } catch { /* gia' chiusa */ } rifiuta(e); });
  });
}

const richiesta = (rq) => new Promise((ok, ko) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error); });

export class DriverIndexedDb {
  constructor() {
    this.nome = 'indexeddb';
    this._idb = null;
    this._persistente = null;
  }

  async _apri() {
    if (!this._idb) this._idb = await aprilIdb();
    return this._idb;
  }

  async carica() {
    const idb = await this._apri();
    const rec = await transazione(idb, ['archivio'], 'readonly', (tx) => richiesta(tx.objectStore('archivio').get('principale')));
    if (!rec) return null;
    return rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
  }

  async salva(bytes) {
    const idb = await this._apri();
    await transazione(idb, ['archivio'], 'readwrite', (tx) => {
      tx.objectStore('archivio').put({ bytes, salvatoIl: new Date().toISOString() }, 'principale');
    });
  }

  async elencaCopie() {
    const idb = await this._apri();
    const copie = await transazione(idb, ['copie'], 'readonly', (tx) => richiesta(tx.objectStore('copie').getAll()));
    return copie.map((c) => ({ ...c, id: String(c.id) })).sort((a, b) => (a.creatoIl < b.creatoIl ? 1 : -1));
  }

  async creaCopia(bytes, tipo, creatoIl = new Date().toISOString()) {
    const idb = await this._apri();
    const meta = { tipo, creatoIl, dimensione: bytes.length, nome: `copia-${creatoIl}` };
    const id = await transazione(idb, ['copie', 'copie_dati'], 'readwrite', async (tx) => {
      const nuovoId = await richiesta(tx.objectStore('copie').add(meta));
      tx.objectStore('copie_dati').put(bytes, nuovoId);
      return nuovoId;
    });
    return { ...meta, id: String(id) };
  }

  async leggiCopia(id) {
    const idb = await this._apri();
    const bytes = await transazione(idb, ['copie_dati'], 'readonly', (tx) => richiesta(tx.objectStore('copie_dati').get(Number(id))));
    if (!bytes) throw new Error('La copia di sicurezza non esiste più.');
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  async eliminaCopia(id) {
    const idb = await this._apri();
    await transazione(idb, ['copie', 'copie_dati'], 'readwrite', (tx) => {
      tx.objectStore('copie').delete(Number(id));
      tx.objectStore('copie_dati').delete(Number(id));
    });
  }

  /** Salva un file: con il selettore di sistema se il browser lo offre, altrimenti scarica. */
  async esportaFile(bytes, nome, mime = 'application/octet-stream') {
    const blob = new Blob([bytes], { type: mime });
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const estensione = nome.includes('.') ? nome.slice(nome.lastIndexOf('.')) : '';
        const maniglia = await window.showSaveFilePicker({
          suggestedName: nome,
          types: estensione ? [{ description: 'File', accept: { [mime]: [estensione] } }] : undefined,
        });
        const w = await maniglia.createWritable();
        await w.write(blob);
        await w.close();
        return { salvato: true, percorso: maniglia.name };
      } catch (e) {
        if (e && e.name === 'AbortError') return { salvato: false, annullato: true };
        // altri errori: si ripiega sul download classico
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { salvato: true, percorso: nome, scaricato: true };
  }

  /** Fa scegliere un file all'utente. Restituisce { nome, bytes } oppure null se annulla. */
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
        try {
          fine({ nome: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        } catch { fine(null); }
      });
      input.addEventListener('cancel', () => fine(null));
      input.click();
    });
  }

  async info() {
    let persistente = null;
    try {
      if (navigator.storage && navigator.storage.persisted) persistente = await navigator.storage.persisted();
    } catch { /* non disponibile */ }
    return { tipo: 'indexeddb', persistente, percorso: null };
  }

  /** Chiede al browser di non cancellare i dati quando lo spazio scarseggia. */
  async chiediPersistenza() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch { /* ignora */ }
    return false;
  }
}
