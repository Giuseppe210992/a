// Pratiche (compravendite), incassi e liquidazioni: validazione e salvataggio.
import { ErroreValidazione, ErroreOperazione } from './errori.js';
import { registra } from './impostazioni.js';
import { dataValida, oggi } from '../../core/dates.js';
import { dataIt, eur } from '../../core/format.js';
import { calcolaCompensi, CAMPI_PAGAMENTO, PARTI, MODALITA, campoPagamento } from '../calc/compensi.js';

export const STATI = Object.freeze([
  { valore: 'in_corso', etichetta: 'In corso' },
  { valore: 'conclusa', etichetta: 'Conclusa' },
  { valore: 'annullata', etichetta: 'Annullata' },
]);
export const ETICHETTA_STATO = Object.freeze(Object.fromEntries(STATI.map((s) => [s.valore, s.etichetta])));

export const TIPI_IMMOBILE = Object.freeze([
  'Appartamento', 'Villa / villetta', 'Casa indipendente', 'Box / garage', 'Terreno',
  'Negozio / locale commerciale', 'Ufficio', 'Capannone', 'Altro',
]);

export const PAGANTI = Object.freeze(['Venditore', 'Acquirente', 'Altro']);
export const METODI_PAGAMENTO = Object.freeze(['Bonifico', 'Assegno', 'Contanti', 'Carta / POS', 'Altro']);

export const MASSIMO_CENT = 100_000_000_000; // 1 miliardo di euro: oltre e' quasi certamente un errore di digitazione

const adesso = () => new Date().toISOString();
const testo = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
};

/** Carica tutte le tabelle: e' l'ingresso del motore di calcolo. */
export function leggiDati(db) {
  return {
    collaboratori: db.tutti('SELECT * FROM collaboratori ORDER BY colore, nome COLLATE NOCASE'),
    zone: db.tutti('SELECT * FROM zone ORDER BY nome COLLATE NOCASE'),
    scaglioni: db.tutti('SELECT * FROM scaglioni ORDER BY zona_id, da_cent'),
    pratiche: db.tutti('SELECT * FROM pratiche ORDER BY id'),
    quote: db.tutti('SELECT * FROM quote ORDER BY pratica_id, collaboratore_id'),
    zone_quote: db.tutti('SELECT * FROM zone_quote ORDER BY zona_id, collaboratore_id'),
    incassi: db.tutti('SELECT * FROM incassi ORDER BY data, id'),
    liquidazioni: db.tutti('SELECT * FROM liquidazioni ORDER BY data, id'),
    righe: db.tutti('SELECT * FROM liquidazioni_righe ORDER BY id'),
  };
}

// ------------------------------------------------------------ pratiche

export function prossimoCodice(db, dataPratica = oggi()) {
  const anno = (dataPratica || oggi()).slice(0, 4);
  const righe = db.tutti("SELECT codice FROM pratiche WHERE codice LIKE ? || '/%'", [anno]);
  let massimo = 0;
  for (const r of righe) {
    const n = parseInt(r.codice.slice(anno.length + 1), 10);
    if (Number.isFinite(n) && n > massimo) massimo = n;
  }
  return `${anno}/${String(massimo + 1).padStart(3, '0')}`;
}

/**
 * Rende uniforme una pratica in ingresso. Quello che non viene indicato prende un valore proposto:
 * stato «conclusa», data della pratica = oggi, data del rogito = data della pratica (le pratiche si inseriscono
 * a conclusione, nello stesso giorno). Per i dati passati esplicitamente come vuoti (null) non si inventa nulla.
 *
 * I compensi si indicano in due modi:
 *   - a pagamenti (come nel modulo): importi di ciascuna parte in contanti, bonifico e assegno
 *     (venditore_contanti_cent, ..., acquirente_assegno_cent); il compenso senza IVA si ricava da lì;
 *   - il solo compenso senza IVA (compenso_venditore_cent, compenso_acquirente_cent), con l'IVA in cima.
 */
