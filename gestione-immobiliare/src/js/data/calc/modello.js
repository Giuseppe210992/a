// Motore di calcolo: da dati grezzi (righe del database) al "modello" derivato che usano
// tutte le schermate: importi per pratica, ripartizione tra collaboratori, cumulo mensile,
// scaglioni raggiunti, provvigioni maturate / liquidate / da liquidare.
//
// Sono funzioni pure: stessi dati in ingresso -> stesso risultato, senza accedere al database.
// Importi sempre in centesimi interi.

import { chiaveMese } from '../../core/dates.js';
import {
  arrotonda, creaTabella, controllaTabella, indiceScaglione, percentualeRaggiunta,
  prossimoScaglione, descriviScaglioni, distribuisciProvvigione,
} from './scaglioni.js';

export const OPZIONI_PREDEFINITE = Object.freeze({
  metodo: 'raggiunto',            // 'raggiunto' | 'progressivo'
  baseCumulo: 'collaboratore_zona', // 'collaboratore_zona' | 'zona' | 'collaboratore'
  maturazione: 'conclusione',     // 'conclusione' | 'incasso'
});

export const ETICHETTE_MANCANTI = Object.freeze({
  zona: 'Zona non indicata',
  data_rogito: 'Data del rogito mancante',
  prezzo_vendita: 'Prezzo di vendita mancante',
  compensi: 'Compensi non inseriti',
  ripartizione: 'Ripartizione tra collaboratori mancante',
  ripartizione_somma: 'La ripartizione non fa 100%',
});

/** Attribuisce un importo tra le quote con il metodo del "resto maggiore": la somma e' sempre esatta. */
function attribuisci(totaleCent, quote) {
  const sommaBp = quote.reduce((s, q) => s + Math.round(q.percentuale * 100), 0);
  const parti = quote.map((q) => {
    const bp = Math.round(q.percentuale * 100);
    const num = totaleCent * bp;
    return { q, bp, intero: Math.floor(num / 10000), resto: num % 10000 };
  });
  if (sommaBp === 10000) {
    let avanzo = totaleCent - parti.reduce((s, p) => s + p.intero, 0);
    const ordine = parti.map((p, i) => i).sort((a, b) => parti[b].resto - parti[a].resto || a - b);
    for (const i of ordine) {
      if (avanzo <= 0) break;
      parti[i].intero += 1;
      avanzo -= 1;
    }
  } else {
    // Ripartizione incompleta o eccedente: arrotondamento semplice (verra' segnalata come dato mancante).
    for (const p of parti) p.intero = arrotonda(totaleCent * p.bp, 10000);
  }
  return parti.map((p) => p.intero);
}

