// Aggregazioni sul modello: riquadri della dashboard, serie dei grafici, riepiloghi.
// Contesto di filtro (ctx): { periodo: { da, a }, zonaId: numero|null, collaboratoreId: numero|null }
//
// Regole (valgono per tutte le schermate, cosi' i numeri concordano sempre):
//  - una pratica conclusa conta nel periodo della sua data di rogito;
//  - "pratiche in corso" e' una fotografia di oggi (non dipende dal periodo);
//  - con un collaboratore selezionato si contano le sue quote (compensi e provvigioni),
//    mentre il numero di pratiche e il valore degli immobili sono quelli delle pratiche a cui partecipa.

import {
  aggiungiMesi, anniTra, fineMese, giorniTra, inizioMese, chiaveMese, mesiTra,
} from '../../core/dates.js';
import { meseAnno, meseBreve } from '../../core/format.js';

function nelContesto(p, ctx) {
  if (ctx.zonaId != null && p.zona_id !== ctx.zonaId) return false;
  if (ctx.collaboratoreId != null && !p.voci.some((v) => v.collaboratoreId === ctx.collaboratoreId)) return false;
  return true;
}

function nelPeriodo(p, periodo) {
  return !!p.dataRif && p.dataRif >= periodo.da && p.dataRif <= periodo.a;
}

export function vociDi(p, ctx) {
  return ctx.collaboratoreId == null ? p.voci : p.voci.filter((v) => v.collaboratoreId === ctx.collaboratoreId);
}

/** Pratiche concluse che rientrano nel periodo e nei filtri. */
export function concluseNelContesto(modello, ctx) {
  return modello.pratiche.filter((p) => p.conclusa && nelPeriodo(p, ctx.periodo) && nelContesto(p, ctx));
}

export function inCorsoNelContesto(modello, ctx) {
  return modello.pratiche.filter((p) => p.inCorso && nelContesto(p, ctx));
}

export function riepilogo(modello, ctx) {
  const concluse = concluseNelContesto(modello, ctx);
  const r = {
    concluse: concluse.length,
    compensiCent: 0,
    incassatoCent: 0,
    provvigioniCent: 0,
    maturateCent: 0,
    liquidateCent: 0,
    daLiquidareCent: 0,
    valoreVendutoCent: 0,
    inCorso: inCorsoNelContesto(modello, ctx).length,
  };
  for (const p of concluse) {
    r.valoreVendutoCent += p.prezzo_vendita_cent || 0;
    for (const v of vociDi(p, ctx)) {
      r.compensiCent += v.fatturatoCent;
      r.incassatoCent += Math.round((p.incassatoCent * v.quotaPct) / 100);
      r.provvigioniCent += v.provvigioneCent;
      r.maturateCent += v.maturataCent;
      r.liquidateCent += v.liquidataCent;
      r.daLiquidareCent += v.daLiquidareCent;
    }
  }
  return r;
}

/** Variazione percentuale tra due valori; null se il confronto non ha senso. */
export function variazionePct(attuale, precedente) {
  if (precedente === null || precedente === undefined || precedente === 0) return null;
  return ((attuale - precedente) / Math.abs(precedente)) * 100;
}

// ------------------------------------------------------------ serie temporali

/** Finestra di intervalli (mesi o anni) mostrata dai grafici per un periodo. */
export function finestraTemporale(periodo, granularita = 'mensile') {
  if (granularita === 'annuale') {
    const annoA = +periodo.a.slice(0, 4);
    const annoDa = Math.min(+periodo.da.slice(0, 4), annoA - 2);
    return anniTra(Math.max(annoDa, annoA - 15), annoA).map((y) => ({
      chiave: String(y), etichetta: String(y), etichettaLunga: `Anno ${y}`,
      da: `${y}-01-01`, a: `${y}-12-31`,
    }));
  }
  const fine = chiaveMese(periodo.a);
  let inizio = chiaveMese(periodo.da);
  // Un solo mese darebbe un grafico con una barra: si mostra almeno un anno di contesto.
  if (mesiTra(inizio, fine).length < 12) inizio = aggiungiMesi(fine, -11);
  let mesi = mesiTra(inizio, fine);
  if (mesi.length > 60) mesi = mesi.slice(-60);
  return mesi.map((k) => ({
    chiave: k, etichetta: meseBreve(k), etichettaLunga: meseAnno(k),
    da: inizioMese(k), a: fineMese(k),
  }));
}