export function normalizzaPratica(input) {
  const cent = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const stato = input.stato === undefined ? 'conclusa' : input.stato;
  const data_pratica = input.data_pratica === undefined ? oggi() : testo(input.data_pratica);
  const data_rogito = input.data_rogito === undefined ? (stato === 'conclusa' ? data_pratica : null) : testo(input.data_rogito);
  // il segno esplicito vince (una pratica vecchia riletta dal database ha i sei importi a zero ma NON è a pagamenti);
  // se manca, si deduce dalla presenza degli importi pagati
  const aPagamenti = input.compensi_da_pagamenti !== undefined && input.compensi_da_pagamenti !== null
    ? !!Number(input.compensi_da_pagamenti)
    : CAMPI_PAGAMENTO.some((c) => input[c] !== undefined && input[c] !== null && input[c] !== '');
  const d = {
    id: input.id ?? null,
    codice: input.codice === undefined ? undefined : testo(input.codice),
    stato,
    data_pratica,
    data_rogito,
    zona_id: input.zona_id === '' || input.zona_id === undefined ? null : input.zona_id,
    immobile_indirizzo: testo(input.immobile_indirizzo),
    immobile_comune: testo(input.immobile_comune),
    immobile_tipo: testo(input.immobile_tipo),
    prezzo_vendita_cent: cent(input.prezzo_vendita_cent),
    prezzo_acquisto_cent: cent(input.prezzo_acquisto_cent),
    venditore: testo(input.venditore),
    acquirente: testo(input.acquirente),
    compensi_da_pagamenti: aPagamenti ? 1 : 0,
    compenso_venditore_cent: cent(input.compenso_venditore_cent) ?? 0,
    compenso_acquirente_cent: cent(input.compenso_acquirente_cent) ?? 0,
    aliquota_iva: input.aliquota_iva === '' || input.aliquota_iva === undefined || input.aliquota_iva === null ? 22 : Number(input.aliquota_iva),
    note: testo(input.note),
  };
  for (const c of CAMPI_PAGAMENTO) d[c] = aPagamenti ? (cent(input[c]) ?? 0) : 0;
  if (aPagamenti) {
    // il compenso senza IVA di ciascuna parte si ricava dai pagamenti (se i dati sono validi)
    const c = calcolaCompensi(d);
    d.compenso_venditore_cent = c.venditore.imponibileCent;
    d.compenso_acquirente_cent = c.acquirente.imponibileCent;
  }
  return d;
}

/**
 * Controlla una pratica. Blocca il salvataggio solo per errori veri (formato, importi negativi,
 * date incoerenti). I dati semplicemente mancanti (zona, prezzo, rogito...) sono ammessi:
 * la pratica viene segnalata come incompleta.
 */
export function controllaPratica(db, d, quote) {
  const errori = {};
  if (d.codice === undefined) errori.codice = 'Il codice pratica non è stato assegnato.';
  else if (!d.codice) errori.codice = 'Il codice pratica è obbligatorio.';
  else if (d.codice.length > 30) errori.codice = 'Il codice è troppo lungo (massimo 30 caratteri).';
  else if (db.uno('SELECT id FROM pratiche WHERE codice = ? COLLATE NOCASE AND id <> ?', [d.codice, d.id ?? -1])) {
    errori.codice = 'Esiste già una pratica con questo codice.';
  }
  if (!STATI.some((s) => s.valore === d.stato)) errori.stato = 'Scegli lo stato della pratica.';
  if (!d.data_pratica) errori.data_pratica = 'Indica la data di apertura della pratica.';
  else if (!dataValida(d.data_pratica)) errori.data_pratica = 'La data di apertura non è valida.';
  if (d.data_rogito) {
    if (!dataValida(d.data_rogito)) errori.data_rogito = 'La data del rogito non è valida.';
    else if (d.data_pratica && dataValida(d.data_pratica) && d.data_rogito < d.data_pratica) {
      errori.data_rogito = 'Il rogito non può essere precedente all\'apertura della pratica.';
    }
  }
  if (d.zona_id != null && !db.uno('SELECT id FROM zone WHERE id = ?', [d.zona_id])) errori.zona_id = 'La zona scelta non esiste più.';

  const importo = (campo, etichetta) => {
    const v = d[campo];
    if (v === null) return;
    if (!Number.isInteger(v) || v < 0) errori[campo] = `${etichetta}: inserisci un importo valido (zero o più).`;
    else if (v > MASSIMO_CENT) errori[campo] = `${etichetta}: l'importo è troppo grande, controlla le cifre.`;
  };
  importo('prezzo_vendita_cent', 'Prezzo di vendita');
  importo('prezzo_acquisto_cent', 'Prezzo di acquisto');
  if (d.compensi_da_pagamenti) {
    for (const parte of PARTI) {
      for (const modo of MODALITA) importo(campoPagamento(parte.id, modo.id), `${parte.etichetta}, ${modo.etichetta.toLowerCase()}`);
    }
  } else {
    importo('compenso_venditore_cent', 'Compenso venditore');
    importo('compenso_acquirente_cent', 'Compenso acquirente');
  }
  if (!Number.isFinite(d.aliquota_iva) || d.aliquota_iva < 0 || d.aliquota_iva > 100) errori.aliquota_iva = 'L\'aliquota IVA deve essere tra 0 e 100.';

  const visti = new Set();
  let somma = 0;
  for (const q of quote) {
    if (!db.uno('SELECT id FROM collaboratori WHERE id = ?', [q.collaboratore_id])) { errori.quote = 'Un collaboratore della ripartizione non esiste più.'; break; }
    if (visti.has(q.collaboratore_id)) { errori.quote = 'Lo stesso collaboratore è presente due volte nella ripartizione.'; break; }
    visti.add(q.collaboratore_id);
    if (!Number.isFinite(q.percentuale) || q.percentuale <= 0 || q.percentuale > 100) { errori.quote = 'Ogni quota deve essere maggiore di 0 e al massimo 100%.'; break; }
    somma += Math.round(q.percentuale * 100);
  }
  if (!errori.quote && somma > 10000) errori.quote = 'La somma delle quote supera il 100%.';

  if (Object.keys(errori).length) throw new ErroreValidazione(errori);
}

