// Avvio del programma: carica il motore SQLite, apre l'archivio, costruisce la struttura e le schermate.
import initSqlJs from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm-browser.wasm';
import { app, ui, impostazioni, modello, alleVariazioniFiltri } from './core/app.js';
import { h } from './core/dom.js';
import { leggiPref } from './core/preferenze.js';
import { registraRotta, iniziaRouter, ridisegna } from './core/router.js';
import { unaVolta } from './core/dom.js';
import { caricaMotore, Archivio } from './data/db.js';
import { DriverIndexedDb } from './data/drivers/indexeddb.js';
import { DriverFile, hostDisponibile } from './data/drivers/host-file.js';
import { seedPrimoAvvio } from './data/inizializza.js';
import * as backup from './data/backup.js';
import { backupAutomatico } from './data/backup.js';
import * as anagrafiche from './data/repo/anagrafiche.js';
import * as pratiche from './data/repo/pratiche.js';
import * as impostazioniRepo from './data/repo/impostazioni.js';
import { costruisciShell } from './shell.js';
import { schermataRecupero } from './views/recupero.js';
import { dashboard } from './views/dashboard.js';
import { vistaNuova, vistaModifica } from './views/pratica-form.js';
import { archivio as vistaArchivio } from './views/archivio.js';
import { scheda } from './views/pratica-scheda.js';
import { provvigioni } from './views/provvigioni.js';
import { cumulo } from './views/cumulo.js';
import { statistiche } from './views/statistiche.js';
import { backup as vistaBackup } from './views/backup.js';
import { impostazioniVista } from './views/impostazioni.js';

function applicaTemaIniziale() {
  const t = leggiPref('tema', 'auto');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
}

function schermataErrore(radice, titolo, messaggio) {
  radice.className = '';
  radice.replaceChildren(h('div', { class: 'avvio' }, h('div', { class: 'avvio-box', style: { maxWidth: '520px', padding: '24px' } },
    h('h1', { style: { fontSize: '22px', marginBottom: '8px' } }, titolo), h('p', null, messaggio))));
}

async function avvia() {
  const radice = document.getElementById('app');
  applicaTemaIniziale();

  let SQL;
  try {
    SQL = await caricaMotore(initSqlJs, wasmBinary);
  } catch (e) {
    console.error(e);
    schermataErrore(radice, 'Impossibile avviare il motore dei dati', `Il motore SQLite non si è avviato: ${e.message}`);
    return;
  }

  app.SQL = SQL;
  app.hostProgramma = hostDisponibile();
  const driver = app.hostProgramma ? new DriverFile() : new DriverIndexedDb();
  app.driver = driver;

  let archivio = new Archivio(SQL, driver);
  try {
    await archivio.apri();
  } catch (e) {
    console.error(e);
    if (e.codice === 'illeggibile') {
      await schermataRecupero(radice, { app, SQL, driver, motivo: e.message, riavvia: () => location.reload() });
      return;
    }
    schermataErrore(radice, 'Impossibile aprire l\'archivio', `${e.message}${app.hostProgramma ? '' : ' Se stai usando una finestra anonima o il browser blocca la memoria locale, i dati non possono essere salvati.'}`);
    return;
  }
  if (archivio.primoAvvio) await seedPrimoAvvio(archivio);
  app.archivio = archivio;
  try { await driver.chiediPersistenza?.(); } catch { /* non essenziale */ }

  const shell = costruisciShell(radice);
  ui.cerca = () => { shell.ricerca.metti(''); };
  ui.aggiornaAvvisi = () => shell.aggiornaAvvisi();
  ui.applicaTema = (t) => shell.applicaTema(t);

  registraRotta('/', dashboard);
  registraRotta('/nuova', vistaNuova);
  registraRotta('/pratiche', vistaArchivio);
  registraRotta('/pratiche/:id/modifica', vistaModifica);
  registraRotta('/pratiche/:id', scheda);
  registraRotta('/provvigioni', provvigioni);
  registraRotta('/cumulo', cumulo);
  registraRotta('/statistiche', statistiche);
  registraRotta('/backup', vistaBackup);
  registraRotta('/impostazioni', impostazioniVista);

  const aggiornaTutto = unaVolta(() => {
    shell.aggiornaIntestazione();
    shell.aggiornaAvvisi();
    shell.ricerca.aggiorna();
    ridisegna();
  });
  archivio.alCambiamento(aggiornaTutto);
  alleVariazioniFiltri(() => { shell.aggiornaIntestazione(); ridisegna(); });

  iniziaRouter(shell.vista, (vista, params, query) => {
    shell.evidenziaVoce(window.location.hash.replace(/^#/, '').split('?')[0] || '/');
    shell.impostaFiltri(vista.filtri || false);
    shell.aggiornaIntestazione();
    shell.chiudiMenuMobile();
    void params; void query;
  });
  shell.aggiornaAvvisi();

  // una copia automatica al giorno, senza disturbare
  backupAutomatico(app).then((c) => { if (c) shell.aggiornaAvvisi(); }).catch((e) => console.warn('Backup automatico non riuscito', e));

  // utile per i test e la diagnosi
  window.__gi = { app, modello, impostazioni, shell, api: { ...anagrafiche, ...pratiche, ...impostazioniRepo, backup } };
}

avvia().catch((e) => {
  console.error(e);
  const radice = document.getElementById('app');
  if (radice) schermataErrore(radice, 'Si è verificato un errore', e.message);
});
