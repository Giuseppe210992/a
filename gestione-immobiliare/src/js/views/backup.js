// Backup e archivio storico: creazione, esportazione, importazione e ripristino dei dati, verifica di integrita'.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, impostazioni } from '../core/app.js';
import { naviga } from '../core/router.js';
import { dataOra, dimensioneFile, num, dataIt } from '../core/format.js';
import { apriModale, conferma, ok as notificaOk, segnalaErrore, errore as notificaErrore } from '../core/ui.js';
import { ispezionaBytes } from '../data/db.js';
import { TIPI_COPIA, ultimoBackup, ripristinaBackup, esportaArchivio, azzeraArchivio, nomeFileArchivio, potaCopie } from '../data/backup.js';
import { leggiRegistro } from '../data/repo/impostazioni.js';
import { verificaIntegrita } from '../data/integrity.js';
import { eseguiBackupRapido, eseguiImportazione, apriDialogoEsporta } from '../components/dialoghi.js';

const ETICHETTE_EVENTO = {
  archivio_creato: 'Archivio creato', pratica_eliminata: 'Pratica eliminata', incasso_eliminato: 'Incasso eliminato', liquidazione_eliminata: 'Liquidazione eliminata',
  collaboratore_eliminato: 'Collaboratore eliminato', zona_eliminata: 'Zona eliminata', ripristino: 'Ripristino di un backup', importazione: 'Importazione di un backup', azzeramento: 'Archivio azzerato',
};

function giorniDa(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }

async function ripristinaConferma(copia) {
  let bytes;
  try { bytes = await app.driver.leggiCopia(copia.id); } catch (e) { segnalaErrore(e, 'Lettura della copia'); return; }
  const esito = ispezionaBytes(app.SQL, bytes);
  if (!esito.valido) {
    await apriModale({ titolo: 'Questa copia non è utilizzabile', icona: 'circle-x', tonoIcona: 'pericolo', contenuto: h('p', null, esito.motivo), azioni: [{ id: 'ok', etichetta: 'Ho capito', tipo: 'primario' }] }).risultato;
    return;
  }
  const r = esito.riepilogo;
  const sì = await conferma({
    titolo: 'Ripristinare questa copia?',
    messaggio: `Stai per riportare tutti i dati allo stato del ${dataOra(copia.creatoIl)}.`,
    dettagli: [
      `La copia contiene ${r.pratiche} pratiche, ${r.incassi} incassi e ${r.liquidazioni} liquidazioni${r.primaData ? ` (pratiche dal ${dataIt(r.primaData)} al ${dataIt(r.ultimaData)})` : ''}.`,
      'Le modifiche fatte dopo quella data andranno perse dalla vista attuale.',
      'Prima del ripristino viene salvata automaticamente una copia dei dati di adesso: potrai tornare indietro da questa stessa pagina.',
    ],
    etichettaConferma: 'Ripristina questa copia', tipo: 'pericolo',
  });
  if (!sì) return;
  try {
    const out = await ripristinaBackup(app, copia.id);
    notificaOk(`Dati ripristinati: ${out.esito.riepilogo.pratiche} pratiche.`, { azione: { etichetta: 'Vai alla dashboard', onClick: () => naviga('#/') } });
  } catch (e) { segnalaErrore(e, 'Ripristino'); }
}

