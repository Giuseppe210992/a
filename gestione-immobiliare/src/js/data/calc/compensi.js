// Compensi di una pratica: da quanto ha pagato ciascuna parte (venditore e acquirente) e come, al compenso
// senza IVA su cui si calcolano scaglioni e provvigioni.
//
//   contanti   l'importo è GIÀ senza IVA: entra così com'è.
//   bonifico   l'importo COMPRENDE l'IVA: l'IVA si toglie (scorporo) per ottenere il compenso senza IVA.
//   assegno    come il bonifico: IVA compresa.
//
// Per ogni parte l'IVA si scorpora una sola volta sulla somma di bonifico e assegno, arrotondando al
// centesimo più vicino (mezzi verso l'alto). Tutta l'aritmetica è intera, in centesimi.
//
// Le pratiche vecchie, inserite con il solo compenso senza IVA (compensi_da_pagamenti = 0), restano
// com'erano: l'IVA si aggiunge in cima al compenso e il totale è compenso + IVA.

import { arrotonda, puntiBase } from './scaglioni.js';

export const PARTI = Object.freeze([
  { id: 'venditore', etichetta: 'Venditore', dal: 'dal venditore' },
  { id: 'acquirente', etichetta: 'Acquirente', dal: 'dall\'acquirente' },
]);

export const MODALITA = Object.freeze([
  { id: 'contanti', etichetta: 'Contanti', etichettaPagante: 'Contanti', conIva: false, nota: 'già senza IVA' },
  { id: 'bonifico', etichetta: 'Bonifico', etichettaPagante: 'Bonifico', conIva: true, nota: 'IVA compresa' },
  { id: 'assegno', etichetta: 'Assegno', etichettaPagante: 'Assegno', conIva: true, nota: 'IVA compresa' },
]);

/** Nome della colonna del database, ad esempio campoPagamento('venditore', 'bonifico') → 'venditore_bonifico_cent'. */
export const campoPagamento = (parte, modalita) => `${parte}_${modalita}_cent`;
export const CAMPI_PAGAMENTO = Object.freeze(PARTI.flatMap((p) => MODALITA.map((m) => campoPagamento(p.id, m.id))));

/** Toglie l'IVA da un importo che la comprende (centesimi → centesimi, arrotondato al più vicino). */
export function scorporoIva(lordoCent, aliquota) {
  return arrotonda(lordoCent * 10000, 10000 + puntiBase(aliquota));
}

/** IVA da aggiungere a un compenso senza IVA (solo per le pratiche vecchie). */
export function ivaSuImponibile(imponibileCent, aliquota) {
  return arrotonda(imponibileCent * puntiBase(aliquota), 10000);
}

const intero = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** Una parte: contanti (senza IVA), bonifico e assegno (IVA compresa) → compenso senza IVA, IVA contenuta, totale pagato. */
export function compensoParte({ contantiCent = 0, bonificoCent = 0, assegnoCent = 0 }, aliquota) {
  const c = intero(contantiCent);
  const conIva = intero(bonificoCent) + intero(assegnoCent);
  const senzaIva = scorporoIva(conIva, aliquota);
  return {
    contantiCent: c,
    bonificoCent: intero(bonificoCent),
    assegnoCent: intero(assegnoCent),
    imponibileCent: c + senzaIva, // compenso senza IVA
    ivaCent: conIva - senzaIva,   // IVA contenuta in bonifico e assegno
    pagatoCent: c + conIva,       // quanto la parte ha realmente versato
  };
}

/**
 * Compensi di una pratica (riga del database o bozza con gli stessi nomi di campo).
 * Restituisce { daPagamenti, venditore, acquirente, imponibileCent, ivaCent, totaleCent, pagatoCent }:
 *   imponibileCent  compenso totale senza IVA (la base di scaglioni e provvigioni)
 *   ivaCent         IVA (contenuta nei pagamenti, oppure da aggiungere per le pratiche vecchie)
 *   totaleCent      quanto è dovuto con IVA: per le pratiche nuove coincide con quanto è stato pagato
 *   pagatoCent      quanto le parti hanno pagato al momento dell'inserimento (0 per le pratiche vecchie)
 */
export function calcolaCompensi(riga) {
  const aliquota = Number.isFinite(Number(riga.aliquota_iva)) ? Number(riga.aliquota_iva) : 0;
  if (riga.compensi_da_pagamenti) {
    const parte = (id) => compensoParte({
      contantiCent: riga[campoPagamento(id, 'contanti')],
      bonificoCent: riga[campoPagamento(id, 'bonifico')],
      assegnoCent: riga[campoPagamento(id, 'assegno')],
    }, aliquota);
    const venditore = parte('venditore');
    const acquirente = parte('acquirente');
    const pagatoCent = venditore.pagatoCent + acquirente.pagatoCent;
    return {
      daPagamenti: true, venditore, acquirente,
      imponibileCent: venditore.imponibileCent + acquirente.imponibileCent,
      ivaCent: venditore.ivaCent + acquirente.ivaCent,
      totaleCent: pagatoCent,
      pagatoCent,
    };
  }
  const v = intero(riga.compenso_venditore_cent);
  const a = intero(riga.compenso_acquirente_cent);
  const imponibileCent = v + a;
  const ivaCent = ivaSuImponibile(imponibileCent, aliquota);
  const vuota = (imponibile) => ({ contantiCent: 0, bonificoCent: 0, assegnoCent: 0, imponibileCent: imponibile, ivaCent: 0, pagatoCent: 0 });
  return {
    daPagamenti: false, venditore: vuota(v), acquirente: vuota(a),
    imponibileCent, ivaCent, totaleCent: imponibileCent + ivaCent, pagatoCent: 0,
  };
}