export function salvaPratica(db, input, quote = []) {
  const d = normalizzaPratica(input);
  const q = quote.map((x) => ({ collaboratore_id: x.collaboratore_id, percentuale: Number(x.percentuale) }));
  return db.transazione(() => {
    if (d.codice === undefined) d.codice = prossimoCodice(db, d.data_pratica); // numero progressivo automatico, mai chiesto all'utente
    controllaPratica(db, d, q);
    const t = adesso();
    let id = d.id;
    if (id) {
      if (!db.uno('SELECT id FROM pratiche WHERE id = ?', [id])) throw new ErroreOperazione('La pratica non esiste più.');
      const conLiquidazioni = db.tutti(
        `SELECT DISTINCT l.collaboratore_id AS id, c.nome FROM liquidazioni_righe r
           JOIN liquidazioni l ON l.id = r.liquidazione_id JOIN collaboratori c ON c.id = l.collaboratore_id
          WHERE r.pratica_id = ?`, [id]);
      for (const c of conLiquidazioni) {
        if (!q.some((x) => x.collaboratore_id === c.id)) {
          throw new ErroreOperazione(`${c.nome} ha liquidazioni registrate su questa pratica: non puoi toglierlo dalla ripartizione. Elimina prima quelle liquidazioni.`);
        }
      }
      db.esegui(
        `UPDATE pratiche SET codice=?, stato=?, data_pratica=?, data_rogito=?, zona_id=?, immobile_indirizzo=?, immobile_comune=?,
           immobile_tipo=?, prezzo_vendita_cent=?, prezzo_acquisto_cent=?, venditore=?, acquirente=?, compensi_da_pagamenti=?,
           ${CAMPI_PAGAMENTO.map((c) => `${c}=?`).join(', ')}, compenso_venditore_cent=?,
           compenso_acquirente_cent=?, aliquota_iva=?, note=?, aggiornato_il=? WHERE id=?`,
        [d.codice, d.stato, d.data_pratica, d.data_rogito, d.zona_id, d.immobile_indirizzo, d.immobile_comune, d.immobile_tipo,
          d.prezzo_vendita_cent, d.prezzo_acquisto_cent, d.venditore, d.acquirente, d.compensi_da_pagamenti,
          ...CAMPI_PAGAMENTO.map((c) => d[c]), d.compenso_venditore_cent,
          d.compenso_acquirente_cent, d.aliquota_iva, d.note, t, id],
      );
      db.esegui('DELETE FROM quote WHERE pratica_id = ?', [id]);
    } else {
      db.esegui(
        `INSERT INTO pratiche (codice, stato, data_pratica, data_rogito, zona_id, immobile_indirizzo, immobile_comune, immobile_tipo,
           prezzo_vendita_cent, prezzo_acquisto_cent, venditore, acquirente, compensi_da_pagamenti, ${CAMPI_PAGAMENTO.join(', ')},
           compenso_venditore_cent, compenso_acquirente_cent,
           aliquota_iva, note, creato_il, aggiornato_il) VALUES (${new Array(12 + 1 + CAMPI_PAGAMENTO.length + 2 + 4).fill('?').join(',')})`,
        [d.codice, d.stato, d.data_pratica, d.data_rogito, d.zona_id, d.immobile_indirizzo, d.immobile_comune, d.immobile_tipo,
          d.prezzo_vendita_cent, d.prezzo_acquisto_cent, d.venditore, d.acquirente, d.compensi_da_pagamenti,
          ...CAMPI_PAGAMENTO.map((c) => d[c]), d.compenso_venditore_cent,
          d.compenso_acquirente_cent, d.aliquota_iva, d.note, t, t],
      );
      id = db.ultimoId();
    }
    for (const x of q) {
      db.esegui('INSERT INTO quote (pratica_id, collaboratore_id, percentuale) VALUES (?, ?, ?)', [id, x.collaboratore_id, x.percentuale]);
    }
    return id;
  });
}

