// Motore di calcolo: da dati grezzi (righe del database) al "modello" derivato che usano
// tutte le schermate: importi per pratica, ripartizione tra collaboratori, cumulo mensile,
// scaglioni raggiunti, provvigioni maturate / liquidate / da liquidare.
//
// Sono funzioni pure: stessi dati in ingresso -> stesso risultato, senza accedere al database.
// Importi sempre in centesimi interi.

import { chiaveMese } from '../../core/dates.js';
import { dataIt, meseAnno } from '../../core/format.js';
import {
  arrotonda, creaTabella, controllaTabella, indiceScaglione, percentualeRaggiunta,
  prossimoScaglione, descriviScaglioni, distribuisciProvvigione,
} from './scaglioni.js';
import { calcolaCompensi, PARTI, MODALITA } from './compensi.js';

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
  const ripartizionePerZona = new Map();
  for (const q of dati.zone_quote || []) {
    if (!ripartizionePerZona.has(q.zona_id)) ripartizionePerZona.set(q.zona_id, []);
    ripartizionePerZona.get(q.zona_id).push({ collaboratoreId: q.collaboratore_id, percentuale: q.percentuale });
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
    // Compensi: dai pagamenti delle parti (contanti, bonifico e assegno: tutti con IVA compresa) oppure, per le
    // pratiche vecchie, dal solo compenso senza IVA con l'IVA in cima. Quanto le parti hanno pagato alla
    // conclusione conta come già incassato; gli incassi registrati dopo si sommano.
    const compensi = calcolaCompensi(riga);
    const compensoTotaleCent = compensi.imponibileCent;
    const ivaCent = compensi.ivaCent;
    const totaleLordoCent = compensi.totaleCent;
    const pagatoAllaConclusioneCent = compensi.pagatoCent;
    const incassatoCent = pagatoAllaConclusioneCent + (incassatoPerPratica.get(riga.id) || 0);
    const daIncassareCent = Math.max(0, totaleLordoCent - incassatoCent);
    const frazioneIncassata = totaleLordoCent > 0 ? Math.min(1, incassatoCent / totaleLordoCent) : 0;
    // Giorno di riferimento: per le pratiche con il mese della proposta conta quel mese (si usa il suo primo giorno),
    // da cui dipendono il cumulo mensile, i periodi e i grafici; per le vecchie conta il rogito.
    const meseProposta = riga.mese_proposta || null;
    const dataRif = meseProposta ? `${meseProposta}-01` : (conclusa ? (riga.data_rogito || riga.data_pratica) : riga.data_pratica);

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

    const zonaNome = riga.zona_id != null ? (zonaPerId.get(riga.zona_id)?.nome ?? null) : null;
    const p = {
      ...riga,
      compenso_venditore_cent: compensi.venditore.imponibileCent,
      compenso_acquirente_cent: compensi.acquirente.imponibileCent,
      conclusa, inCorso, annullata,
      zonaNome,
      // come chiamare la pratica a parole: l'immobile se è stato scritto (pratiche vecchie), altrimenti la zona
      descrizione: riga.immobile_indirizzo || (zonaNome ? `Zona ${zonaNome}` : 'Zona non indicata'),
      compensi, pagatoAllaConclusioneCent,
      compensoTotaleCent, ivaCent, totaleLordoCent,
      incassatoCent, daIncassareCent, frazioneIncassata,
      dataRif,
      meseRif: chiaveMese(dataRif),
      meseProposta,
      // la data come si scrive nelle tabelle: «settembre 2026» se c'è il mese della proposta, altrimenti il giorno
      dataEtichetta: meseProposta ? meseAnno(meseProposta) : dataIt(dataRif),
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
  // Si cumulano i COMPENSI INTERI delle pratiche (non le metà): la percentuale dello scaglione si calcola sul compenso totale della
  // pratica (senza IVA), da lì si ricava la provvigione totale e solo alla fine questa si divide tra i collaboratori in base
  // alle loro quote. Pratiche condivise dagli stessi collaboratori, nella stessa zona e nello stesso mese, fanno un solo cumulo
  // («Luca + Giuseppe»); quelle di un solo collaboratore fanno il suo cumulo, come prima.
  const gruppi = new Map();
  for (const p of out) {
    if (!p.conclusa) continue;
    const ids = [...new Set(p.voci.map((v) => v.collaboratoreId).filter((id) => id != null))].sort((a, b) => a - b);
    const zonaId = opz.baseCumulo === 'collaboratore' ? null : (p.zona_id ?? null);
    const collaboratoriIds = opz.baseCumulo === 'zona' ? [] : ids;
    const firma = collaboratoriIds.length ? collaboratoriIds.join('+') : '0';
    const chiave = `${p.meseRif}|z${zonaId ?? 0}|c${firma}`;
    if (!gruppi.has(chiave)) gruppi.set(chiave, { chiave, mese: p.meseRif, zonaId, collaboratoriIds, firma, pratiche: [] });
    gruppi.get(chiave).pratiche.push(p);
    for (const v of p.voci) v.cumuloChiave = chiave;
  }

  const cumuli = [];
  for (const g of gruppi.values()) {
    g.pratiche.sort((a, b) => (a.dataRif < b.dataRif ? -1 : a.dataRif > b.dataRif ? 1 : 0) || a.id - b.id);
    const tabella = tabellaPer(g.zonaId);
    // una voce per pratica, con il compenso intero: ne esce la provvigione totale di ciascuna pratica
    const perPratica = g.pratiche.map((p) => ({ fatturatoCent: p.compensoTotaleCent, provvigioneCent: 0 }));
    const fatturatoCent = distribuisciProvvigione(perPratica, tabella, opz.metodo);
    const idx = indiceScaglione(tabella, fatturatoCent);
    const voci = [];
    g.pratiche.forEach((p, i) => {
      // la provvigione della pratica si divide tra i collaboratori in base alla quota (resto maggiore: la somma è esatta)
      const parti = attribuisci(perPratica[i].provvigioneCent, p.voci.map((v) => ({ percentuale: v.quotaPct })));
      p.voci.forEach((v, j) => { v.provvigioneCent = v.collaboratoreId == null ? 0 : parti[j]; }); // una quota non assegnata non genera provvigione
      voci.push(...p.voci);
    });
    const provvigioneCent = voci.reduce((s, v) => s + v.provvigioneCent, 0);
    const percentuale = opz.metodo === 'progressivo'
      ? (fatturatoCent > 0 ? (perPratica.reduce((s, x) => s + x.provvigioneCent, 0) / fatturatoCent) * 100 : 0)
      : percentualeRaggiunta(tabella, fatturatoCent);
    for (const v of voci) {
      v.scaglioneIdx = idx;
      v.percentualeApplicata = percentuale;
    }
    const descrizione = descriviScaglioni(tabella);
    const unico = g.collaboratoriIds.length === 1 ? g.collaboratoriIds[0] : null;
    cumuli.push({
      chiave: g.chiave,
      mese: g.mese,
      zonaId: g.zonaId,
      zonaNome: g.zonaId != null ? (zonaPerId.get(g.zonaId)?.nome ?? null) : null,
      collaboratoreId: unico,
      collaboratoriIds: g.collaboratoriIds,
      firma: g.firma,
      collaboratoreNome: g.collaboratoriIds.length ? g.collaboratoriIds.map((id) => collabPerId.get(id)?.nome ?? '?').join(' + ') : null,
      fatturatoCent,
      scaglioneIdx: idx,
      scaglione: idx >= 0 ? descrizione[idx] : null,
      percentuale,
      provvigioneCent,
      prossimo: prossimoScaglione(tabella, fatturatoCent),
      tabella,
      tabellaConfigurata: tabella.length > 0,
      praticheIds: g.pratiche.map((p) => p.id),
      voci,
    });
  }
  cumuli.sort((a, b) => a.mese.localeCompare(b.mese) || (a.zonaNome || '').localeCompare(b.zonaNome || '', 'it') || (a.collaboratoreNome || '').localeCompare(b.collaboratoreNome || '', 'it'));

  // --- 2b) chi prende una percentuale fissa (capo, segretaria): una percentuale del COMPENSO TOTALE (senza IVA) di ogni
  //         pratica conclusa, in qualsiasi zona e a prescindere da quanto prendono i collaboratori. Si somma a quanto spetta
  //         ai collaboratori (è un costo in più per l'agenzia). Ogni importo è arrotondato al centesimo pratica per pratica
  //         (mezzi verso l'alto).
  const fissi = collaboratori.filter((c) => Number(c.percentuale_fissa) > 0);
  if (fissi.length) {
    for (const p of out) {
      if (!p.conclusa) continue;
      const base = p.compensoTotaleCent;
      if (base <= 0) continue;
      for (const c of fissi) {
        const voce = {
          praticaId: p.id, collaboratoreId: c.id, fissa: true, quotaPct: 0, percentualeFissa: Number(c.percentuale_fissa),
          baseCent: base,
          fatturatoCent: 0,
          provvigioneCent: arrotonda(base * Math.round(Number(c.percentuale_fissa) * 100), 10000),
          maturataCent: 0, liquidataCent: 0, daLiquidareCent: 0,
          cumuloChiave: null, scaglioneIdx: -1, percentualeApplicata: Number(c.percentuale_fissa),
        };
        p.voci.push(voce);
        tutteLeVoci.push(voce);
      }
    }
  }

  // --- 3) maturato / liquidato / da liquidare per voce e per pratica
  for (const p of out) {
    for (const v of p.voci) {
      if (p.conclusa) {
        v.maturataCent = opz.maturazione === 'incasso'
          ? (p.totaleLordoCent > 0 ? Math.min(v.provvigioneCent, arrotonda(v.provvigioneCent * Math.min(p.incassatoCent, p.totaleLordoCent), p.totaleLordoCent)) : 0)
          : v.provvigioneCent;
      }
      // una volta inserita la pratica le provvigioni sono considerate già pagate: nessuna liquidazione da registrare
      v.liquidataCent = v.maturataCent;
      v.daLiquidareCent = 0;
      p.provvigioniCent += v.provvigioneCent;
      p.maturateCent += v.maturataCent;
      p.liquidateCent += v.liquidataCent;
      p.daLiquidareCent += v.daLiquidareCent;
    }
  }

  // --- 4) riepiloghi per collaboratore e per zona (tutto lo storico)
  const riepCollab = new Map(collaboratori.map((c) => [c.id, {
    id: c.id, nome: c.nome, colore: c.colore, attivo: !!c.attivo,
    percentualeFissa: Number(c.percentuale_fissa) > 0 ? Number(c.percentuale_fissa) : null,
    fatturatoCent: 0, maturateCent: 0, liquidateCent: 0, daLiquidareCent: 0, pratiche: 0,
  }]));
  const riepZona = new Map(zone.map((z) => [z.id, {
    id: z.id, nome: z.nome, colore: z.colore, attiva: !!z.attiva,
    ripartizione: ripartizionePerZona.get(z.id) || [], // come si divide una pratica della zona (vuota = si usa la predefinita)
    fatturatoCent: 0, provvigioniCent: 0, pratiche: 0,
  }]));
  for (const p of out) {
    const z = p.zona_id != null ? riepZona.get(p.zona_id) : null;
    if (z && p.conclusa) { z.fatturatoCent += p.compensoTotaleCent; z.pratiche += 1; z.provvigioniCent += p.provvigioniCent; }
    for (const v of p.voci) {
      const c = v.collaboratoreId != null ? riepCollab.get(v.collaboratoreId) : null;
      if (!c) continue;
      if (p.conclusa && !v.fissa) { c.fatturatoCent += v.fatturatoCent; c.pratiche += 1; }
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
  // Pagamenti fatti dalle parti alla conclusione (contanti / bonifico / assegno), nel giorno della pratica.
  const pagamenti = [];
  for (const p of out) {
    if (!p.compensi.daPagamenti) continue;
    for (const parte of PARTI) {
      for (const modo of MODALITA) {
        const importoCent = p.compensi[parte.id][`${modo.id}Cent`];
        if (importoCent > 0) {
          pagamenti.push({
            praticaId: p.id, pratica: p, data: p.data_pratica, parte: parte.etichetta, parteId: parte.id,
            modalita: modo.etichetta, modalitaId: modo.id, conIva: modo.conIva, importo_cent: importoCent,
          });
        }
      }
    }
  }
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
    pagamenti,
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
