// Avvio del programma: carica il motore SQLite, apre l'archivio, costruisce la struttura e le schermate.
import initSqlJs from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm-browser.wasm';
import { app, ui, impostazioni, modello, alleVariazioniFiltri } from './core/app.js';
import { h } from './core/dom.js';
import { leggiPref, usaPreferenzeSuCartella } from './core/preferenze.js';
import { registraRotta, iniziaRouter, ridisegna } from './core/router.js';
import { unaVolta } from './core/dom.js';
import { caricaMotore, Archivio } from './data/db.js';
import { DriverCartella, cartellaSupportata, scegliCartellaDati } from './data/drivers/cartella.js';
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

/**
 * Nel browser non si salva nulla nel browser: serve la cartella dei dati. Il browser permette di sceglierla solo con un clic
 * dell'utente, e non la ricorda: a ogni apertura si sceglie di nuovo la stessa cartella (una volta sola per apertura).
 */
function schermataScegliCartella(radice) {
  radice.className = '';
  return new Promise((risolvi) => {
    const msg = h('p', { id: 'msg-cartella', class: 'sottotesto', role: 'status', style: { marginTop: '12px' } });
    const scegli = async () => {
      msg.textContent = '';
      try {
        risolvi(await scegliCartellaDati());
      } catch (e) {
        if (!e || e.name !== 'AbortError') msg.textContent = e?.message || 'Non riesco ad aprire la cartella.';
      }
    };
    radice.replaceChildren(h('div', { class: 'avvio' }, h('div', { class: 'avvio-box', style: { maxWidth: '560px', padding: '24px' } },
      h('h1', { style: { fontSize: '22px', marginBottom: '8px' } }, 'Gestione Immobiliare'),
      h('p', null, 'Scegli la cartella dove tenere i dati (ad esempio sulla chiavetta). Tutto viene salvato solo lì: il browser non conserva nulla, quindi non devi cancellare i dati di navigazione.'),
      h('p', { style: { marginTop: '8px' } }, 'La prima volta crea una cartella vuota (ad esempio «Dati Immobiliare» sulla chiavetta: il browser non accetta direttamente Desktop, Documenti o la radice di un disco); le volte dopo scegli sempre la stessa. Se il browser chiede il permesso di modificare i file, consenti.'),
      h('div', { class: 'riga-azioni', style: { marginTop: '16px' } },
        h('button', { type: 'button', class: 'btn btn-primario', id: 'scegli-cartella', onclick: scegli }, 'Scegli la cartella dei dati')),
      msg)));
  });
}

const NOME_BLOCCO = 'gestione-immobiliare-archivio';

/**
 * Nel browser l'archivio sta in un solo posto: due finestre aperte insieme si sovrascriverebbero a vicenda
 * (vince l'ultima che salva). Una sola finestra alla volta ottiene il blocco; le altre aspettano.
 * Restituisce false se un'altra finestra sta già usando l'archivio.
 */
let bloccoPreso = false;
async function assicuraBloccoArchivio() {
  if (!bloccoPreso) bloccoPreso = await prendiBloccoArchivio();
  return bloccoPreso;
}

function prendiBloccoArchivio() {
  if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true); // browser vecchio: nessuna protezione possibile
  return new Promise((risolvi) => {
    navigator.locks.request(NOME_BLOCCO, { ifAvailable: true }, (blocco) => {
      if (!blocco) { risolvi(false); return undefined; }
      risolvi(true);
      return new Promise(() => {}); // il blocco resta finché la finestra è aperta
    }).catch(() => risolvi(true));
  });
}

function schermataGiaAperto(radice) {
  radice.className = '';
  radice.replaceChildren(h('div', { class: 'avvio' }, h('div', { class: 'avvio-box', style: { maxWidth: '540px', padding: '24px' } },
    h('h1', { style: { fontSize: '22px', marginBottom: '8px' } }, 'Gestione Immobiliare è già aperto in un\'altra finestra'),
    h('p', null, 'I dati si possono usare da una sola finestra alla volta: due finestre insieme potrebbero cancellarsi a vicenda le modifiche.'),
    h('p', { style: { marginTop: '8px' } }, 'Chiudi l\'altra finestra (o scheda) e premi “Riprova”.'),
    h('div', { class: 'riga-azioni', style: { marginTop: '16px' } },
      h('button', { type: 'button', class: 'btn btn-primario', onclick: async () => { if (await assicuraBloccoArchivio()) avviaConGestioneErrori(); } }, 'Riprova')))));
}

async function avvia() {
  const radice = document.getElementById('app');
  applicaTemaIniziale();
  if (!hostDisponibile() && !(await assicuraBloccoArchivio())) { schermataGiaAperto(radice); return; }

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
  let driver;
  if (app.hostProgramma) driver = new DriverFile();
  else {
    if (!cartellaSupportata()) {
      schermataErrore(radice, 'Questo browser non può salvare i dati', 'Per salvare solo in una cartella tua, senza lasciare tracce nel browser, apri il programma con Google Chrome o Microsoft Edge (su computer), oppure usa il programma per Windows.');
      return;
    }
    driver = new DriverCartella(await schermataScegliCartella(radice));
    usaPreferenzeSuCartella(await driver.caricaPreferenze(), (o) => driver.salvaPreferenze(o));
    applicaTemaIniziale();
  }
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
    schermataErrore(radice, 'Impossibile aprire l\'archivio', `${e.message}${app.hostProgramma ? '' : ' Controlla di aver scelto la cartella giusta e di aver consentito la modifica dei file.'}`);
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

function avviaConGestioneErrori() {
  avvia().catch((e) => {
    console.error(e);
    const radice = document.getElementById('app');
    if (radice) schermataErrore(radice, 'Si è verificato un errore', e.message);
  });
}
avviaConGestioneErrori();