export function dettaglioEliminazionePratica(db, id) {
  return {
    incassi: db.valore('SELECT COUNT(*) FROM incassi WHERE pratica_id = ?', [id]),
    incassatoCent: db.valore('SELECT COALESCE(SUM(importo_cent), 0) FROM incassi WHERE pratica_id = ?', [id]),
    quote: db.valore('SELECT COUNT(*) FROM quote WHERE pratica_id = ?', [id]),
    liquidazioni: db.valore('SELECT COUNT(DISTINCT liquidazione_id) FROM liquidazioni_righe WHERE pratica_id = ?', [id]),
  };
}

export function eliminaPratica(db, id) {
  return db.transazione(() => {
    const p = db.uno('SELECT * FROM pratiche WHERE id = ?', [id]);
    if (!p) throw new ErroreOperazione('La pratica non esiste più.');
    const dett = dettaglioEliminazionePratica(db, id);
    if (dett.liquidazioni) {
      throw new ErroreOperazione(
        `La pratica ${p.codice} ha liquidazioni registrate: non si può eliminare. Puoi segnarla come "Annullata", oppure eliminare prima le liquidazioni collegate.`,
        dett,
      );
    }
    db.esegui('DELETE FROM pratiche WHERE id = ?', [id]);
    const zona = p.zona_id != null ? db.valore('SELECT nome FROM zone WHERE id = ?', [p.zona_id]) : null;
    registra(db, 'pratica_eliminata', `${p.codice} - ${p.immobile_indirizzo || (zona ? `zona ${zona}` : 'senza zona')} (${dett.incassi} incassi eliminati)`);
  });
}

// ------------------------------------------------------------ incassi

function controllaIncasso(db, i) {
  const errori = {};
  if (!db.uno('SELECT id FROM pratiche WHERE id = ?', [i.praticaId])) errori.praticaId = 'Scegli la pratica.';
  if (!i.data || !dataValida(i.data)) errori.data = 'Indica una data valida.';
  if (!Number.isInteger(i.importoCent) || i.importoCent <= 0) errori.importoCent = 'Inserisci un importo maggiore di zero.';
  else if (i.importoCent > MASSIMO_CENT) errori.importoCent = 'L\'importo è troppo grande, controlla le cifre.';
  if (Object.keys(errori).length) throw new ErroreValidazione(errori);
}

export function registraIncasso(db, { praticaId, data, importoCent, pagante = null, metodo = null, note = null }) {
  return db.transazione(() => {
    controllaIncasso(db, { praticaId, data, importoCent });
    db.esegui(
      'INSERT INTO incassi (pratica_id, data, importo_cent, pagante, metodo, note, creato_il) VALUES (?,?,?,?,?,?,?)',
      [praticaId, data, importoCent, testo(pagante), testo(metodo), testo(note), adesso()],
    );
    return db.ultimoId();
  });
}

