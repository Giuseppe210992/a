// Supporto di memorizzazione in memoria: usato dai test, non conserva nulla alla chiusura.
export class DriverMemoria {
  constructor() {
    this.nome = 'memoria';
    this.byte = null;
    this.copie = new Map();
    this.prossimoId = 1;
    this.scritture = 0;
    this.guasto = false; // per simulare un errore di scrittura nei test
  }

  async carica() { return this.byte ? this.byte.slice() : null; }

  async salva(bytes) {
    if (this.guasto) throw new Error('scrittura simulata non riuscita');
    this.byte = bytes.slice();
    this.scritture += 1;
  }

  async elencaCopie() {
    return [...this.copie.values()]
      .map(({ bytes, ...meta }) => ({ ...meta, dimensione: bytes.length }))
      .sort((a, b) => (a.creatoIl < b.creatoIl ? 1 : -1));
  }

  async creaCopia(bytes, tipo, creatoIl = new Date().toISOString()) {
    const id = String(this.prossimoId++);
    this.copie.set(id, { id, tipo, creatoIl, nome: `copia-${id}`, bytes: bytes.slice() });
    return { id, tipo, creatoIl, dimensione: bytes.length };
  }

  async leggiCopia(id) {
    const c = this.copie.get(String(id));
    if (!c) throw new Error('Copia non trovata.');
    return c.bytes.slice();
  }

  async eliminaCopia(id) { this.copie.delete(String(id)); }

  async esportaFile(bytes, nome) {
    this.ultimaEsportazione = { bytes: bytes.slice(), nome };
    return { salvato: true, percorso: nome };
  }

  async scegliFile() { return this.fileDaScegliere ?? null; }

  info() { return { tipo: 'memoria', persistente: false, percorso: null }; }
}
