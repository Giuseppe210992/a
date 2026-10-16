// Copie di sicurezza: creazione, elenco, ripristino, esportazione e importazione.
// Prima di ogni operazione distruttiva (ripristino, importazione, azzeramento) viene salvata
// automaticamente una copia dello stato attuale, cosi' l'operazione si puo' sempre annullare.
import { Archivio, ispezionaBytes } from './db.js';
import { migra } from './schema.js';
import { leggiImpostazioni, scriviImpostazioni, registra } from './repo/impostazioni.js';
import { seedPrimoAvvio } from './inizializza.js';
import { oggi } from '../core/dates.js';

export const TIPI_COPIA = Object.freeze({
  manuale: 'Manuale',
  automatico: 'Automatico',
  'pre-ripristino': 'Prima di un ripristino',
  'pre-importazione': 'Prima di un\'importazione',
  'pre-azzeramento': 'Prima dell\'azzeramento',
});

const LIMITE_COPIE_DI_SICUREZZA = 20;

export function nomeFileArchivio(data = new Date(), prefisso = 'GestioneImmobiliare_backup') {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefisso}_${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}_${p(data.getHours())}${p(data.getMinutes())}.sqlite`;
}

/** Data (locale) di un timestamp ISO, come AAAA-MM-GG. */
function giornoLocale(iso) {
  return oggi(new Date(iso));
}

export async function elencoBackup(app) {
  return app.driver.elencaCopie();
}

/** Momento dell'ultimo backup (copia interna o esportazione), come timestamp ISO, o null. */
export async function ultimoBackup(app) {
  const imp = leggiImpostazioni(app.archivio);
  let migliore = imp['backup.ultimo'] || null;
  try {
    for (const c of await app.driver.elencaCopie()) {
      if (c.tipo === 'manuale' || c.tipo === 'automatico') {
        if (!migliore || c.creatoIl > migliore) migliore = c.creatoIl;
      }
    }
  } catch { /* elenco non disponibile: vale quanto salvato nelle impostazioni */ }
  return migliore;
}

async function segnaBackup(app, quando, tipo) {
  await scriviImpostazioni(app.archivio, { 'backup.ultimo': quando, 'backup.ultimoTipo': tipo });
}

export async function creaBackup(app, tipo = 'manuale') {
  const bytes = app.archivio.esporta();
  const meta = await app.driver.creaCopia(bytes, tipo);
  if (tipo === 'manuale' || tipo === 'automatico') await segnaBackup(app, meta.creatoIl, tipo);
  await potaCopie(app);
  return meta;
}

/** Elimina le copie piu' vecchie in eccesso (solo automatiche e di sicurezza; mai quelle manuali). */
export async function potaCopie(app) {
  const imp = leggiImpostazioni(app.archivio);
  const massimoAuto = Math.max(1, Number(imp['backup.massimoAutomatici']) || 30);
  const copie = await app.driver.elencaCopie(); // dalla piu' recente
  const daPotare = [];
  const limitePer = { automatico: massimoAuto, 'pre-ripristino': LIMITE_COPIE_DI_SICUREZZA, 'pre-importazione': LIMITE_COPIE_DI_SICUREZZA, 'pre-azzeramento': LIMITE_COPIE_DI_SICUREZZA };
  for (const tipo of Object.keys(limitePer)) {
    daPotare.push(...copie.filter((c) => c.tipo === tipo).slice(limitePer[tipo]));
  }
  for (const c of daPotare) await app.driver.eliminaCopia(c.id);
  return daPotare.length;
}

/** Una copia automatica al giorno, se ci sono dati da proteggere. Restituisce la copia o null. */
export async function backupAutomatico(app) {
  const imp = leggiImpostazioni(app.archivio);
  if (!imp['backup.automatico']) return null;
  const haDati = app.archivio.valore('SELECT COUNT(*) FROM pratiche') > 0;
  if (!haDati) return null;
  const copie = await app.driver.elencaCopie();
  const giaFatta = copie.some((c) => c.tipo === 'automatico' && giornoLocale(c.creatoIl) === oggi());
  if (giaFatta) return null;
  return creaBackup(app, 'automatico');
}

export async function ripristinaBackup(app, id) {
  const bytes = await app.driver.leggiCopia(id);
  const esito = ispezionaBytes(app.SQL, bytes);
  if (!esito.valido) throw new Error(`La copia non puo' essere ripristinata: ${esito.motivo}`);
  const sicurezza = await creaBackup(app, 'pre-ripristino');
  await app.archivio.sostituisciCon(bytes);
  await app.archivio.transazione(() => {
    registra(app.archivio, 'ripristino', `Ripristinata una copia con ${esito.riepilogo.pratiche} pratiche (copia di sicurezza creata prima)`);
  }, { silenzioso: true });
  await segnaBackup(app, sicurezza.creatoIl, 'pre-ripristino');
  return { esito, sicurezza };
}

/** Salva l'archivio in un file scelto dall'utente. */
export async function esportaArchivio(app) {
  const bytes = app.archivio.esporta();
  const nome = nomeFileArchivio(new Date(), 'GestioneImmobiliare_esportazione');
  const r = await app.driver.esportaFile(bytes, nome, 'application/x-sqlite3');
  if (r && r.salvato) await segnaBackup(app, new Date().toISOString(), 'esportazione');
  return { ...r, nome, dimensione: bytes.length };
}

/** Fa scegliere un file e lo controlla, senza applicarlo. */
export async function leggiFileDaImportare(app) {
  const f = await app.driver.scegliFile('.sqlite,.db,.gimm,application/x-sqlite3');
  if (!f) return null;
  return { nome: f.nome, bytes: f.bytes, esito: ispezionaBytes(app.SQL, f.bytes) };
}

/** Sostituisce l'archivio con il contenuto importato (dopo conferma). */
export async function applicaImportazione(app, bytes) {
  const esito = ispezionaBytes(app.SQL, bytes);
  if (!esito.valido) throw new Error(`Importazione non possibile: ${esito.motivo}`);
  const sicurezza = await creaBackup(app, 'pre-importazione');
  await app.archivio.sostituisciCon(bytes);
  await app.archivio.transazione(() => {
    registra(app.archivio, 'importazione', `Importato un archivio con ${esito.riepilogo.pratiche} pratiche (copia di sicurezza creata prima)`);
  }, { silenzioso: true });
  await segnaBackup(app, sicurezza.creatoIl, 'pre-importazione');
  return { esito, sicurezza };
}

/** Cancella tutti i dati e riparte da un archivio vuoto (dopo conferma forte). */
export async function azzeraArchivio(app) {
  const sicurezza = await creaBackup(app, 'pre-azzeramento');
  const db = new app.SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  migra(db);
  const bytesVuoti = db.export();
  db.close();
  await app.archivio.sostituisciCon(bytesVuoti);
  await seedPrimoAvvio(app.archivio);
  await app.archivio.transazione(() => {
    registra(app.archivio, 'azzeramento', 'Tutti i dati sono stati cancellati (copia di sicurezza creata prima)');
  }, { silenzioso: true });
  await segnaBackup(app, sicurezza.creatoIl, 'pre-azzeramento');
  return { sicurezza };
}
