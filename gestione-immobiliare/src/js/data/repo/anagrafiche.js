// Collaboratori, zone e tabelle degli scaglioni.
import { ErroreValidazione, ErroreOperazione } from './errori.js';
import { registra, leggiImpostazioni } from './impostazioni.js';
import { creaTabella, controllaTabella } from '../calc/scaglioni.js';

const adesso = () => new Date().toISOString();

/** Primo colore (1-8) libero tra le righe indicate; se sono tutti usati, il meno usato. */
function prossimoColore(righe) {
  const conteggio = new Array(9).fill(0);
  for (const r of righe) conteggio[r.colore] += 1;
  let migliore = 1;
  for (let c = 1; c <= 8; c++) if (conteggio[c] < conteggio[migliore]) migliore = c;
  return migliore;
}

// ------------------------------------------------------------ collaboratori

export function elencoCollaboratori(db) {
  return db.tutti('SELECT * FROM collaboratori ORDER BY colore, nome COLLATE NOCASE');
}

function controllaNome(db, tabella, nome, idEscluso = null) {
  const pulito = String(nome ?? '').trim();
  if (!pulito) throw new ErroreValidazione({ nome: 'Scrivi un nome.' });
  if (pulito.length > 60) throw new ErroreValidazione({ nome: 'Il nome è troppo lungo (massimo 60 caratteri).' });
  const doppione = db.uno(`SELECT id FROM ${tabella} WHERE nome = ? COLLATE NOCASE AND id <> ?`, [pulito, idEscluso ?? -1]);
  if (doppione) throw new ErroreValidazione({ nome: 'Esiste già una voce con questo nome.' });
  return pulito;
}

export function creaCollaboratore(db, { nome, note = null }) {
  return db.transazione(() => {
    const pulito = controllaNome(db, 'collaboratori', nome);
    const colore = prossimoColore(db.tutti('SELECT colore FROM collaboratori'));
    const t = adesso();
    db.esegui(
      'INSERT INTO collaboratori (nome, attivo, colore, note, creato_il, aggiornato_il) VALUES (?, 1, ?, ?, ?, ?)',
      [pulito, colore, note, t, t],
    );
    return db.ultimoId();
  });
}

export function aggiornaCollaboratore(db, id, { nome, attivo, colore, note }) {
  return db.transazione(() => {
    const att = db.uno('SELECT * FROM collaboratori WHERE id = ?', [id]);
    if (!att) throw new ErroreOperazione('Collaboratore non trovato.');
    const pulito = nome === undefined ? att.nome : controllaNome(db, 'collaboratori', nome, id);
    db.esegui(
      'UPDATE collaboratori SET nome = ?, attivo = ?, colore = ?, note = ?, aggiornato_il = ? WHERE id = ?',
      [pulito, (attivo ?? att.attivo) ? 1 : 0, colore ?? att.colore, note === undefined ? att.note : note, adesso(), id],
    );
  });
}

export function usiCollaboratore(db, id) {
  return {
    pratiche: db.valore('SELECT COUNT(*) FROM quote WHERE collaboratore_id = ?', [id]),
    liquidazioni: db.valore('SELECT COUNT(*) FROM liquidazioni WHERE collaboratore_id = ?', [id]),
    zone: db.valore('SELECT COUNT(*) FROM zone_quote WHERE collaboratore_id = ?', [id]),
  };
}

export function eliminaCollaboratore(db, id) {
  return db.transazione(() => {
    const c = db.uno('SELECT * FROM collaboratori WHERE id = ?', [id]);
    if (!c) throw new ErroreOperazione('Collaboratore non trovato.');
    const usi = usiCollaboratore(db, id);
    if (usi.pratiche || usi.liquidazioni || usi.zone) {
      throw new ErroreOperazione(
        `${c.nome} compare in ${usi.pratiche} pratiche e ha ${usi.liquidazioni} liquidazioni registrate${usi.zone ? ` e fa parte della ripartizione di ${usi.zone === 1 ? '1 zona' : `${usi.zone} zone`}` : ''}: non si può eliminare. Puoi disattivarlo, così non verrà più proposto.`,
        usi,
      );
    }
    db.esegui('DELETE FROM collaboratori WHERE id = ?', [id]);
    // Toglie il collaboratore anche dalla ripartizione predefinita.
    const r = db.uno("SELECT valore FROM impostazioni WHERE chiave = 'ripartizione.predefinita'");
    if (r) {
      const lista = (JSON.parse(r.valore) || []).filter((x) => x.collaboratoreId !== id);
      db.esegui("UPDATE impostazioni SET valore = ? WHERE chiave = 'ripartizione.predefinita'", [JSON.stringify(lista)]);
    }
    registra(db, 'collaboratore_eliminato', c.nome);
  });
}