const METRICHE_VOCE = {
  compensi: (p, v) => v.fatturatoCent,
  provvigioni: (p, v) => v.maturataCent,
  provvigioniCalcolate: (p, v) => v.provvigioneCent,
  liquidate: (p, v) => v.liquidataCent,
  margine: (p, v) => v.fatturatoCent - v.provvigioneCent,
  valore: (p, v, primo) => (primo ? (p.prezzo_vendita_cent || 0) : 0),
  concluse: (p, v, primo) => (primo ? 1 : 0),
};

export const METRICHE_DISPONIBILI = Object.keys(METRICHE_VOCE).concat(['incassi']);

/**
 * Serie temporale per i grafici.
 * opzioni: { granularita: 'mensile'|'annuale', metrica, per: null|'collaboratore'|'zona' }
 * Restituisce { granularita, intervalli: [{ chiave, etichetta, etichettaLunga, da, a, inPeriodo }],
 *               serie: [{ id, nome, colore, valori: [] , totale }] }
 * Gli intervalli fuori dal periodo scelto sono dati di contesto (inPeriodo = false).
 */
export function serieTemporale(modello, ctx, opzioni = {}) {
  const { granularita = 'mensile', metrica = 'compensi', per = null } = opzioni;
  const finestra = finestraTemporale(ctx.periodo, granularita);
  const intervalli = finestra.map((b) => ({
    ...b,
    inPeriodo: b.a >= ctx.periodo.da && b.da <= ctx.periodo.a,
  }));
  const indice = new Map(intervalli.map((b, i) => [b.chiave, i]));
  const chiaveDi = (iso) => (granularita === 'annuale' ? iso.slice(0, 4) : iso.slice(0, 7));

  // Decide se una data conta: dentro un intervallo del periodo vale solo la parte nel periodo.
  const conta = (iso) => {
    const i = indice.get(chiaveDi(iso));
    if (i === undefined) return -1;
    if (intervalli[i].inPeriodo && (iso < ctx.periodo.da || iso > ctx.periodo.a)) return -1;
    return i;
  };

  const serie = new Map();
  const assicuraSerie = (id, nome, colore) => {
    if (!serie.has(id)) serie.set(id, { id, nome, colore, valori: intervalli.map(() => 0), totale: 0 });
    return serie.get(id);
  };
  const nomeCollab = new Map(modello.collaboratori.map((c) => [c.id, c]));
  const nomeZona = new Map(modello.zone.map((z) => [z.id, z]));

  const identita = (p, v) => {
    if (per === 'collaboratore') {
      const c = nomeCollab.get(v.collaboratoreId);
      return c ? { id: `c${c.id}`, nome: c.nome, colore: c.colore } : { id: 'c0', nome: 'Non assegnato', colore: 0 };
    }
    if (per === 'zona') {
      const z = nomeZona.get(p.zona_id);
      return z ? { id: `z${z.id}`, nome: z.nome, colore: z.colore } : { id: 'z0', nome: 'Senza zona', colore: 0 };
    }
    return { id: 'tot', nome: 'Totale', colore: 1 };
  };

  if (metrica === 'incassi') {
    // incassi registrati + pagamenti fatti dalle parti alla conclusione (nel giorno della pratica)
    for (const inc of [...modello.incassi, ...(modello.pagamenti || [])]) {
      const p = inc.pratica;
      if (!p || p.annullata || !nelContesto(p, ctx)) continue;
      const i = conta(inc.data);
      if (i < 0) continue;
      for (const v of vociDi(p, ctx)) {
        const id = identita(p, v);
        const s = assicuraSerie(id.id, id.nome, id.colore);
        const quota = Math.round((inc.importo_cent * v.quotaPct) / 100);
        s.valori[i] += quota;
        s.totale += quota;
      }
    }
  } else {
    const estrai = METRICHE_VOCE[metrica];
    for (const p of modello.pratiche) {
      if (!p.conclusa || !p.dataRif || !nelContesto(p, ctx)) continue;
      const i = conta(p.dataRif);
      if (i < 0) continue;
      const viste = new Set();
      vociDi(p, ctx).forEach((v) => {
        const id = identita(p, v);
        const primo = !viste.has(id.id);
        viste.add(id.id);
        const s = assicuraSerie(id.id, id.nome, id.colore);
        const val = estrai(p, v, primo);
        s.valori[i] += val;
        s.totale += val;
      });
    }
  }

  // Serie sempre presenti anche senza dati: collaboratori/zone attivi (per i confronti).
  if (per === 'collaboratore') {
    for (const c of modello.collaboratori) if (c.attivo || serie.has(`c${c.id}`)) assicuraSerie(`c${c.id}`, c.nome, c.colore);
  } else if (per === 'zona') {
    for (const z of modello.zone) if (z.attiva || serie.has(`z${z.id}`)) assicuraSerie(`z${z.id}`, z.nome, z.colore);
  } else {
    assicuraSerie('tot', 'Totale', 1);
  }

  const ordinate = [...serie.values()].sort((a, b) => {
    if (a.id === 'c0' || a.id === 'z0') return 1;
    if (b.id === 'c0' || b.id === 'z0') return -1;
    return (a.colore - b.colore) || a.nome.localeCompare(b.nome, 'it');
  });
  return { granularita, intervalli, serie: ordinate };
}

