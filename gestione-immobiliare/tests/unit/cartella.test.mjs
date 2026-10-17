// Il supporto per il browser: i dati stanno solo in una cartella scelta dall'utente (qui simulata in memoria).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriverCartella } from '../../src/js/data/drivers/cartella.js';

function errore(nome) { const e = new Error(nome); e.name = nome; return e; }
function cartellaFinta(nome = 'Dati miei') {
  const voci = new Map();
  const dir = {
    kind: 'directory', name: nome, voci,
    async getFileHandle(n, { create = false } = {}) {
      if (!voci.has(n)) { if (!create) throw errore('NotFoundError'); voci.set(n, { kind: 'file', name: n, byte: new Uint8Array(0) }); }
      const f = voci.get(n);
      if (f.kind !== 'file') throw errore('TypeMismatchError');
      return {
        kind: 'file', name: n,
        async getFile() { return { size: f.byte.length, async arrayBuffer() { return f.byte.slice().buffer; } }; },
        async createWritable() { let d = null; return { async write(b) { d = new Uint8Array(b); }, async close() { f.byte = d ?? new Uint8Array(0); }, async abort() {} }; },
      };
    },
    async getDirectoryHandle(n, { create = false } = {}) {
      if (!voci.has(n)) { if (!create) throw errore('NotFoundError'); voci.set(n, cartellaFinta(n)); }
      return voci.get(n);
    },
    async removeEntry(n) { if (!voci.delete(n)) throw errore('NotFoundError'); },
    async *entries() { for (const [n, v] of voci) yield [n, v.kind === 'directory' ? v : { kind: 'file', name: n, async getFile() { return { size: v.byte.length }; } }]; },
  };
  return dir;
}

test('archivio: vuoto la prima volta, poi si salva e si ricarica; la versione precedente resta in .bak', async () => {
  const radice = cartellaFinta();
  const d = new DriverCartella(radice);
  assert.equal(await d.carica(), null);
  await d.salva(new Uint8Array([1, 2, 3]));
  await d.salva(new Uint8Array([4, 5]));
  assert.deepEqual([...await new DriverCartella(radice).carica()], [4, 5]);
  const dati = await radice.getDirectoryHandle('Dati');
  assert.deepEqual([...dati.voci.get('archivio.sqlite.bak').byte], [1, 2, 3]);
});

test('file principale vuoto per un\'interruzione: si usa la versione precedente', async () => {
  const radice = cartellaFinta();
  const d = new DriverCartella(radice);
  await d.salva(new Uint8Array([9, 9]));
  await d.salva(new Uint8Array([8, 8, 8]));
  (await radice.getDirectoryHandle('Dati')).voci.get('archivio.sqlite').byte = new Uint8Array(0);
  assert.deepEqual([...await d.carica()], [9, 9]);
});

test('copie di sicurezza: elenco ordinato, lettura, eliminazione, due copie nello stesso istante', async () => {
  const d = new DriverCartella(cartellaFinta());
  const a = await d.creaCopia(new Uint8Array([1]), 'manuale', '2026-10-16T10:30:00.123Z');
  const b = await d.creaCopia(new Uint8Array([2, 2]), 'manuale', '2026-10-16T10:30:00.123Z');
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^copia_manuale_20261016T103000123Z\.sqlite$/);
  await d.creaCopia(new Uint8Array([3]), 'automatico', '2026-10-15T08:00:00.000Z');
  const elenco = await d.elencaCopie();
  assert.deepEqual(elenco.map((c) => [c.tipo, c.dimensione]), [['manuale', 2], ['manuale', 1], ['automatico', 1]]);
  assert.deepEqual([...await d.leggiCopia(a.id)], [1]);
  await d.eliminaCopia(a.id);
  assert.equal((await d.elencaCopie()).length, 2);
  await assert.rejects(d.leggiCopia('../x.sqlite'), /non valida/);
  await assert.rejects(d.creaCopia(new Uint8Array(1), 'strano'), /Tipo di copia/);
});

test('esportazione: finisce nella cartella Esportazioni e non sovrascrive mai un file precedente', async () => {
  const radice = cartellaFinta('Chiavetta');
  const d = new DriverCartella(radice);
  const r1 = await d.esportaFile(new Uint8Array([1]), 'Pratiche_2026-10-16.csv');
  const r2 = await d.esportaFile(new Uint8Array([2]), 'Pratiche_2026-10-16.csv');
  assert.equal(r1.percorso, 'Chiavetta/Esportazioni/Pratiche_2026-10-16.csv');
  assert.equal(r2.percorso, 'Chiavetta/Esportazioni/Pratiche_2026-10-16 (2).csv');
  assert.equal(r1.salvato && r2.salvato, true);
});

test('preferenze: nel file della cartella, non nel browser; se illeggibili si riparte da zero', async () => {
  const radice = cartellaFinta();
  const d = new DriverCartella(radice);
  assert.deepEqual(await d.caricaPreferenze(), {});
  await d.salvaPreferenze({ tema: 'dark', sidebar: 'ridotta' });
  assert.deepEqual(await new DriverCartella(radice).caricaPreferenze(), { tema: 'dark', sidebar: 'ridotta' });
  (await radice.getDirectoryHandle('Dati')).voci.get('preferenze.json').byte = new TextEncoder().encode('{rotto');
  assert.deepEqual(await d.caricaPreferenze(), {});
  assert.deepEqual(await d.info(), { tipo: 'file', persistente: true, percorsoDati: 'Dati miei/Dati/archivio.sqlite', percorsoBackup: 'Dati miei/Backup', portatile: false, nelBrowser: true });
});