// ------------------------------------------------------------ zone

export function elencoZone(db) {
  return db.tutti('SELECT * FROM zone ORDER BY nome COLLATE NOCASE');
}

export function creaZona(db, { nome, note = null }) {
  return db.transazione(() => {
    const pulito = controllaNome(db, 'zone', nome);
    const colore = prossimoColore(db.tutti('SELECT colore FROM zone'));
    const t = adesso();
    db.esegui(
      'INSERT INTO zone (nome, attiva, colore, usa_scaglioni_propri, note, creato_il, aggiornato_il) VALUES (?, 1, ?, 0, ?, ?, ?)',
      [pulito, colore, note, t, t],
    );
    return db.ultimoId();
  });
}

export function aggiornaZona(db, id, { nome, attiva, colore, usaScaglioniPropri, note }) {
  return db.transazione(() => {
    const att = db.uno('SELECT * FROM zone WHERE id = ?', [id]);
    if (!att) throw new ErroreOperazione('Zona non trovata.');
    const pulito = nome === undefined ? att.nome : controllaNome(db, 'zone', nome, id);
    db.esegui(
      'UPDATE zone SET nome = ?, attiva = ?, colore = ?, usa_scaglioni_propri = ?, note = ?, aggiornato_il = ? WHERE id = ?',
      [
        pulito,
        (attiva ?? att.attiva) ? 1 : 0,
        colore ?? att.colore,
        (usaScaglioniPropri ?? att.usa_scaglioni_propri) ? 1 : 0,
        note === undefined ? att.note : note,
        adesso(),
        id,
      ],
    );
  });
}

export function usiZona(db, id) {
  return { pratiche: db.valore('SELECT COUNT(*) FROM pratiche WHERE zona_id = ?', [id]) };
}

export function eliminaZona(db, id) {
  return db.transazione(() => {
    const z = db.uno('SELECT * FROM zone WHERE id = ?', [id]);
    if (!z) throw new ErroreOperazione('Zona non trovata.');
    const usi = usiZona(db, id);
    if (usi.pratiche) {
      throw new ErroreOperazione(
        `La zona "${z.nome}" è usata da ${usi.pratiche} pratiche: non si può eliminare. Puoi disattivarla, così non verrà più proposta.`,
        usi,
      );
    }
    db.esegui('DELETE FROM zone WHERE id = ?', [id]);
    registra(db, 'zona_eliminata', z.nome);
  });
}

// ------------------------------------------------------------ scaglioni

export function leggiTabellaScaglioni(db, zonaId = null) {
  const righe = zonaId == null
    ? db.tutti('SELECT * FROM scaglioni WHERE zona_id IS NULL ORDER BY da_cent')
    : db.tutti('SELECT * FROM scaglioni WHERE zona_id = ? ORDER BY da_cent', [zonaId]);
  return righe.map((r) => ({ da_cent: r.da_cent, percentuale: r.percentuale }));
}

/** Sostituisce la tabella degli scaglioni di una zona (o quella predefinita se zonaId e' null). */
export function salvaTabellaScaglioni(db, zonaId, righe) {
  return db.transazione(() => {
    const tabella = creaTabella(righe);
    const problemi = tabella.length ? controllaTabella(tabella) : [];
    if (problemi.length) throw new ErroreValidazione({ scaglioni: problemi[0] }, problemi.join(' '));
    if (zonaId == null) db.esegui('DELETE FROM scaglioni WHERE zona_id IS NULL');
    else db.esegui('DELETE FROM scaglioni WHERE zona_id = ?', [zonaId]);
    for (const s of tabella) {
      db.esegui('INSERT INTO scaglioni (zona_id, da_cent, percentuale) VALUES (?, ?, ?)', [zonaId, s.da, s.percentuale]);
    }
  });
}