// ------------------------------------------------------------ riepiloghi per dimensione

export function perCollaboratore(modello, ctx) {
  const righe = new Map();
  for (const c of modello.collaboratori) {
    if (ctx.collaboratoreId != null && c.id !== ctx.collaboratoreId) continue;
    if (!c.attivo) continue;
    righe.set(c.id, {
      id: c.id, nome: c.nome, colore: c.colore,
      pratiche: 0, fatturatoCent: 0, provvigioniCent: 0, maturateCent: 0, liquidateCent: 0, daLiquidareCent: 0,
    });
  }
  for (const p of concluseNelContesto(modello, ctx)) {
    for (const v of vociDi(p, ctx)) {
      let r = righe.get(v.collaboratoreId);
      if (!r) {
        // Collaboratore non attivo ma con dati nel periodo: compare comunque.
        const c = modello.collaboratori.find((x) => x.id === v.collaboratoreId);
        if (!c) continue;
        r = { id: c.id, nome: c.nome, colore: c.colore, pratiche: 0, fatturatoCent: 0, provvigioniCent: 0, maturateCent: 0, liquidateCent: 0, daLiquidareCent: 0 };
        righe.set(c.id, r);
      }
      r.pratiche += 1;
      r.fatturatoCent += v.fatturatoCent;
      r.provvigioniCent += v.provvigioneCent;
      r.maturateCent += v.maturataCent;
      r.liquidateCent += v.liquidataCent;
      r.daLiquidareCent += v.daLiquidareCent;
    }
  }
  return [...righe.values()].sort((a, b) => a.colore - b.colore || a.nome.localeCompare(b.nome, 'it'));
}

