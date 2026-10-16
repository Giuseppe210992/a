'use strict';
// Ponte tra la pagina e il processo principale: la pagina vede soltanto queste funzioni (nessun accesso diretto a Node).
const { contextBridge, ipcRenderer } = require('electron');

const chiama = (canale, ...args) => ipcRenderer.invoke(canale, ...args);

contextBridge.exposeInMainWorld('gestionaleHost', {
  archivio: {
    carica: () => chiama('archivio:carica'),
    salva: (bytes) => chiama('archivio:salva', bytes),
  },
  copie: {
    elenca: () => chiama('copie:elenca'),
    crea: (bytes, tipo) => chiama('copie:crea', bytes, tipo),
    leggi: (id) => chiama('copie:leggi', id),
    elimina: (id) => chiama('copie:elimina', id),
  },
  file: {
    salvaCome: (bytes, nome, mime) => chiama('file:salvaCome', bytes, nome, mime),
    apri: (accept) => chiama('file:apri', accept),
  },
  sistema: {
    info: () => chiama('sistema:info'),
    apriCartella: (quale) => chiama('sistema:apriCartella', quale),
  },
});