export function calcolaModello(dati, opzioniIn = {}) {
  const opz = { ...OPZIONI_PREDEFINITE, ...opzioniIn };
  const collaboratori = dati.collaboratori || [];
  const zone = dati.zone || [];
  const pratiche = dati.pratiche || [];

  const collabPerId = new Map(collaboratori.map((c) => [c.id, c]));
  const zonaPerId = new Map(zone.map((z) => [z.id, z]));

  // --- tabelle degli scaglioni (predefinita + eventuali per zona)
  const tabellaPredefinita = creaTabella((dati.scaglioni || []).filter((s) => s.zona_id == null));
  const tabellePerZona = new Map();
  for (const z of zone) {
    if (!z.usa_scaglioni_propri) continue;
    const t = creaTabella((dati.scaglioni || []).filter((s) => s.zona_id === z.id));
    if (t.length) tabellePerZona.set(z.id, t);
  }
  const tabellaPer = (zonaId) => (zonaId != null && tabellePerZona.get(zonaId)) || tabellaPredefinita;

  // --- indici di supporto
  const quotePerPratica = new Map();
  for (const q of dati.quote || []) {
    if (!quotePerPratica.has(q.pratica_id)) quotePerPratica.set(q.pratica_id, []);
    quotePerPratica.get(q.pratica_id).push(q);
  }
  const incassatoPerPratica = new Map();
  for (const i of dati.incassi || []) {
    incassatoPerPratica.set(i.pratica_id, (incassatoPerPratica.get(i.pratica_id) || 0) + i.importo_cent);
  }
  const collabDiLiquidazione = new Map((dati.liquidazioni || []).map((l) => [l.id, l.collaboratore_id]));
  const liquidatoPerVoce = new Map();
  for (const r of dati.righe || []) {
    const chiave = `${r.pratica_id}|${collabDiLiquidazione.get(r.liquidazione_id)}`;
    liquidatoPerVoce.set(chiave, (liquidatoPerVoce.get(chiave) || 0) + r.importo_cent);
  }

  // --- 1) pratiche e voci (una voce per ogni collaboratore della ripartizione)
  const out = [];
  const perId = new Map();
  const tutteLeVoci = [];

  for (const riga of pratiche) {
    const conclusa = riga.stato === 'conclusa';
    const inCorso = riga.stato === 'in_corso';
    const annullata = riga.stato === 'annullata';
    const compensoTotaleCent = (riga.compenso_venditore_cent || 0) + (riga.compenso_acquirente_cent || 0);
    const aliquota = riga.aliquota_iva ?? 0;
    const ivaCent = arrotonda(compensoTotaleCent * Math.round(aliquota * 100), 10000);
    const totaleLordoCent = compensoTotaleCent + ivaCent;
    const incassatoCent = incassatoPerPratica.get(riga.id) || 0;
    const daIncassareCent = Math.max(0, totaleLordoCent - incassatoCent);
    const frazioneIncassata = totaleLordoCent > 0 ? Math.min(1, incassatoCent / totaleLordoCent) : 0;
    const dataRif = conclusa ? (riga.data_rogito || riga.data_pratica) : riga.data_pratica;

    const quote = (quotePerPratica.get(riga.id) || []).slice().sort((a, b) => a.collaboratore_id - b.collaboratore_id);
    const quoteEffettive = quote.length ? quote : [{ collaboratore_id: null, percentuale: 100 }];
    const importi = attribuisci(compensoTotaleCent, quoteEffettive);
    const voci = quoteEffettive.map((q, i) => ({
      praticaId: riga.id,
      collaboratoreId: q.collaboratore_id,
      quotaPct: q.percentuale,
      fatturatoCent: importi[i],
      provvigioneCent: 0,
      maturataCent: 0,
      liquidataCent: 0,
      daLiquidareCent: 0,
      cumuloChiave: null,
      scaglioneIdx: -1,
      percentualeApplicata: 0,
    }));

    const sommaQuote = quote.reduce((s, q) => s + Math.round(q.percentuale * 100), 0);
    const mancanti = [];
    if (riga.zona_id == null) mancanti.push('zona');
    if (conclusa) {
      if (!riga.data_rogito) mancanti.push('data_rogito');
      if (!riga.prezzo_vendita_cent) mancanti.push('prezzo_vendita');
      if (compensoTotaleCent <= 0) mancanti.push('compensi');
      if (!quote.length) mancanti.push('ripartizione');
    }
    if (quote.length && sommaQuote !== 10000) mancanti.push('ripartizione_somma');

    const p = {
      ...riga,
      conclusa, inCorso, annullata,
      zonaNome: riga.zona_id != null ? (zonaPerId.get(riga.zona_id)?.nome ?? null) : null,
      compensoTotaleCent, ivaCent, totaleLordoCent,
      incassatoCent, daIncassareCent, frazioneIncassata,
      dataRif,
      meseRif: chiaveMese(dataRif),
      voci,
      quoteDefinite: quote.length > 0,
      provvigioniCent: 0, maturateCent: 0, liquidateCent: 0, daLiquidareCent: 0,
      mancanti: mancanti.map((codice) => ({ codice, testo: ETICHETTE_MANCANTI[codice] })),
      incompleta: mancanti.length > 0,
    };
    out.push(p);
    perId.set(p.id, p);
    tutteLeVoci.push(...voci);
  }

  // --- 2) cumulo mensile e provvigioni (solo pratiche concluse)
  const gruppi = new Map();
  for (const p of out) {
    if (!p.conclusa) continue;
    for (const v of p.voci) {
      const zonaId = opz.baseCumulo === 'collaboratore' ? null : (p.zona_id ?? null);
      const collabId = opz.baseCumulo === 'zona' ? null : v.collaboratoreId;
      const chiave = `${p.meseRif}|z${zonaId ?? 0}|c${collabId ?? 0}`;
      if (!gruppi.has(chiave)) {
        gruppi.set(chiave, { chiave, mese: p.meseRif, zonaId, collaboratoreId: collabId, voci: [] });
      }
      gruppi.get(chiave).voci.push({ v, p });
      v.cumuloChiave = chiave;
    }
  }

  const cumuli = [];
  for (const g of gruppi.values()) {
    g.voci.sort((a, b) =>
      (a.p.dataRif < b.p.dataRif ? -1 : a.p.dataRif > b.p.dataRif ? 1 : 0) ||
      a.p.id - b.p.id || (a.v.collaboratoreId ?? 0) - (b.v.collaboratoreId ?? 0));
    const tabella = tabellaPer(g.zonaId);
    const voci = g.voci.map((x) => x.v);
    const fatturatoCent = distribuisciProvvigione(voci, tabella, opz.metodo);
    const idx = indiceScaglione(tabella, fatturatoCent);
    // Una quota non assegnata a nessun collaboratore fa numero per lo scaglione ma non genera provvigione.
    for (const v of voci) if (v.collaboratoreId == null) v.provvigioneCent = 0;
    const provvigioneCent = voci.reduce((s, v) => s + v.provvigioneCent, 0);
    const percentuale = opz.metodo === 'progressivo'
      ? (fatturatoCent > 0 ? (provvigioneCent / fatturatoCent) * 100 : 0)
      : percentualeRaggiunta(tabella, fatturatoCent);
    for (const v of voci) {
      v.scaglioneIdx = idx;
      v.percentualeApplicata = percentuale;
    }
    const descrizione = descriviScaglioni(tabella);
    cumuli.push({
      chiave: g.chiave,
      mese: g.mese,
      zonaId: g.zonaId,
      zonaNome: g.zonaId != null ? (zonaPerId.get(g.zonaId)?.nome ?? null) : null,
      collaboratoreId: g.collaboratoreId,
      collaboratoreNome: g.collaboratoreId != null ? (collabPerId.get(g.collaboratoreId)?.nome ?? null) : null,
      fatturatoCent,
      scaglioneIdx: idx,
      scaglione: idx >= 0 ? descrizione[idx] : null,
      percentuale,
      provvigioneCent,
      prossimo: prossimoScaglione(tabella, fatturatoCent),
      tabella,
      tabellaConfigurata: tabella.length > 0,
      praticheIds: [...new Set(g.voci.map((x) => x.p.id))],
      voci,
    });
  }
  cumuli.sort((a, b) => a.mese.localeCompare(b.mese) || (a.zonaNome || '').localeCompare(b.zonaNome || '', 'it') || (a.collaboratoreNome || '').localeCompare(b.collaboratoreNome || '', 'it'));

  // --- 3) maturato / liquidato / da liquidare per voce e per pratica
  for (const p of out) {
    for (const v of p.voci) {
      if (p.conclusa) {
        v.maturataCent = opz.maturazione === 'incasso'
          ? (p.totaleLordoCent > 0 ? Math.min(v.provvigioneCent, arrotonda(v.provvigioneCent * Math.min(p.incassatoCent, p.totaleLordoCent), p.totaleLordoCent)) : 0)
          : v.provvigioneCent;
      }
      v.liquidataCent = v.collaboratoreId != null ? (liquidatoPerVoce.get(`${p.id}|${v.collaboratoreId}`) || 0) : 0;
      v.daLiquidareCent = v.maturataCent - v.liquidataCent;
      p.provvigioniCent += v.provvigioneCent;
      p.maturateCent += v.maturataCent;
      p.liquidateCent += v.liquidataCent;
      p.daLiquidareCent += v.daLiquidareCent;
    }
  }

  // --- 4) riepiloghi per collaboratore e per zona (tutto lo storico)
  const riepCollab = new Map(collaboratori.map((c) => [c.id, {
    id: c.id, nome: c.nome, colore: c.colore, attivo: !!c.attivo,
    fatturatoCent: 0, maturateCent: 0, liquidateCent: 0, daLiquidareCent: 0, pratiche: 0,
  }]));
  const riepZona = new Map(zone.map((z) => [z.id, {
    id: z.id, nome: z.nome, colore: z.colore, attiva: !!z.attiva,
    fatturatoCent: 0, provvigioniCent: 0, pratiche: 0,
  }]));
  for (const p of out) {
    const z = p.zona_id != null ? riepZona.get(p.zona_id) : null;
    if (z && p.conclusa) { z.fatturatoCent += p.compensoTotaleCent; z.pratiche += 1; z.provvigioniCent += p.provvigioniCent; }
    for (const v of p.voci) {
      const c = v.collaboratoreId != null ? riepCollab.get(v.collaboratoreId) : null;
      if (!c) continue;
      if (p.conclusa) { c.fatturatoCent += v.fatturatoCent; c.pratiche += 1; }
      c.maturateCent += v.maturataCent;
      c.liquidateCent += v.liquidataCent;
      c.daLiquidareCent += v.daLiquidareCent;
    }
  }

  // --- 5) estremi temporali dei dati
  let da = null, a = null;
  for (const p of out) {
    if (!p.dataRif) continue;
    if (da === null || p.dataRif < da) da = p.dataRif;
    if (a === null || p.dataRif > a) a = p.dataRif;
  }

  const erroriTabelle = [];
  if (tabellaPredefinita.length) {
    for (const t of controllaTabella(tabellaPredefinita)) erroriTabelle.push({ zonaId: null, testo: t });
  }
  for (const [zid, t] of tabellePerZona) {
    for (const testo of controllaTabella(t)) erroriTabelle.push({ zonaId: zid, testo });
  }

  const incassi = (dati.incassi || []).map((i) => ({ ...i, pratica: perId.get(i.pratica_id) || null }));
  const righePerLiquidazione = new Map();
  for (const r of dati.righe || []) {
    if (!righePerLiquidazione.has(r.liquidazione_id)) righePerLiquidazione.set(r.liquidazione_id, []);
    righePerLiquidazione.get(r.liquidazione_id).push({ ...r, pratica: perId.get(r.pratica_id) || null });
  }
  const liquidazioni = (dati.liquidazioni || []).map((l) => {
    const righe = righePerLiquidazione.get(l.id) || [];
    return {
      ...l,
      collaboratoreNome: collabPerId.get(l.collaboratore_id)?.nome ?? null,
      righe,
      totaleCent: righe.reduce((s, r) => s + r.importo_cent, 0),
    };
  });

  return {
    opzioni: opz,
    pratiche: out,
    perId,
    voci: tutteLeVoci,
    incassi,
    liquidazioni,
    cumuli,
    collaboratori: [...riepCollab.values()],
    zone: [...riepZona.values()],
    tabellaPredefinita,
    tabellePerZona,
    tabellaPer,
    erroriTabelle,
    limiti: { da, a },
  };
}
