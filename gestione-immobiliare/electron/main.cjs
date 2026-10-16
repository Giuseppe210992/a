'use strict';
// Programma Windows di Gestione Immobiliare: una finestra che mostra l'interfaccia (dist/web) e salva i dati
// in un file nella cartella Documenti. Nessuna connessione a Internet, nessun server.

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { creaHost, cartellaBaseDati, cartellaTemporanea, comeBuffer } = require('./host-archivio.cjs');

// Una sola copia del programma alla volta: due copie aperte si sovrascriverebbero i dati a vicenda.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setName('Gestione Immobiliare');
if (process.platform === 'win32') app.setAppUserModelId('it.gestione-immobiliare.app');

// Cartella dei dati: Documenti\Gestione Immobiliare; nella versione portatile (chiavetta) accanto al programma;
// GESTIONE_IMMOBILIARE_DATI la sposta dove si vuole (prove automatiche).
const { cartella: cartellaBase, portatile } = cartellaBaseDati({ env: process.env, documenti: () => app.getPath('documents') });
// Versione portatile lanciata da una cartella temporanea (tipicamente aperta dentro lo ZIP scaricato): i dati rischiano di andare persi.
const portatileTemporaneo = portatile && cartellaTemporanea(process.env.PORTABLE_EXECUTABLE_DIR);
let host;
let finestra = null;
let ultimaCartellaFile = null;

function percorsoInterfaccia() {
  return path.join(__dirname, '..', 'dist', 'web', 'index.html');
}

function creaFinestra() {
  finestra = new BrowserWindow({
    width: 1360, height: 860, minWidth: 360, minHeight: 560, show: false,
    title: 'Gestione Immobiliare', backgroundColor: '#f6f7f9', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged,
    },
  });
  finestra.once('ready-to-show', () => finestra.show());
  finestra.loadFile(percorsoInterfaccia());

  // Nessuna navigazione fuori dall'interfaccia e nessuna nuova finestra: i collegamenti esterni non esistono.
  finestra.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  finestra.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('file://')) ev.preventDefault(); });
  // Cartella o finestra chiusa con modifiche non salvate in un modulo: chiede conferma in italiano.
  finestra.webContents.on('will-prevent-unload', (ev) => {
    const scelta = dialog.showMessageBoxSync(finestra, {
      type: 'warning', buttons: ['Resta qui', 'Chiudi senza salvare'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Modifiche non salvate', message: 'Hai modifiche non salvate.', detail: 'Se chiudi adesso verranno perse.',
    });
    if (scelta === 1) ev.preventDefault();
  });
  finestra.on('closed', () => { finestra = null; });
}

