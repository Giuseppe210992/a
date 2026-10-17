// Stima delle provvigioni di una pratica "in bozza": si simula la pratica come conclusa
// nel suo mese e si ricalcola il modello, senza scrivere nulla nel database.
import { calcolaModello } from './calc/modello.js';
import { leggiDati, normalizzaPratica } from './repo/pratiche.js';
import { oggi } from '../core/dates.js';

export function stimaPratica(archivio, bozza, quote, opzioni) {
  const dati = leggiDati(archivio);
  const idId = bozza.id ?? null;
  const idTemp = idId ?? -1;
  dati.pratiche = dati.pratiche.filter((p) => p.id !== idId);
  dati.quote = dati.quote.filter((q) => q.pratica_id !== idId);
  dati.incassi = dati.incassi.filter((i) => i.pratica_id !== idId || idId === null);
  const n = normalizzaPratica(bozza);
  const simulata = n.stato !== 'conclusa';
  dati.pratiche.push({
    ...n,
    id: idTemp,
    codice: n.codice || '(nuova)',
    stato: 'conclusa',
    data_pratica: n.data_pratica || oggi(),
    data_rogito: n.data_rogito || (simulata ? oggi() : n.data_pratica || oggi()),
    aggiornato_il: new Date().toISOString(),
    creato_il: new Date().toISOString(),
  });
  for (const q of quote) {
    if (q.collaboratore_id && Number.isFinite(q.percentuale) && q.percentuale > 0) {
      dati.quote.push({ pratica_id: idTemp, collaboratore_id: q.collaboratore_id, percentuale: q.percentuale });
    }
  }
  const m = calcolaModello(dati, opzioni);
  const p = m.perId.get(idTemp);
  return {
    simulata,
    pratica: p,
    mese: p.meseRif,
    cumuli: m.cumuli.filter((c) => c.praticheIds.includes(idTemp)),
    modello: m,
  };
}
