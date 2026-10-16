// Verifica di integrita': controlla sia il file SQLite (struttura, vincoli) sia la coerenza
// dei dati (ripartizioni, incassi, liquidazioni). Non modifica nulla: elenca solo i problemi.
import { dataValida } from '../core/dates.js';
import { versioneDatabase, idApplicazioneDatabase, ID_APPLICAZIONE, VERSIONE_SCHEMA } from './schema.js';
import { eur } from '../core/format.js';

/**
 * Restituisce { ok, controlli: [{ nome, ok, dettaglio }], problemi: [{ livello, codice, messaggio, praticaId? }] }
 * livello: 'errore' (da correggere) | 'avviso' (da controllare)
 */
export function verificaIntegrita(archivio, modello) {
  const controlli = [];
  const problemi = [];

  // 1) file SQLite
  let esitoFile = 'ok';
  try {
    const r = archivio.db.exec('PRAGMA integrity_check');
    const righe = r.length ? r[0].values.map((v) => v[0]) : ['ok'];
    if (!(righe.length === 1 && righe[0] === 'ok')) esitoFile = righe.slice(0, 5).join('; ');
  } catch (e) {
    esitoFile = e.message;
  }
  controlli.push({ nome: 'Struttura del file del database', ok: esitoFile === 'ok', dettaglio: esitoFile === 'ok' ? 'Nessun errore.' : esitoFile });
  if (esitoFile !== 'ok') problemi.push({ livello: 'errore', codice: 'file_danneggiato', messaggio: `Il database segnala un errore di struttura: ${esitoFile}` });

  let fk = [];
  try {
    const r = archivio.db.exec('PRAGMA foreign_key_check');
    fk = r.length ? r[0].values : [];
  } catch (e) {
    fk = [[e.message]];
  }
  controlli.push({ nome: 'Collegamenti tra le tabelle', ok: fk.length === 0, dettaglio: fk.length ? `${fk.length} riferimenti non validi.` : 'Tutti i collegamenti sono validi.' });
  if (fk.length) problemi.push({ livello: 'errore', codice: 'riferimenti', messaggio: `${fk.length} dati fanno riferimento a elementi che non esistono più.` });

  const v = versioneDatabase(archivio.db);
  const app = idApplicazioneDatabase(archivio.db);
  const versioneOk = v === VERSIONE_SCHEMA && app === ID_APPLICAZIONE;
  controlli.push({ nome: 'Versione dell\'archivio', ok: versioneOk, dettaglio: versioneOk ? `Schema ${v}, aggiornato.` : `Schema ${v}, atteso ${VERSIONE_SCHEMA}.` });
  if (!versioneOk) problemi.push({ livello: 'errore', codice: 'versione', messaggio: 'La versione dell\'archivio non corrisponde a quella del programma.' });

  // 2) date scritte male (non dovrebbe succedere dall'interfaccia, ma un import potrebbe)
  const dateErrate = [];
  for (const p of modello.pratiche) {
    if (!dataValida(p.data_pratica) || (p.data_rogito && !dataValida(p.data_rogito))) dateErrate.push(p);
  }
  for (const i of modello.incassi) if (!dataValida(i.data)) dateErrate.push({ id: i.pratica_id, codice: '(incasso)' });
  controlli.push({ nome: 'Date', ok: dateErrate.length === 0, dettaglio: dateErrate.length ? `${dateErrate.length} date non valide.` : 'Tutte le date sono valide.' });
  for (const p of dateErrate) problemi.push({ livello: 'errore', codice: 'data_non_valida', praticaId: p.id, messaggio: `La pratica ${p.codice} ha una data non valida.` });

  // 3) coerenza dei dati
  let n = 0;
  for (const p of modello.pratiche) {
    if (p.quoteDefinite) {
      const somma = Math.round(p.voci.reduce((s, x) => s + x.quotaPct, 0) * 100);
      if (somma > 10000) {
        problemi.push({ livello: 'errore', codice: 'ripartizione_oltre_100', praticaId: p.id, messaggio: `Pratica ${p.codice}: la ripartizione supera il 100%.` });
        n += 1;
      }
    }
    if (p.data_rogito && p.data_pratica && dataValida(p.data_rogito) && dataValida(p.data_pratica) && p.data_rogito < p.data_pratica) {
      problemi.push({ livello: 'errore', codice: 'rogito_prima_apertura', praticaId: p.id, messaggio: `Pratica ${p.codice}: il rogito è precedente all'apertura.` });
      n += 1;
    }
    if (p.incassatoCent > p.totaleLordoCent + 1 && p.totaleLordoCent >= 0 && p.incassatoCent > 0) {
      problemi.push({ livello: 'avviso', codice: 'incassi_eccedenti', praticaId: p.id, messaggio: `Pratica ${p.codice}: incassati ${eur(p.incassatoCent)} su ${eur(p.totaleLordoCent)} dovuti.` });
      n += 1;
    }
    for (const x of p.voci) {
      if (x.liquidataCent > x.maturataCent && x.liquidataCent > 0) {
        const nome = modello.collaboratori.find((c) => c.id === x.collaboratoreId)?.nome ?? 'Un collaboratore';
        problemi.push({
          livello: 'avviso', codice: 'liquidato_oltre_maturato', praticaId: p.id,
          messaggio: `Pratica ${p.codice}: a ${nome} sono stati liquidati ${eur(x.liquidataCent)} su ${eur(x.maturataCent)} maturati.`,
        });
        n += 1;
      }
    }
  }
  for (const l of modello.liquidazioni) {
    for (const r of l.righe) {
      const p = r.pratica;
      if (p && !p.voci.some((x) => x.collaboratoreId === l.collaboratore_id)) {
        problemi.push({ livello: 'errore', codice: 'liquidazione_senza_quota', praticaId: p.id, messaggio: `Pratica ${p.codice}: liquidazione a un collaboratore che non è nella ripartizione.` });
        n += 1;
      }
    }
  }
  controlli.push({ nome: 'Coerenza di ripartizioni, incassi e liquidazioni', ok: n === 0, dettaglio: n ? `${n} situazioni da controllare.` : 'Nessuna incoerenza.' });

  // 4) tabelle degli scaglioni
  controlli.push({
    nome: 'Tabelle degli scaglioni',
    ok: modello.erroriTabelle.length === 0,
    dettaglio: modello.erroriTabelle.length ? modello.erroriTabelle[0].testo : 'Valide.',
  });
  for (const e of modello.erroriTabelle) {
    const zona = e.zonaId != null ? modello.zone.find((z) => z.id === e.zonaId)?.nome : null;
    problemi.push({ livello: 'errore', codice: 'scaglioni_non_validi', messaggio: `Scaglioni${zona ? ` della zona ${zona}` : ' predefiniti'}: ${e.testo}` });
  }

  return {
    ok: problemi.every((p) => p.livello !== 'errore'),
    senzaProblemi: problemi.length === 0,
    controlli,
    problemi,
    errori: problemi.filter((p) => p.livello === 'errore').length,
    avvisi: problemi.filter((p) => p.livello === 'avviso').length,
  };
}