function registraComandi() {
  const comando = (canale, fn) => ipcMain.handle(canale, async (_ev, ...args) => fn(...args));

  comando('archivio:carica', () => host.carica());
  comando('archivio:salva', (bytes) => { host.salva(comeBuffer(bytes)); });
  comando('copie:elenca', () => host.elencaCopie());
  comando('copie:crea', (bytes, tipo) => host.creaCopia(comeBuffer(bytes), tipo));
  comando('copie:leggi', (id) => host.leggiCopia(id));
  comando('copie:elimina', (id) => host.eliminaCopia(id));
  comando('sistema:info', () => ({ ...host.info(), versione: app.getVersion(), piattaforma: process.platform, portatile, portatileTemporaneo }));
  comando('sistema:apriCartella', async (quale) => {
    const cartella = quale === 'backup' ? host.cartellaBackup : host.cartellaDati;
    // Nelle prove automatiche (senza finestre) non si apre Esplora file: si risponde come se fosse aperta.
    if (process.env.GESTIONE_IMMOBILIARE_SENZA_FINESTRE === '1') return { aperta: true, simulata: true, cartella };
    const errore = await shell.openPath(cartella);
    return errore ? { aperta: false, errore } : { aperta: true, cartella };
  });

  // Salvataggio di un file scelto dall'utente (esportazioni CSV e archivio completo)
  comando('file:salvaCome', async (bytes, nome, mime) => {
    const estensione = path.extname(nome).replace('.', '');
    const filtri = estensione === 'csv' ? [{ name: 'Foglio di calcolo (CSV)', extensions: ['csv'] }]
      : estensione === 'sqlite' ? [{ name: 'Archivio di Gestione Immobiliare', extensions: ['sqlite'] }] : [];
    void mime;
    // Nelle prove automatiche (cartella dei dati indicata da variabile) niente finestre: si salva nella cartella Esportazioni.
    if (process.env.GESTIONE_IMMOBILIARE_SENZA_FINESTRE === '1') {
      const dest = path.join(host.cartellaBase, 'Esportazioni');
      fs.mkdirSync(dest, { recursive: true });
      const percorso = path.join(dest, path.basename(nome));
      host.scriviFile(percorso, comeBuffer(bytes));
      return { salvato: true, percorso };
    }
    const r = await dialog.showSaveDialog(finestra, {
      title: 'Salva il file', defaultPath: path.join(ultimaCartellaFile || app.getPath('documents'), nome), filters: filtri,
    });
    if (r.canceled || !r.filePath) return { salvato: false, annullato: true };
    host.scriviFile(r.filePath, comeBuffer(bytes));
    ultimaCartellaFile = path.dirname(r.filePath);
    return { salvato: true, percorso: r.filePath };
  });

  // Scelta di un file da importare (backup)
  comando('file:apri', async (accept) => {
    if (process.env.GESTIONE_IMMOBILIARE_FILE_DA_APRIRE) {
      const percorso = process.env.GESTIONE_IMMOBILIARE_FILE_DA_APRIRE;
      return { nome: path.basename(percorso), bytes: fs.readFileSync(percorso) };
    }
    const estensioni = String(accept || '').split(',').map((x) => x.trim()).filter((x) => x.startsWith('.')).map((x) => x.slice(1));
    const r = await dialog.showOpenDialog(finestra, {
      title: 'Scegli il file', defaultPath: ultimaCartellaFile || app.getPath('documents'), properties: ['openFile'],
      filters: [...(estensioni.length ? [{ name: 'Archivio di Gestione Immobiliare', extensions: estensioni }] : []), { name: 'Tutti i file', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    ultimaCartellaFile = path.dirname(r.filePaths[0]);
    return { nome: path.basename(r.filePaths[0]), bytes: fs.readFileSync(r.filePaths[0]) };
  });
}

app.on('second-instance', () => {
  if (finestra) { if (finestra.isMinimized()) finestra.restore(); finestra.focus(); }
});

app.whenReady().then(() => {
  if (portatileTemporaneo && process.env.GESTIONE_IMMOBILIARE_SENZA_FINESTRE !== '1') {
    const scelta = dialog.showMessageBoxSync({
      type: 'warning', buttons: ['Chiudi', 'Continua lo stesso'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Gestione Immobiliare', message: 'Il programma è aperto da una cartella temporanea.',
      detail: 'Sembra che tu l\'abbia aperto direttamente da dentro un file ZIP: i dati salvati qui potrebbero andare persi quando Windows svuota la cartella temporanea.\n\n'
        + 'Chiudi, copia il file «Portatile» sulla chiavetta (o in una cartella del computer) e aprilo da lì.',
    });
    if (scelta === 0) { app.quit(); return; }
  }
  try {
    host = creaHost(cartellaBase);
  } catch (e) {
    const consiglio = portatile ? '\n\nSe usi la chiavetta: controlla che non sia piena né protetta da scrittura (a volte c\'è un interruttore sul bordo), oppure copia il programma in una cartella del computer.' : '';
    dialog.showErrorBox('Gestione Immobiliare', `Non riesco a usare la cartella dei dati:\n${cartellaBase}\n\n${e.message}${consiglio}`);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  registraComandi();
  creaFinestra();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) creaFinestra(); });
});

app.on('window-all-closed', () => { app.quit(); });
