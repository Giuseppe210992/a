// Tabelle a scaglioni (soglie di fatturato mensile -> percentuale di provvigione).
//
// Una tabella e' un elenco ordinato di { da, percentuale }:
//   da           soglia inferiore dello scaglione, in centesimi (la prima e' sempre 0)
//   percentuale  percentuale di provvigione riconosciuta (es. 35 = 35%)
// Uno scaglione vale da "da" (incluso) fino alla soglia dello scaglione successivo (escluso):
// raggiungere esattamente la soglia significa essere gia' nello scaglione superiore.
//
// Due modi di applicare le percentuali (impostazione "Metodo di calcolo"):
//   'raggiunto'    la percentuale dello scaglione raggiunto si applica a TUTTO il fatturato del mese
//   'progressivo'  ogni percentuale si applica solo alla parte di fatturato che cade nel suo scaglione
//
// Tutta l'aritmetica e' intera (centesimi e punti base) per evitare errori di arrotondamento.

/** Divisione con arrotondamento all'intero piu' vicino (mezzi verso l'alto), solo con interi. */
export function arrotonda(numeratore, denominatore) {
  return Math.floor((2 * numeratore + denominatore) / (2 * denominatore));
}

/** Percentuale -> punti base interi (35,25% -> 3525). */
export function puntiBase(percentuale) {
  return Math.round(percentuale * 100);
}

/** Converte righe del database ({da_cent, percentuale}) in una tabella ordinata. */
export function creaTabella(righe) {
  return (righe || [])
    .map((r) => ({ da: r.da_cent ?? r.da, percentuale: Number(r.percentuale) }))
    .sort((a, b) => a.da - b.da);
}

/** Controlla una tabella e restituisce l'elenco dei problemi (vuoto se e' valida). */
export function controllaTabella(tabella) {
  const problemi = [];
  if (!tabella.length) {
    problemi.push('La tabella non contiene nessuno scaglione.');
    return problemi;
  }
  if (tabella[0].da !== 0) problemi.push('Il primo scaglione deve partire da 0,00 €.');
  for (let i = 0; i < tabella.length; i++) {
    const s = tabella[i];
    if (!Number.isInteger(s.da) || s.da < 0) problemi.push(`Scaglione ${i + 1}: la soglia non è valida.`);
    if (!Number.isFinite(s.percentuale) || s.percentuale < 0 || s.percentuale > 100) {
      problemi.push(`Scaglione ${i + 1}: la percentuale deve essere tra 0 e 100.`);
    }
    if (i > 0 && s.da <= tabella[i - 1].da) {
      problemi.push(`Scaglione ${i + 1}: la soglia deve essere maggiore di quella precedente.`);
    }
  }
  return problemi;
}

/** Indice dello scaglione raggiunto con il cumulo dato (-1 se la tabella e' vuota). */
export function indiceScaglione(tabella, cumuloCent) {
  let idx = -1;
  for (let i = 0; i < tabella.length; i++) {
    if (cumuloCent >= tabella[i].da) idx = i;
    else break;
  }
  return idx;
}

export function percentualeRaggiunta(tabella, cumuloCent) {
  const i = indiceScaglione(tabella, cumuloCent);
  return i < 0 ? 0 : tabella[i].percentuale;
}

/**
 * Provvigione totale (in centesimi, arrotondata) dovuta su un cumulo di fatturato.
 * metodo: 'raggiunto' | 'progressivo'
 */
export function provvigioneSuCumulo(tabella, cumuloCent, metodo = 'raggiunto') {
  if (!tabella.length || cumuloCent <= 0) return 0;
  if (metodo === 'progressivo') {
    let somma = 0; // centesimi x punti base
    for (let i = 0; i < tabella.length; i++) {
      const basso = tabella[i].da;
      const alto = i + 1 < tabella.length ? tabella[i + 1].da : Infinity;
      if (cumuloCent <= basso) break;
      somma += (Math.min(cumuloCent, alto) - basso) * puntiBase(tabella[i].percentuale);
    }
    return arrotonda(somma, 10000);
  }
  return arrotonda(cumuloCent * puntiBase(percentualeRaggiunta(tabella, cumuloCent)), 10000);
}

/** Descrive il prossimo scaglione da raggiungere, o null se si e' gia' all'ultimo. */
export function prossimoScaglione(tabella, cumuloCent) {
  const i = indiceScaglione(tabella, cumuloCent);
  const successivo = i + 1;
  if (successivo >= tabella.length || (i < 0 && !tabella.length)) return null;
  return {
    indice: successivo,
    da: tabella[successivo].da,
    percentuale: tabella[successivo].percentuale,
    mancanteCent: tabella[successivo].da - cumuloCent,
  };
}

/** Elenco per la visualizzazione: [{ indice, da, a (fine inclusa, null = senza limite), percentuale }] */
export function descriviScaglioni(tabella) {
  return tabella.map((s, i) => ({
    indice: i,
    da: s.da,
    a: i + 1 < tabella.length ? tabella[i + 1].da - 1 : null,
    percentuale: s.percentuale,
  }));
}

/**
 * Distribuisce la provvigione di un gruppo (cumulo mensile) sulle singole voci.
 * Le voci devono arrivare in ordine cronologico; ciascuna deve avere fatturatoCent.
 * Il metodo "a differenza di cumulo" garantisce che la somma delle singole provvigioni
 * coincida esattamente con la provvigione totale del gruppo.
 * Imposta su ogni voce: provvigioneCent.
 */
export function distribuisciProvvigione(voci, tabella, metodo = 'raggiunto') {
  const totale = voci.reduce((s, v) => s + v.fatturatoCent, 0);
  const pctFinale = puntiBase(percentualeRaggiunta(tabella, totale));
  let cumulo = 0;
  let precedente = 0;
  for (const v of voci) {
    cumulo += v.fatturatoCent;
    const dovuta = metodo === 'progressivo'
      ? provvigioneSuCumulo(tabella, cumulo, 'progressivo')
      : arrotonda(cumulo * pctFinale, 10000);
    v.provvigioneCent = dovuta - precedente;
    precedente = dovuta;
  }
  return totale;
}