export const backup = {
  id: 'backup', titolo: 'Backup e archivio storico',
  monta(contenitore, params, query) {
    const corpo = h('div', { class: 'backup-corpo' });
    let vivo = true;
    let integrita = null;

    async function disegna() {
      const m = modello();
      let copie = []; let info = {}; let ultimo = null;
      try { [copie, info, ultimo] = await Promise.all([app.driver.elencaCopie(), app.driver.info(), ultimoBackup(app)]); } catch (e) { console.error(e); }
      if (!vivo) return;
      if (!integrita) integrita = verificaIntegrita(app.archivio, m);
      const soglia = Number(impostazioni()['avvisi.giorniBackup']) || 7;
      const gg = ultimo ? giorniDa(ultimo) : null;
      const livello = !ultimo ? 'crit' : gg >= soglia ? 'warn' : 'ok';
      const haDati = m.pratiche.length > 0;
      const bytes = app.archivio.esporta();

      // ---------- stato
      const statoCard = h('section', { class: 'card card-corpo', 'aria-labelledby': 'stato-bk' },
        h('div', { class: 'stato-grande' }, h('span', { class: `pallino ${livello === 'ok' ? 'ok' : livello}` }),
          h('div', null, h('h2', { id: 'stato-bk', style: { fontSize: '18px', fontWeight: 720 } }, !ultimo ? (haDati ? 'Nessun backup ancora eseguito' : 'Archivio vuoto: nessun backup necessario') : livello === 'ok' ? 'I tuoi dati sono protetti' : 'Il backup non è recente'),
            h('p', { class: 'sottotesto' }, ultimo ? `Ultimo backup: ${dataOra(ultimo)} (${gg === 0 ? 'oggi' : gg === 1 ? 'ieri' : `${gg} giorni fa`}). L'avviso compare dopo ${soglia} giorni.` : 'Crea una copia di sicurezza: richiede pochi secondi.'))),
        h('dl', { class: 'elenco-dati', style: { marginTop: '16px' } },
          h('dt', null, 'Dove sono i dati'), h('dd', null, info.tipo === 'file' ? `Nel file ${info.percorsoDati ?? ''}` : 'Nella memoria del browser di questo computer (IndexedDB)'),
          info.tipo === 'file' ? h('dt', null, 'Cartella dei backup') : null, info.tipo === 'file' ? h('dd', null, info.percorsoBackup ?? '') : null,
          info.tipo !== 'file' ? h('dt', null, 'Protezione dalla pulizia automatica') : null, info.tipo !== 'file' ? h('dd', null, info.persistente ? 'Attiva' : 'Non garantita dal browser: tieni sempre un backup esportato') : null,
          h('dt', null, 'Dimensione dell\'archivio'), h('dd', null, dimensioneFile(bytes.length)),
          h('dt', null, 'Contenuto'), h('dd', null, `${num(m.pratiche.length)} pratiche · ${num(m.incassi.length)} incassi · ${num(m.liquidazioni.length)} liquidazioni`),
          h('dt', null, 'Copie nell\'archivio storico'), h('dd', null, num(copie.length))),
        info.tipo === 'file' && window.gestionaleHost?.sistema?.apriCartella ? h('div', { class: 'riga-azioni', style: { marginTop: '12px' } },
          h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => window.gestionaleHost.sistema.apriCartella('dati') }, icona('folder-open', { dimensione: 15 }), 'Apri la cartella dei dati'),
          h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => window.gestionaleHost.sistema.apriCartella('backup') }, icona('folder-open', { dimensione: 15 }), 'Apri la cartella dei backup')) : null,
        info.tipo !== 'file' ? h('div', { class: 'nota attenzione', style: { marginTop: '12px' } }, icona('triangle-alert', { dimensione: 18 }), h('span', null, 'Stai usando il programma nel browser: se cancelli i dati di navigazione di questo sito o cambi profilo, l\'archivio non sarà più qui. Esporta spesso un backup, oppure usa il programma Windows che salva su file nella cartella Documenti.')) : null);

      // ---------- azioni
      const azione = (id, nomeIcona, titolo, testo, onClick, primaria = false) => h('button', { type: 'button', id, class: `op${primaria ? ' principale-op' : ''}`, onclick: onClick },
        h('span', { class: 'op-icona' }, icona(nomeIcona, { dimensione: 20 })), h('span', null, h('b', null, titolo), h('small', null, testo)));
      const azioniCard = h('section', { class: 'card card-corpo', 'aria-labelledby': 'azioni-bk' }, h('h2', { id: 'azioni-bk', style: { fontSize: '16px', fontWeight: 700, marginBottom: '12px' } }, 'Operazioni'),
        h('div', { class: 'azioni-griglia' },
          azione('bk-crea', 'database-backup', 'Crea un backup ora', 'Salva una copia nell\'archivio storico', async () => { await eseguiBackupRapido(); }, true),
          azione('bk-esporta', 'download', 'Esporta l\'archivio completo', 'Un file da conservare o spostare', async () => { try { const r = await esportaArchivio(app); if (r.annullato) return; notificaOk(`Archivio esportato (${dimensioneFile(r.dimensione)}).`); } catch (e) { segnalaErrore(e, 'Esportazione'); } }),
          azione('bk-importa', 'upload', 'Importa un backup', 'Sostituisce i dati con un file salvato', () => eseguiImportazione()),
          azione('bk-csv', 'file-spreadsheet', 'Esporta in CSV (Excel)', 'Pratiche, provvigioni, incassi, liquidazioni', () => apriDialogoEsporta()),
          azione('bk-verifica', 'shield-check', 'Verifica l\'integrità', 'Controlla il database e la coerenza dei dati', () => { integrita = verificaIntegrita(app.archivio, modello()); disegna(); notificaOk(integrita.senzaProblemi ? 'Verifica completata: nessun problema.' : `Verifica completata: ${integrita.problemi.length} segnalazioni.`); })));

      // ---------- integrita'
      const integritaCard = h('section', { class: 'card card-corpo', id: 'integrita', 'aria-labelledby': 'integrita-t' },
        h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between' } }, h('h2', { id: 'integrita-t', style: { fontSize: '16px', fontWeight: 700 } }, 'Integrità del database'),
          integrita.senzaProblemi ? h('span', { class: 'badge badge-ok' }, icona('check', { dimensione: 14 }), 'Tutto in ordine') : integrita.ok ? h('span', { class: 'badge badge-warn' }, `${integrita.avvisi} da controllare`) : h('span', { class: 'badge badge-crit' }, `${integrita.errori} errori`)),
        h('div', { class: 'controlli', style: { marginTop: '12px' } }, integrita.controlli.map((c) => h('div', { class: `controllo ${c.ok ? 'ok' : 'ko'}` }, icona(c.ok ? 'circle-check' : 'circle-x', { dimensione: 18 }), h('div', null, h('b', null, c.nome), h('span', null, c.dettaglio))))),
        integrita.problemi.length ? h('div', { style: { marginTop: '14px' } }, h('div', { class: 'sottotesto forte', style: { marginBottom: '6px' } }, 'Segnalazioni'),
          h('ul', { class: 'avvisi compatto' }, integrita.problemi.map((p) => h('li', { class: `avviso ${p.livello === 'errore' ? 'critico' : 'avviso'}` }, h('span', { class: 'avviso-icona' }, icona(p.livello === 'errore' ? 'circle-x' : 'triangle-alert', { dimensione: 18 })),
            h('div', { class: 'avviso-corpo' }, h('div', { class: 'avviso-titolo' }, p.messaggio), p.praticaId ? h('a', { href: `#/pratiche/${p.praticaId}`, style: { fontSize: '13px' } }, 'Apri la pratica') : null))))) : null);

      // ---------- archivio storico
      const storico = h('section', { class: 'card', 'aria-labelledby': 'storico-t' },
        h('div', { class: 'card-testa' }, h('div', null, h('h2', { id: 'storico-t' }, 'Archivio storico dei backup'), h('p', null, `${copie.length} ${copie.length === 1 ? 'copia' : 'copie'} · le copie automatiche più vecchie vengono eliminate oltre le ${impostazioni()['backup.massimoAutomatici']} (le manuali restano finché non le elimini)`))),
        copie.length ? h('div', { class: 'tabella-wrap', style: { marginTop: '8px' } }, h('table', { class: 'tabella', id: 'tabella-storico' },
          h('caption', { class: 'solo-lettori' }, 'Copie di sicurezza'),
          h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Tipo'), h('th', { class: 'num' }, 'Dimensione'), h('th', null, h('span', { class: 'solo-lettori' }, 'Azioni')))),
          h('tbody', null, copie.map((c) => h('tr', { dataset: { copia: c.id } },
            h('td', { class: 'num forte' }, dataOra(c.creatoIl)),
            h('td', null, h('span', { class: `badge ${c.tipo === 'manuale' ? 'badge-info' : c.tipo === 'automatico' ? '' : 'badge-warn'}` }, TIPI_COPIA[c.tipo] ?? c.tipo)),
            h('td', { class: 'num' }, dimensioneFile(c.dimensione)),
            h('td', { class: 'num' }, h('div', { class: 'riga-azioni', style: { justifyContent: 'flex-end' } },
              h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => ripristinaConferma(c) }, icona('rotate-ccw', { dimensione: 15 }), 'Ripristina'),
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icona', 'aria-label': `Esporta la copia del ${dataOra(c.creatoIl)}`, title: 'Esporta questa copia come file', onclick: async () => {
                try { const b = await app.driver.leggiCopia(c.id); const r = await app.driver.esportaFile(b, nomeFileArchivio(new Date(c.creatoIl)), 'application/x-sqlite3'); if (r && r.salvato !== false) notificaOk('Copia esportata.'); } catch (e) { segnalaErrore(e, 'Esportazione copia'); }
              } }, icona('download', { dimensione: 15 })),
              h('button', { type: 'button', class: 'btn btn-pericolo-ghost btn-sm btn-icona', 'aria-label': `Elimina la copia del ${dataOra(c.creatoIl)}`, title: 'Elimina questa copia', onclick: async () => {
                const sì = await conferma({ titolo: 'Eliminare questa copia?', messaggio: `La copia del ${dataOra(c.creatoIl)} (${dimensioneFile(c.dimensione)}) verrà eliminata definitivamente.`, etichettaConferma: 'Elimina la copia', tipo: 'pericolo' });
                if (!sì) return;
                try { await app.driver.eliminaCopia(c.id); notificaOk('Copia eliminata.'); disegna(); } catch (e) { segnalaErrore(e, 'Eliminazione copia'); }
              } }, icona('trash-2', { dimensione: 15 })))))))))
          : h('div', { class: 'vuoto' }, icona('database-backup', { dimensione: 40 }), h('strong', null, 'Ancora nessuna copia'), h('p', null, 'Le copie che crei (e quella automatica giornaliera, se ci sono dati) compaiono qui.')));

      // ---------- registro
      const registro = leggiRegistro(app.archivio, 40);
      const registroCard = h('details', { class: 'card card-corpo' }, h('summary', { style: { cursor: 'pointer', fontWeight: 700, fontSize: '16px' } }, 'Registro delle attività importanti'),
        registro.length ? h('div', { class: 'tabella-wrap', style: { marginTop: '10px' } }, h('table', { class: 'tabella tabella-compatta' },
          h('thead', null, h('tr', null, h('th', null, 'Quando'), h('th', null, 'Che cosa'), h('th', null, 'Dettagli'))),
          h('tbody', null, registro.map((r) => h('tr', null, h('td', { class: 'num' }, dataOra(r.data)), h('td', { class: 'forte' }, ETICHETTE_EVENTO[r.tipo] ?? r.tipo), h('td', { class: 'sottotesto' }, r.dettaglio ?? '—'))))))
          : h('p', { class: 'sottotesto', style: { marginTop: '8px' } }, 'Nessuna attività registrata.'));

      // ---------- zona pericolosa
      const pericolo = h('section', { class: 'card card-corpo pericolo-zona', 'aria-labelledby': 'pericolo-t' },
        h('h2', { id: 'pericolo-t', style: { fontSize: '16px', fontWeight: 700 } }, 'Zona delicata'),
        h('p', { class: 'sottotesto', style: { margin: '4px 0 12px' } }, 'Cancella tutti i dati e riparte da un archivio vuoto. Prima viene salvata una copia di sicurezza, quindi si può sempre tornare indietro dall\'archivio storico.'),
        h('button', { type: 'button', class: 'btn btn-pericolo-ghost', id: 'bk-azzera', onclick: async () => {
          const sì = await conferma({ titolo: 'Cancellare tutti i dati?', messaggio: 'Stai per cancellare tutte le pratiche, gli incassi, le liquidazioni, le zone, gli scaglioni e le impostazioni.', dettagli: ['Verrà salvata una copia di sicurezza prima di cancellare.', 'Restano soltanto i collaboratori iniziali (Luca e Giuseppe).'], etichettaConferma: 'Cancella tutto', frase: 'CANCELLA', tipo: 'pericolo' });
          if (!sì) return;
          try { await azzeraArchivio(app); notificaOk('Archivio azzerato. La copia di sicurezza è nell\'archivio storico.', { azione: { etichetta: 'Vai alla dashboard', onClick: () => naviga('#/') } }); } catch (e) { segnalaErrore(e, 'Azzeramento'); }
        } }, icona('trash-2', { dimensione: 16 }), 'Cancella tutti i dati…'));

      monta(corpo, h('div', { style: { display: 'grid', gap: '16px' } }, statoCard, azioniCard, integritaCard, storico, registroCard, pericolo));
      if (query.sezione === 'integrita') { query.sezione = null; setTimeout(() => document.getElementById('integrita')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
    }

    monta(contenitore,
      h('div', { class: 'pagina-testa' }, h('div', null, h('h1', null, 'Backup e archivio storico'), h('p', null, 'Crea, esporta, importa e ripristina i dati. Prima di ogni operazione che sostituisce o cancella i dati ti viene chiesta una conferma e viene salvata una copia di sicurezza.'))),
      corpo);
    disegna();
    return { aggiorna() { integrita = null; disegna(); }, distruggi() { vivo = false; } };
  },
};
export { notificaErrore, potaCopie };