export function modificaIncasso(db, id, { data, importoCent, pagante, metodo, note }) {
  return db.transazione(() => {
    const att = db.uno('SELECT * FROM incassi WHERE id = ?', [id]);
    if (!att) throw new ErroreOperazione('L\'incasso non esiste più.');
    controllaIncasso(db, { praticaId: att.pratica_id, data, importoCent });
    db.esegui('UPDATE incassi SET data=?, importo_cent=?, pagante=?, metodo=?, note=? WHERE id=?',
      [data, importoCent, testo(pagante), testo(metodo), testo(note), id]);
  });
}

export function eliminaIncasso(db, id) {
  return db.transazione(() => {
    const i = db.uno('SELECT i.*, p.codice FROM incassi i JOIN pratiche p ON p.id = i.pratica_id WHERE i.id = ?', [id]);
    if (!i) throw new ErroreOperazione('L\'incasso non esiste più.');
    db.esegui('DELETE FROM incassi WHERE id = ?', [id]);
    registra(db, 'incasso_eliminato', `${i.codice}: ${eur(i.importo_cent)} del ${dataIt(i.data)}`);
  });
}

// ------------------------------------------------------------ liquidazioni

export function registraLiquidazione(db, { collaboratoreId, data, metodo = null, note = null, righe = [] }) {
  return db.transazione(() => {
    const errori = {};
    if (!db.uno('SELECT id FROM collaboratori WHERE id = ?', [collaboratoreId])) errori.collaboratoreId = 'Scegli il collaboratore.';
    if (!data || !dataValida(data)) errori.data = 'Indica una data valida.';
    if (!righe.length) errori.righe = 'Seleziona almeno una pratica da liquidare.';
    const viste = new Set();
    for (const r of righe) {
      if (viste.has(r.praticaId)) { errori.righe = 'La stessa pratica compare due volte.'; break; }
      viste.add(r.praticaId);
      if (!Number.isInteger(r.importoCent) || r.importoCent <= 0) { errori.righe = 'Ogni importo deve essere maggiore di zero.'; break; }
      if (r.importoCent > MASSIMO_CENT) { errori.righe = 'Un importo è troppo grande, controlla le cifre.'; break; }
      if (!db.uno('SELECT 1 FROM quote WHERE pratica_id = ? AND collaboratore_id = ?', [r.praticaId, collaboratoreId])) {
        errori.righe = 'Una delle pratiche scelte non ha questo collaboratore nella ripartizione.';
        break;
      }
    }
    if (Object.keys(errori).length) throw new ErroreValidazione(errori);
    db.esegui('INSERT INTO liquidazioni (collaboratore_id, data, metodo, note, creato_il) VALUES (?,?,?,?,?)',
      [collaboratoreId, data, testo(metodo), testo(note), adesso()]);
    const id = db.ultimoId();
    for (const r of righe) {
      db.esegui('INSERT INTO liquidazioni_righe (liquidazione_id, pratica_id, importo_cent) VALUES (?,?,?)', [id, r.praticaId, r.importoCent]);
    }
    return id;
  });
}

export function modificaLiquidazione(db, id, { data, metodo, note }) {
  return db.transazione(() => {
    if (!db.uno('SELECT id FROM liquidazioni WHERE id = ?', [id])) throw new ErroreOperazione('La liquidazione non esiste più.');
    if (!data || !dataValida(data)) throw new ErroreValidazione({ data: 'Indica una data valida.' });
    db.esegui('UPDATE liquidazioni SET data=?, metodo=?, note=? WHERE id=?', [data, testo(metodo), testo(note), id]);
  });
}

export function eliminaLiquidazione(db, id) {
  return db.transazione(() => {
    const l = db.uno('SELECT l.*, c.nome FROM liquidazioni l JOIN collaboratori c ON c.id = l.collaboratore_id WHERE l.id = ?', [id]);
    if (!l) throw new ErroreOperazione('La liquidazione non esiste più.');
    const totale = db.valore('SELECT COALESCE(SUM(importo_cent), 0) FROM liquidazioni_righe WHERE liquidazione_id = ?', [id]);
    db.esegui('DELETE FROM liquidazioni WHERE id = ?', [id]);
    registra(db, 'liquidazione_eliminata', `${l.nome}: ${eur(totale)} del ${dataIt(l.data)}`);
  });
}
