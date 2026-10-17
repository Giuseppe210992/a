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

/**
 * Conguaglio del cumulo mensile: se la pratica si cumula con altre dello stesso mese (stessa zona e collaboratore, secondo
 * il metodo scelto) lo scaglione può salire e anche le pratiche precedenti ne guadagnano. Per ogni collaboratore coinvolto:
 *   giaPagatoCent         provvigione già pagata sulle pratiche precedenti (senza questa)
 *   differenzaCent        quanto ancora gli spetta sulle pratiche precedenti, a causa di questa
 *   nuovaCent             provvigione di questa pratica
 *   totaleCent            pratiche precedenti ricalcolate + questa
 */
export function conguaglio(archivio, bozza, quote, opzioni) {
  const s = stimaPratica(archivio, bozza, quote, opzioni);
  const idTemp = bozza.id ?? -1;
  const dati = leggiDati(archivio);
  const idId = bozza.id ?? null;
  dati.pratiche = dati.pratiche.filter((p) => p.id !== idId);
  dati.quote = dati.quote.filter((q) => q.pratica_id !== idId);
  const prima = calcolaModello(dati, opzioni);
  const nomi = new Map(s.modello.collaboratori.map((c) => [c.id, c.nome]));
  const somma = (voci) => voci.reduce((t, v) => t + v.provvigioneCent, 0);
  const righe = [];
  for (const c of s.cumuli) {
    if (!c.praticheIds.some((id) => id !== idTemp)) continue;
    const c0 = prima.cumuli.find((x) => x.chiave === c.chiave);
    for (const v of c.voci.filter((x) => x.praticaId === idTemp && x.collaboratoreId != null)) {
      const dopo = c.voci.filter((x) => x.praticaId !== idTemp && x.collaboratoreId === v.collaboratoreId);
      if (!dopo.length) continue;
      const prec = (c0?.voci || []).filter((x) => x.collaboratoreId === v.collaboratoreId);
      const giaPagatoCent = somma(prec);
      const nuovoVecchieCent = somma(dopo);
      righe.push({
        collaboratoreId: v.collaboratoreId, nome: nomi.get(v.collaboratoreId) ?? 'Collaboratore', mese: c.mese, zonaNome: c.zonaNome,
        pratichePrecedenti: new Set(dopo.map((x) => x.praticaId)).size,
        giaPagatoCent, differenzaCent: nuovoVecchieCent - giaPagatoCent, nuovaCent: v.provvigioneCent, totaleCent: nuovoVecchieCent + v.provvigioneCent,
      });
    }
  }
  return righe;
}
