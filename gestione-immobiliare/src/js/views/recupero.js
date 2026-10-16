// Schermata mostrata quando l'archivio non si apre (file danneggiato o incompleto).
// Non cancella nulla da sola: propone di ripartire da una copia di sicurezza o da un file.
import { h } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { dataOra, dimensioneFile } from '../core/format.js';
import { conferma, errore, ok as notificaOk } from '../core/ui.js';
import { ispezionaBytes } from '../data/db.js';
import { TIPI_COPIA } from '../data/backup.js';

export async function schermataRecupero(radice, { app, SQL, driver, motivo, riavvia }) {
  radice.className = '';
  let copie = [];
  try { copie = await driver.elencaCopie(); } catch { /* nessun elenco */ }
  const sostituisciArchivio = async (bytes) => {
    // Il file illeggibile viene conservato tra le copie prima di essere sostituito.
    try {
      const danneggiato = await driver.carica();
      if (danneggiato && danneggiato.length) await driver.creaCopia(danneggiato, 'pre-ripristino');
    } catch { /* se non si riesce a conservarlo si prosegue comunque dopo la conferma */ }
    await driver.salva(bytes);
    notificaOk('Archivio ripristinato. Riavvio…');
    setTimeout(riavvia, 600);
  };
  const righe = copie.map((c) => h('div', { class: 'riga-elenco' },
    h('div', { class: 'nome' }, icona('database-backup', { dimensione: 20 }), h('div', null, `Copia del ${dataOra(c.creatoIl)}`, h('br'), h('small', null, `${TIPI_COPIA[c.tipo] ?? c.tipo} · ${dimensioneFile(c.dimensione)}`))),
    h('button', { type: 'button', class: 'btn btn-primario btn-sm', onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const bytes = await driver.leggiCopia(c.id);
        const esito = ispezionaBytes(SQL, bytes);
        if (!esito.valido) { errore(`Questa copia non è utilizzabile: ${esito.motivo}`); ev.currentTarget.disabled = false; return; }
        const sì = await conferma({ titolo: 'Ripartire da questa copia?', messaggio: `La copia contiene ${esito.riepilogo.pratiche} pratiche. Il file illeggibile viene conservato.`, tipo: 'primario', etichettaConferma: 'Ripristina' });
        if (sì) await sostituisciArchivio(bytes); else ev.currentTarget.disabled = false;
      } catch (e) { errore(e.message); ev.currentTarget.disabled = false; }
    } }, 'Ripristina'),
  ));
  radice.replaceChildren(h('div', { class: 'avvio' }, h('div', { class: 'card card-corpo', style: { maxWidth: '640px', width: '92vw' } },
    h('div', { class: 'nota errore', role: 'alert' }, icona('circle-x', { dimensione: 22 }), h('div', null, h('strong', null, 'L\'archivio dei dati non si apre.'), h('br'), motivo)),
    h('p', { style: { margin: '14px 0 6px' } }, 'Non è stato cancellato nulla. Puoi ripartire da una copia di sicurezza oppure da un file di backup.'),
    copie.length ? h('div', null, h('h2', { class: 'sezione-titolo' }, 'Copie disponibili'), ...righe) : h('p', { class: 'sottotesto' }, 'Non ci sono copie di sicurezza automatiche.'),
    h('div', { class: 'riga-azioni', style: { marginTop: '16px' } },
      h('button', { type: 'button', class: 'btn btn-secondario', onclick: async () => {
        const f = await driver.scegliFile('.sqlite,.db,.gimm');
        if (!f) return;
        const esito = ispezionaBytes(SQL, f.bytes);
        if (!esito.valido) { errore(`Il file non è utilizzabile: ${esito.motivo}`); return; }
        if (await conferma({ titolo: 'Ripartire da questo file?', messaggio: `“${f.nome}” contiene ${esito.riepilogo.pratiche} pratiche.`, tipo: 'primario', etichettaConferma: 'Usa questo file' })) await sostituisciArchivio(f.bytes);
      } }, icona('upload', { dimensione: 16 }), 'Scegli un file di backup…'),
      h('button', { type: 'button', class: 'btn btn-secondario', onclick: async () => {
        const bytes = await driver.carica();
        if (bytes) await driver.esportaFile(bytes, 'archivio-danneggiato.sqlite', 'application/x-sqlite3');
      } }, icona('download', { dimensione: 16 }), 'Salva una copia del file danneggiato'),
      h('button', { type: 'button', class: 'btn btn-pericolo-ghost', onclick: async () => {
        const sì = await conferma({ titolo: 'Ripartire da un archivio vuoto?', messaggio: 'Il file illeggibile viene conservato tra le copie di sicurezza, ma il programma ripartirà senza dati.', etichettaConferma: 'Archivio vuoto', frase: 'VUOTO' });
        if (!sì) return;
        const db = new SQL.Database();
        const { migra } = await import('../data/schema.js');
        migra(db);
        const bytes = db.export();
        db.close();
        await sostituisciArchivio(bytes);
      } }, 'Riparti da un archivio vuoto…'),
    ))));
}