export function perZona(modello, ctx) {
  const righe = new Map();
  for (const z of modello.zone) {
    if (ctx.zonaId != null && z.id !== ctx.zonaId) continue;
    if (!z.attiva) continue;
    righe.set(z.id, { id: z.id, nome: z.nome, colore: z.colore, pratiche: 0, fatturatoCent: 0, provvigioniCent: 0, valoreCent: 0 });
  }
  for (const p of concluseNelContesto(modello, ctx)) {
    const id = p.zona_id ?? 0;
    let r = righe.get(id);
    if (!r) {
      const z = modello.zone.find((x) => x.id === id);
      r = { id, nome: z ? z.nome : 'Senza zona', colore: z ? z.colore : 0, pratiche: 0, fatturatoCent: 0, provvigioniCent: 0, valoreCent: 0 };
      righe.set(id, r);
    }
    r.pratiche += 1;
    r.valoreCent += p.prezzo_vendita_cent || 0;
    for (const v of vociDi(p, ctx)) {
      r.fatturatoCent += v.fatturatoCent;
      r.provvigioniCent += v.provvigioneCent;
    }
  }
  return [...righe.values()].sort((a, b) => (a.id === 0) - (b.id === 0) || b.fatturatoCent - a.fatturatoCent);
}

/** Confronto prezzo di acquisto / prezzo di vendita, solo per le pratiche che hanno entrambi. */
export function confrontoPrezzi(modello, ctx, limite = 8) {
  const tutte = concluseNelContesto(modello, ctx)
    .filter((p) => p.prezzo_acquisto_cent > 0 && p.prezzo_vendita_cent > 0)
    .sort((a, b) => (b.dataRif < a.dataRif ? -1 : b.dataRif > a.dataRif ? 1 : b.id - a.id));
  const righe = tutte.map((p) => ({
    pratica: p,
    acquistoCent: p.prezzo_acquisto_cent,
    venditaCent: p.prezzo_vendita_cent,
    deltaCent: p.prezzo_vendita_cent - p.prezzo_acquisto_cent,
    deltaPct: ((p.prezzo_vendita_cent - p.prezzo_acquisto_cent) / p.prezzo_acquisto_cent) * 100,
  }));
  const somma = righe.reduce((s, r) => s + r.deltaPct, 0);
  return {
    righe: righe.slice(0, limite),
    totale: righe.length,
    mediaDeltaPct: righe.length ? somma / righe.length : null,
    mancanti: concluseNelContesto(modello, ctx).length - righe.length,
  };
}

/** Indicatori medi del periodo (per la pagina Statistiche). */
export function indicatori(modello, ctx) {
  const concluse = concluseNelContesto(modello, ctx);
  let giorni = 0, conGiorni = 0, valore = 0, conValore = 0, compensi = 0;
  for (const p of concluse) {
    if (p.data_rogito && p.data_pratica && p.data_rogito >= p.data_pratica) {
      giorni += giorniTra(p.data_pratica, p.data_rogito);
      conGiorni += 1;
    }
    if (p.prezzo_vendita_cent > 0) { valore += p.prezzo_vendita_cent; conValore += 1; compensi += p.compensoTotaleCent; }
  }
  return {
    giorniMediChiusura: conGiorni ? giorni / conGiorni : null,
    prezzoMedioCent: conValore ? Math.round(valore / conValore) : null,
    compensoMedioCent: concluse.length ? Math.round(concluse.reduce((s, p) => s + p.compensoTotaleCent, 0) / concluse.length) : null,
    incidenzaCompensoPct: valore > 0 ? (compensi / valore) * 100 : null,
  };
}

/** Distribuzione per tipologia di immobile (pratiche concluse del periodo). */
export function perTipologia(modello, ctx) {
  const m = new Map();
  for (const p of concluseNelContesto(modello, ctx)) {
    const t = p.immobile_tipo || 'Non indicata';
    const r = m.get(t) || { nome: t, pratiche: 0, compensiCent: 0, valoreCent: 0 };
    r.pratiche += 1;
    r.compensiCent += p.compensoTotaleCent;
    r.valoreCent += p.prezzo_vendita_cent || 0;
    m.set(t, r);
  }
  return [...m.values()].sort((a, b) => b.pratiche - a.pratiche || b.compensiCent - a.compensiCent);
}

