// Supporto di memorizzazione del programma Windows: l'archivio e' un file SQLite
// nella cartella Documenti\Gestione Immobiliare. Il ponte "gestionaleHost" e' fornito
// dal processo principale di Electron (electron/preload.cjs).

export function hostDisponibile() {
  return typeof window !== 'undefined' && !!window.gestionaleHost;
}

export class DriverFile {
  constructor(host = window.gestionaleHost) {
    this.nome = 'file';
    this.host = host;
  }

  async carica() {
    const b = await this.host.archivio.carica();
    return b ? new Uint8Array(b) : null;
  }

  async salva(bytes) {
    await this.host.archivio.salva(bytes);
  }

  async elencaCopie() { return this.host.copie.elenca(); }
  async creaCopia(bytes, tipo) { return this.host.copie.crea(bytes, tipo); }
  async leggiCopia(id) { return new Uint8Array(await this.host.copie.leggi(id)); }
  async eliminaCopia(id) { return this.host.copie.elimina(id); }
  async esportaFile(bytes, nome, mime) { return this.host.file.salvaCome(bytes, nome, mime); }

  async scegliFile(accept = '') {
    const r = await this.host.file.apri(accept);
    return r ? { nome: r.nome, bytes: new Uint8Array(r.bytes) } : null;
  }

  async info() {
    const i = await this.host.sistema.info();
    return { tipo: 'file', persistente: true, ...i };
  }

  async chiediPersistenza() { return true; }
}
