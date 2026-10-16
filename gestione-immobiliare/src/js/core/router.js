// Navigazione tra le schermate (indirizzi del tipo #/pratiche/12).
// Ogni schermata e' un oggetto { id, titolo, monta(contenitore, parametri, query) } che puo' restituire
// { aggiorna() } per ridisegnarsi quando i dati cambiano, e { haModifiche() } per proteggere le modifiche non salvate.

import { conferma } from './ui.js';

const rotte = [];
let corrente = null;           // { vista, istanza, parametri, query, contenitore }
let contenitoreVista = null;
let hashPrecedente = '#/';
let ignoraProssimo = false;
let alCambioRotta = null;
let primoMontaggio = true;

export function registraRotta(percorso, vista) {
  const nomi = [];
  const rx = new RegExp('^' + percorso.replace(/:[a-z]+/gi, (m) => { nomi.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
  rotte.push({ rx, nomi, vista, percorso });
}

export function analizzaHash(hash) {
  const grezzo = (hash || '').replace(/^#/, '') || '/';
  const [percorso, qs = ''] = grezzo.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { percorso: percorso.startsWith('/') ? percorso : `/${percorso}`, query };
}

function risolvi(hash) {
  const { percorso, query } = analizzaHash(hash);
  for (const r of rotte) {
    const m = r.rx.exec(percorso);
    if (m) {
      const parametri = Object.fromEntries(r.nomi.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { vista: r.vista, parametri, query, percorso };
    }
  }
  return null;
}

export function naviga(hash) {
  if (location.hash === hash) { ridisegna(); return; }
  location.hash = hash;
}

export function iniziaRouter(contenitore, callback) {
  contenitoreVista = contenitore;
  alCambioRotta = callback;
  window.addEventListener('hashchange', alHash);
  window.addEventListener('beforeunload', (ev) => {
    if (corrente?.istanza?.haModifiche?.()) { ev.preventDefault(); ev.returnValue = ''; }
  });
  if (!location.hash) history.replaceState(null, '', '#/');
  hashPrecedente = location.hash;
  monta();
}

async function alHash() {
  if (ignoraProssimo) { ignoraProssimo = false; return; }
  if (corrente?.istanza?.haModifiche?.()) {
    const esci = await conferma({
      titolo: 'Uscire senza salvare?',
      messaggio: 'Hai modifiche non salvate: se esci verranno perse.',
      etichettaConferma: 'Esci senza salvare',
      etichettaAnnulla: 'Resta qui',
      tipo: 'pericolo',
    });
    if (!esci) {
      ignoraProssimo = true;
      location.hash = hashPrecedente;
      return;
    }
  }
  hashPrecedente = location.hash;
  monta();
}

function smonta() {
  if (corrente?.istanza?.distruggi) {
    try { corrente.istanza.distruggi(); } catch (e) { console.error(e); }
  }
  corrente = null;
}

function monta() {
  const r = risolvi(location.hash);
  smonta();
  contenitoreVista.replaceChildren();
  if (!r) {
    const v = rotte[0].vista; // sconosciuta: torna alla dashboard
    history.replaceState(null, '', '#/');
    hashPrecedente = '#/';
    corrente = { vista: v, parametri: {}, query: {} };
    corrente.istanza = v.monta(contenitoreVista, {}, {}) || {};
    if (alCambioRotta) alCambioRotta(v, {}, {});
    window.scrollTo(0, 0);
    return;
  }
  corrente = { vista: r.vista, parametri: r.parametri, query: r.query };
  document.title = `${r.vista.titolo} · Gestione Immobiliare`;
  try {
    corrente.istanza = r.vista.monta(contenitoreVista, r.parametri, r.query) || {};
  } catch (e) {
    console.error(e);
    corrente.istanza = {};
    contenitoreVista.textContent = `Si è verificato un errore nel mostrare questa schermata: ${e.message}`;
  }
  if (alCambioRotta) alCambioRotta(r.vista, r.parametri, r.query);
  window.scrollTo(0, 0);
  // Cambiando schermata il focus va al contenuto (per chi usa la tastiera o un lettore di schermo), a meno che la schermata
  // non abbia già messo il cursore in un suo campo, come fa il modulo di nuova pratica.
  // All'apertura del programma invece non si sposta nulla: con Tab si parte dall'inizio (salto al contenuto, menu, intestazione).
  if (!primoMontaggio && !contenitoreVista.contains(document.activeElement)) contenitoreVista.focus({ preventScroll: true });
  primoMontaggio = false;
}

/** Ridisegna la schermata corrente (dopo una modifica ai dati o ai filtri). */
export function ridisegna() {
  if (!corrente) return;
  const { vista, parametri, query, istanza } = corrente;
  if (vista.autoAggiorna === false) return; // le schermate con moduli non vengono ridisegnate sotto le mani dell'utente
  if (istanza?.aggiorna) { istanza.aggiorna(); return; }
  const y = window.scrollY;
  smonta();
  contenitoreVista.replaceChildren();
  corrente = { vista, parametri, query };
  try {
    corrente.istanza = vista.monta(contenitoreVista, parametri, query) || {};
  } catch (e) {
    console.error(e);
    corrente.istanza = {};
    contenitoreVista.textContent = `Si è verificato un errore nel mostrare questa schermata: ${e.message}`;
  }
  window.scrollTo(0, y);
}

/** Ricostruisce da zero la schermata corrente (ad esempio per svuotare un modulo dopo averlo salvato). */
export function rimonta() {
  if (!corrente) return;
  const { vista, parametri, query } = corrente;
  smonta();
  contenitoreVista.replaceChildren();
  corrente = { vista, parametri, query };
  try {
    corrente.istanza = vista.monta(contenitoreVista, parametri, query) || {};
  } catch (e) {
    console.error(e);
    corrente.istanza = {};
    contenitoreVista.textContent = `Si è verificato un errore nel mostrare questa schermata: ${e.message}`;
  }
  window.scrollTo(0, 0);
}

export function rottaCorrente() {
  return corrente;
}