export function ultimePratiche(modello, ctx, limite = 8) {
  return modello.pratiche
    .filter((p) => nelContesto(p, ctx))
    .sort((a, b) => (b.aggiornato_il < a.aggiornato_il ? -1 : b.aggiornato_il > a.aggiornato_il ? 1 : b.id - a.id))
    .slice(0, limite);
}

/**
 * Cumulo mensile organizzato per zona: per ogni zona attiva (e per ogni collaboratore attivo)
 * una riga, anche se nel mese non c'e' ancora fatturato, cosi' si vede quanto manca allo scaglione.
 */
export function cumuloDelMese(modello, mese, filtri = {}) {
  const base = modello.opzioni.baseCumulo;
  const esistenti = modello.cumuli.filter((c) => c.mese === mese);
  const perChiave = new Map(esistenti.map((c) => [`${c.zonaId ?? 0}|${c.collaboratoreId ?? 0}`, c]));
  const collaboratoriAttivi = modello.collaboratori.filter((c) => c.attivo || esistenti.some((e) => e.collaboratoreId === c.id));
  const zoneAttive = modello.zone.filter((z) => z.attiva || esistenti.some((e) => e.zonaId === z.id));

  const gruppi = [];
  const costruisciRiga = (zonaId, collabId) => {
    const trovato = perChiave.get(`${zonaId ?? 0}|${collabId ?? 0}`);
    if (trovato) return trovato;
    const tabella = modello.tabellaPer(zonaId);
    const zona = zonaId != null ? modello.zone.find((z) => z.id === zonaId) : null;
    const collab = collabId != null ? modello.collaboratori.find((c) => c.id === collabId) : null;
    const idx = tabella.length ? 0 : -1;
    return {
      chiave: `${mese}|z${zonaId ?? 0}|c${collabId ?? 0}`,
      mese, zonaId, zonaNome: zona ? zona.nome : null,
      collaboratoreId: collabId, collaboratoreNome: collab ? collab.nome : null,
      fatturatoCent: 0, scaglioneIdx: idx,
      scaglione: tabella.length ? { indice: 0, da: tabella[0].da, a: tabella[1] ? tabella[1].da - 1 : null, percentuale: tabella[0].percentuale } : null,
      percentuale: tabella.length ? tabella[0].percentuale : 0,
      provvigioneCent: 0,
      prossimo: tabella.length > 1 ? { indice: 1, da: tabella[1].da, percentuale: tabella[1].percentuale, mancanteCent: tabella[1].da } : null,
      tabella, tabellaConfigurata: tabella.length > 0, praticheIds: [], voci: [],
    };
  };

  if (base === 'collaboratore') {
    const righe = collaboratoriAttivi
      .filter((c) => filtri.collaboratoreId == null || c.id === filtri.collaboratoreId)
      .map((c) => costruisciRiga(null, c.id));
    gruppi.push({ zonaId: null, zonaNome: 'Tutte le zone', righe });
  } else {
    for (const z of zoneAttive) {
      if (filtri.zonaId != null && z.id !== filtri.zonaId) continue;
      const righe = base === 'zona'
        ? [costruisciRiga(z.id, null)]
        : collaboratoriAttivi
          .filter((c) => filtri.collaboratoreId == null || c.id === filtri.collaboratoreId)
          .map((c) => costruisciRiga(z.id, c.id));
      gruppi.push({ zonaId: z.id, zonaNome: z.nome, righe });
    }
    // Pratiche del mese senza zona.
    const senzaZona = esistenti.filter((c) => c.zonaId == null && (filtri.collaboratoreId == null || c.collaboratoreId === filtri.collaboratoreId));
    if (senzaZona.length && filtri.zonaId == null) gruppi.push({ zonaId: null, zonaNome: 'Senza zona', righe: senzaZona });
  }
  return gruppi;
}
