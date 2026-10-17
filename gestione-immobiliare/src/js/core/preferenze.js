// Preferenze legate a questo computer (tema, barra laterale, filtri). Nel programma Windows stanno nella memoria locale della
// finestra. Nel browser NON si usa nessuna memoria del browser (non deve restare traccia): le preferenze vivono in memoria e,
// appena scelta la cartella dei dati, si leggono e si salvano nel file «preferenze.json» di quella cartella.

const nelProgramma = () => typeof window !== 'undefined' && !!window.gestionaleHost;
let memoria = {};
let scrittore = null;
let coda = Promise.resolve();

/** Nel browser: usa le preferenze lette dalla cartella dei dati e le riscrive lì a ogni cambiamento. */
export function usaPreferenzeSuCartella(iniziali, salva) {
  memoria = { ...(iniziali && typeof iniziali === 'object' ? iniziali : {}) };
  scrittore = salva;
}

export function leggiPref(chiave, predefinito = null) {
  if (!nelProgramma()) return Object.prototype.hasOwnProperty.call(memoria, chiave) ? memoria[chiave] : predefinito;
  try {
    const v = window.localStorage.getItem(`gi.${chiave}`);
    return v === null ? predefinito : JSON.parse(v);
  } catch {
    return predefinito;
  }
}

export function scriviPref(chiave, valore) {
  if (!nelProgramma()) {
    memoria[chiave] = valore;
    if (scrittore) { const copia = { ...memoria }; coda = coda.then(() => scrittore(copia)).catch(() => { /* la preferenza vale per questa sessione */ }); }
    return;
  }
  try {
    window.localStorage.setItem(`gi.${chiave}`, JSON.stringify(valore));
  } catch { /* memoria locale non disponibile: la preferenza vale solo per questa sessione */ }
}
