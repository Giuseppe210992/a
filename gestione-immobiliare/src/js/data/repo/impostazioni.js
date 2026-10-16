// Impostazioni del programma, salvate nel database (quindi incluse nei backup).
// Ogni valore e' salvato come JSON. Le preferenze legate al singolo computer (tema, barra laterale)
// stanno invece nel browser/finestra e non fanno parte dei backup.

export const PREDEFINITE = Object.freeze({
  'agenzia.nome': '',
  'iva.aliquote': [22, 10, 4, 0],
  'iva.predefinita': 22,
  'calcolo.metodo': 'raggiunto',
  'calcolo.baseCumulo': 'collaboratore_zona',
  'calcolo.maturazione': 'conclusione',
  'ripartizione.predefinita': [],
  'avvisi.giorniBackup': 7,
  'avvisi.sogliaScaglionePct': 20,
  'backup.ultimo': null,
  'backup.ultimoTipo': null,
  'backup.automatico': true,
  'backup.massimoAutomatici': 30,
});

export function leggiImpostazioni(db) {
  const out = { ...PREDEFINITE };
  for (const r of db.tutti('SELECT chiave, valore FROM impostazioni')) {
    try { out[r.chiave] = JSON.parse(r.valore); } catch { /* valore illeggibile: resta il predefinito */ }
  }
  return out;
}

/** Scrive una o piu' impostazioni (oggetto chiave -> valore). */
export function scriviImpostazioni(db, parziale, opzioni) {
  return db.transazione(() => {
    for (const [chiave, valore] of Object.entries(parziale)) {
      if (!(chiave in PREDEFINITE)) throw new Error(`Impostazione sconosciuta: ${chiave}`);
      db.esegui(
        'INSERT INTO impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore',
        [chiave, JSON.stringify(valore)],
      );
    }
  }, opzioni);
}

export function opzioniCalcolo(imp) {
  return {
    metodo: imp['calcolo.metodo'],
    baseCumulo: imp['calcolo.baseCumulo'],
    maturazione: imp['calcolo.maturazione'],
  };
}

export function registra(db, tipo, dettaglio) {
  db.esegui('INSERT INTO registro (data, tipo, dettaglio) VALUES (?, ?, ?)', [new Date().toISOString(), tipo, dettaglio ?? null]);
}

export function leggiRegistro(db, limite = 100) {
  return db.tutti('SELECT * FROM registro ORDER BY id DESC LIMIT ?', [limite]);
}
