// Dati di prova per i test del motore di calcolo (usati SOLO nei test, mai nel programma).
export const EURO = 100;

export function datiBase() {
  const adesso = '2026-10-01T09:00:00.000Z';
  return {
    collaboratori: [
      { id: 1, nome: 'Luca', attivo: 1, colore: 1 },
      { id: 2, nome: 'Giuseppe', attivo: 1, colore: 2 },
    ],
    zone: [
      { id: 1, nome: 'Zona A', attiva: 1, colore: 1, usa_scaglioni_propri: 0 },
      { id: 2, nome: 'Zona B', attiva: 1, colore: 2, usa_scaglioni_propri: 0 },
    ],
    scaglioni: [
      { id: 1, zona_id: null, da_cent: 0, percentuale: 30 },
      { id: 2, zona_id: null, da_cent: 10000 * EURO, percentuale: 35 },
      { id: 3, zona_id: null, da_cent: 20000 * EURO, percentuale: 40 },
    ],
    pratiche: [],
    quote: [],
    incassi: [],
    liquidazioni: [],
    righe: [],
    _adesso: adesso,
  };
}

/** Aggiunge una pratica con la sua ripartizione. quote: [[collaboratoreId, percentuale], ...] */
export function aggiungiPratica(dati, id, campi, quote = []) {
  dati.pratiche.push({
    id,
    codice: `2026/${String(id).padStart(3, '0')}`,
    stato: 'conclusa',
    data_pratica: '2026-09-01',
    data_rogito: '2026-10-05',
    zona_id: 1,
    immobile_indirizzo: `Via Prova ${id}`,
    immobile_comune: 'Minturno',
    immobile_tipo: 'Appartamento',
    prezzo_vendita_cent: 150000 * EURO,
    prezzo_acquisto_cent: null,
    venditore: null,
    acquirente: null,
    compenso_venditore_cent: 3000 * EURO,
    compenso_acquirente_cent: 3000 * EURO,
    aliquota_iva: 22,
    note: null,
    creato_il: dati._adesso,
    aggiornato_il: dati._adesso,
    ...campi,
  });
  for (const [collaboratore_id, percentuale] of quote) {
    dati.quote.push({ pratica_id: id, collaboratore_id, percentuale });
  }
}
