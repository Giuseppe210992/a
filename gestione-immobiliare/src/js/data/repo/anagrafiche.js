// Collaboratori, zone e tabelle degli scaglioni.
import { ErroreValidazione, ErroreOperazione } from './errori.js';
import { registra } from './impostazioni.js';
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
  };
}

export function eliminaCollaboratore(db, id) {
  return db.transazione(() => {
    const c = db.uno('SELECT * FROM collaboratori WHERE id = ?', [id]);
    if (!c) throw new ErroreOperazione('Collaboratore non trovato.');
    const usi = usiCollaboratore(db, id);
    if (usi.pratiche || usi.liquidazioni) {
      throw new ErroreOperazione(
        `${c.nome} compare in ${usi.pratiche} pratiche e ha ${usi.liquidazioni} liquidazioni registrate: non si può eliminare. Puoi disattivarlo, così non verrà più proposto.`,
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