// ------------------------------------------------------------ ripartizione automatica per zona

/** Come si divide una pratica della zona tra i collaboratori: [{ collaboratore_id, percentuale }] (vuoto = non impostata). */
export function leggiRipartizioneZona(db, zonaId) {
  return db.tutti('SELECT collaboratore_id, percentuale FROM zone_quote WHERE zona_id = ? ORDER BY collaboratore_id', [zonaId]);
}

/** Controlla una ripartizione che deve fare esattamente 100%. Restituisce il messaggio del problema, o null. */
export function problemaRipartizione(db, quote) {
  const visti = new Set();
  let sommaBp = 0;
  for (const q of quote) {
    if (!db.uno('SELECT id FROM collaboratori WHERE id = ?', [q.collaboratore_id])) return 'Un collaboratore della ripartizione non esiste più.';
    if (visti.has(q.collaboratore_id)) return 'Lo stesso collaboratore è presente due volte nella ripartizione.';
    visti.add(q.collaboratore_id);
    if (!Number.isFinite(q.percentuale) || q.percentuale <= 0 || q.percentuale > 100) return 'Ogni quota deve essere maggiore di 0 e al massimo 100%.';
    sommaBp += Math.round(q.percentuale * 100);
  }
  if (quote.length && sommaBp !== 10000) return 'Le quote devono sommare esattamente 100%.';
  return null;
}

/** Sostituisce la ripartizione di una zona. Con un elenco vuoto la zona torna a usare quella predefinita. */
export function salvaRipartizioneZona(db, zonaId, righe) {
  return db.transazione(() => {
    const z = db.uno('SELECT * FROM zone WHERE id = ?', [zonaId]);
    if (!z) throw new ErroreOperazione('Zona non trovata.');
    const quote = (righe || []).map((r) => ({ collaboratore_id: r.collaboratore_id, percentuale: Number(r.percentuale) }));
    const problema = problemaRipartizione(db, quote);
    if (problema) throw new ErroreValidazione({ quote: problema });
    db.esegui('DELETE FROM zone_quote WHERE zona_id = ?', [zonaId]);
    for (const q of quote) {
      db.esegui('INSERT INTO zone_quote (zona_id, collaboratore_id, percentuale) VALUES (?, ?, ?)', [zonaId, q.collaboratore_id, q.percentuale]);
    }
    db.esegui('UPDATE zone SET aggiornato_il = ? WHERE id = ?', [adesso(), zonaId]);
  });
}

/**
 * La ripartizione che si applica a una nuova pratica, a seconda della zona:
 *   1. quella della zona, se è stata impostata ('zona');
 *   2. altrimenti la ripartizione predefinita delle Impostazioni ('predefinita');
 *   3. altrimenti, se c'è un solo collaboratore attivo, tutto a lui ('unico');
 *   4. altrimenti nessuna ('nessuna'): la pratica si salva ma viene segnalata come priva di ripartizione.
 * Restituisce { origine, quote: [{ collaboratore_id, percentuale }] }.
 */
export function ripartizioneAutomatica(db, zonaId, impostazioni = null) {
  if (zonaId != null) {
    const quote = leggiRipartizioneZona(db, zonaId);
    if (quote.length) return { origine: 'zona', quote };
  }
  const imp = impostazioni || leggiImpostazioni(db);
  const attivi = db.tutti('SELECT id FROM collaboratori WHERE attivo = 1 ORDER BY colore, nome COLLATE NOCASE').map((c) => c.id);
  const predefinita = (imp['ripartizione.predefinita'] || []).filter((x) => attivi.includes(x.collaboratoreId));
  if (predefinita.length && predefinita.reduce((somma, x) => somma + Math.round(x.percentuale * 100), 0) === 10000) {
    return { origine: 'predefinita', quote: predefinita.map((x) => ({ collaboratore_id: x.collaboratoreId, percentuale: x.percentuale })) };
  }
  if (attivi.length === 1) return { origine: 'unico', quote: [{ collaboratore_id: attivi[0], percentuale: 100 }] };
  return { origine: 'nessuna', quote: [] };
}
