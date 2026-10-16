// Stato condiviso dell'applicazione: archivio, impostazioni, modello di calcolo e filtri.
import { calcolaModello } from '../data/calc/modello.js';
import { leggiDati } from '../data/repo/pratiche.js';
import { leggiImpostazioni, opzioniCalcolo } from '../data/repo/impostazioni.js';
import { risolviPeriodo, oggi } from './dates.js';
import { leggiPref, scriviPref } from './preferenze.js';

const ascoltatoriFiltri = new Set();

/** Collegamenti verso la struttura (impostati all'avvio da main.js): ricerca rapida, aggiornamento avvisi. */
export const ui = { cerca: () => {}, aggiornaAvvisi: () => {}, applicaTema: () => {} };

function filtriIniziali() {
  const anno = +oggi().slice(0, 4);
  const base = { periodo: { tipo: 'anno', anno, mese: +oggi().slice(5, 7), da: null, a: null }, zonaId: null, collaboratoreId: null, granularita: 'mensile' };
  const salvati = leggiPref('filtri', null);
  if (!salvati || typeof salvati !== 'object') return base;
  return {
    ...base,
    ...salvati,
    periodo: { ...base.periodo, ...(salvati.periodo || {}) },
  };
}

export const app = {
  SQL: null,
  driver: null,
  archivio: null,
  hostProgramma: false,       // true quando gira nel programma Windows
  versione: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'sviluppo',
  filtri: filtriIniziali(),
  _cache: { v: -1, imp: null, modello: null, chiaveOpz: null },
};

function aggiornaCache() {
  const v = app.archivio.versione;
  if (app._cache.v === v) return;
  const imp = leggiImpostazioni(app.archivio);
  app._cache = { v, imp, modello: calcolaModello(leggiDati(app.archivio), opzioniCalcolo(imp)) };
}

export function impostazioni() {
  aggiornaCache();
  return app._cache.imp;
}

export function modello() {
  aggiornaCache();
  return app._cache.modello;
}

/** Periodo risolto in date, con le correzioni per zone/collaboratori eliminati. */
export function contesto() {
  const m = modello();
  const f = app.filtri;
  const zonaOk = f.zonaId != null && m.zone.some((z) => z.id === f.zonaId);
  const collabOk = f.collaboratoreId != null && m.collaboratori.some((c) => c.id === f.collaboratoreId);
  return {
    periodo: risolviPeriodo(f.periodo, oggi(), m.limiti),
    zonaId: zonaOk ? f.zonaId : null,
    collaboratoreId: collabOk ? f.collaboratoreId : null,
    granularita: f.granularita,
  };
}

export function impostaFiltri(parziale) {
  const nuovo = { ...app.filtri, ...parziale };
  if (parziale.periodo) nuovo.periodo = { ...app.filtri.periodo, ...parziale.periodo };
  app.filtri = nuovo;
  scriviPref('filtri', nuovo);
  for (const cb of [...ascoltatoriFiltri]) cb(nuovo);
}

export function alleVariazioniFiltri(cb) {
  ascoltatoriFiltri.add(cb);
  return () => ascoltatoriFiltri.delete(cb);
}

export function azzeraFiltri() {
  const anno = +oggi().slice(0, 4);
  impostaFiltri({ periodo: { tipo: 'anno', anno, mese: +oggi().slice(5, 7), da: null, a: null }, zonaId: null, collaboratoreId: null });
}

export function filtriAttivi() {
  const c = contesto();
  const anno = +oggi().slice(0, 4);
  const p = app.filtri.periodo;
  return c.zonaId != null || c.collaboratoreId != null || p.tipo !== 'anno' || p.anno !== anno;
}
