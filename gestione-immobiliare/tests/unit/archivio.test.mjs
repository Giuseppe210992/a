import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nuovaApp, riapri, modelloDi, motore } from './helpers-db.mjs';
import { Archivio, ErroreArchivio, ispezionaBytes } from '../../src/js/data/db.js';
import { DriverMemoria } from '../../src/js/data/drivers/memoria.js';
import { migra, ID_APPLICAZIONE } from '../../src/js/data/schema.js';
import {
  creaCollaboratore, aggiornaCollaboratore, eliminaCollaboratore, creaZona, eliminaZona, aggiornaZona,
  salvaTabellaScaglioni, leggiTabellaScaglioni, elencoCollaboratori, elencoZone,
} from '../../src/js/data/repo/anagrafiche.js';
import {
  salvaPratica, eliminaPratica, prossimoCodice, registraIncasso, eliminaIncasso, modificaIncasso,
  registraLiquidazione, eliminaLiquidazione, dettaglioEliminazionePratica,
} from '../../src/js/data/repo/pratiche.js';
import { leggiImpostazioni, scriviImpostazioni, leggiRegistro } from '../../src/js/data/repo/impostazioni.js';
import { ErroreValidazione, ErroreOperazione } from '../../src/js/data/repo/errori.js';
import {
  creaBackup, elencoBackup, ripristinaBackup, esportaArchivio, leggiFileDaImportare, applicaImportazione,
  azzeraArchivio, backupAutomatico, potaCopie, ultimoBackup,
} from '../../src/js/data/backup.js';
import { verificaIntegrita } from '../../src/js/data/integrity.js';
import { csvPratiche, csvIncassi, csvLiquidazioni, csvProvvigioni } from '../../src/js/data/esporta.js';

const E = 100;
const pratica = (extra = {}) => ({
  codice: '2026/001', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-10-05', zona_id: null,
  immobile_indirizzo: 'Via Roma 1', immobile_comune: 'Minturno', immobile_tipo: 'Appartamento',
  prezzo_vendita_cent: 150000 * E, compenso_venditore_cent: 3000 * E, compenso_acquirente_cent: 3000 * E, aliquota_iva: 22,
  ...extra,
});

async function appConDati() {
  const app = await nuovaApp();
  const a = app.archivio;
  const zona = await creaZona(a, { nome: 'Centro' });
  await salvaTabellaScaglioni(a, null, [{ da_cent: 0, percentuale: 30 }, { da_cent: 10000 * E, percentuale: 35 }]);
  const [luca, giuseppe] = elencoCollaboratori(a);
  const id = await salvaPratica(a, pratica({ zona_id: zona }), [{ collaboratore_id: luca.id, percentuale: 100 }]);
  return { ...app, zona, luca, giuseppe, id };
}

test('un archivio nuovo contiene solo Luca e Giuseppe: nessun dato dimostrativo', async () => {
  const { archivio } = await nuovaApp();
  assert.deepEqual(elencoCollaboratori(archivio).map((c) => c.nome), ['Luca', 'Giuseppe']);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM pratiche'), 0);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM zone'), 0);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM scaglioni'), 0);
  assert.equal(archivio.valore('PRAGMA application_id'), ID_APPLICAZIONE);
});

test('i colori dei collaboratori restano legati alla persona', async () => {
  const { archivio } = await nuovaApp();
  const [luca, giuseppe] = elencoCollaboratori(archivio);
  assert.deepEqual([luca.colore, giuseppe.colore], [1, 2]);
  const terzo = await creaCollaboratore(archivio, { nome: 'Marco' });
  assert.equal(elencoCollaboratori(archivio).find((c) => c.id === terzo).colore, 3);
  await aggiornaCollaboratore(archivio, luca.id, { attivo: false });
  assert.equal(elencoCollaboratori(archivio).find((c) => c.id === luca.id).colore, 1);
});

test('chiudere e riaprire: i dati restano salvati', async () => {
  const app = await appConDati();
  const prima = modelloDi(app.archivio).perId.get(app.id);
  const riaperta = await riapri(app);
  const dopo = modelloDi(riaperta.archivio).perId.get(app.id);
  assert.equal(dopo.codice, '2026/001');
  assert.equal(dopo.compensoTotaleCent, 600000);
  assert.equal(dopo.voci[0].provvigioneCent, prima.voci[0].provvigioneCent);
  assert.equal(dopo.voci[0].provvigioneCent, 180000);
  assert.equal(elencoZone(riaperta.archivio)[0].nome, 'Centro');
  assert.equal(leggiTabellaScaglioni(riaperta.archivio).length, 2);
});

test('una scrittura che fallisce non cambia nulla e non viene salvata', async () => {
  const app = await appConDati();
  const scrittureBase = app.driver.scritture;
  await assert.rejects(
    app.archivio.transazione(() => {
      app.archivio.esegui("UPDATE pratiche SET note = 'a metà' WHERE id = ?", [app.id]);
      throw new Error('guasto improvviso');
    }),
    /guasto improvviso/,
  );
  assert.equal(app.archivio.valore('SELECT note FROM pratiche WHERE id = ?', [app.id]), null);
  assert.equal(app.driver.scritture, scrittureBase);
});

test('se il salvataggio su disco fallisce l\'errore e\' esplicito', async () => {
  const app = await appConDati();
  app.driver.guasto = true;
  await assert.rejects(
    salvaPratica(app.archivio, pratica({ codice: '2026/002' }), []),
    (e) => e instanceof ErroreArchivio && e.codice === 'salvataggio',
  );
  assert.equal(app.archivio.statoSalvataggio.stato, 'errore');
  app.driver.guasto = false;
  await salvaPratica(app.archivio, pratica({ codice: '2026/003' }), []);
  assert.equal(app.archivio.statoSalvataggio.stato, 'salvato');
});

test('i dati non validi vengono rifiutati con messaggi per campo', async () => {
  const { archivio } = await appConDati();
  await assert.rejects(
    salvaPratica(archivio, pratica({ codice: '', immobile_indirizzo: '  ', data_pratica: '2026-02-30', compenso_venditore_cent: -5 }), []),
    (e) => e instanceof ErroreValidazione && ['codice', 'immobile_indirizzo', 'data_pratica', 'compenso_venditore_cent'].every((k) => k in e.campi),
  );
  await assert.rejects(
    salvaPratica(archivio, pratica({ codice: '2026/001' }), []),
    (e) => e instanceof ErroreValidazione && /già una pratica/.test(e.campi.codice),
  );
  await assert.rejects(
    salvaPratica(archivio, pratica({ codice: 'X', data_rogito: '2026-08-01' }), []),
    (e) => /precedente/.test(e.campi.data_rogito),
  );
  const [luca, giuseppe] = elencoCollaboratori(archivio);
  await assert.rejects(
    salvaPratica(archivio, pratica({ codice: 'Y' }), [{ collaboratore_id: luca.id, percentuale: 70 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]),
    (e) => /supera il 100/.test(e.campi.quote),
  );
});

test('dati mancanti ammessi: la pratica si salva e viene segnalata', async () => {
  const { archivio } = await appConDati();
  const id = await salvaPratica(archivio, pratica({ codice: '2026/010', data_rogito: null, prezzo_vendita_cent: null }), []);
  const p = modelloDi(archivio).perId.get(id);
  assert.ok(p.incompleta);
  assert.ok(p.mancanti.some((m) => m.codice === 'data_rogito'));
});

test('codice pratica progressivo per anno', async () => {
  const { archivio } = await appConDati();
  assert.equal(prossimoCodice(archivio, '2026-11-02'), '2026/002');
  assert.equal(prossimoCodice(archivio, '2027-01-02'), '2027/001');
  await salvaPratica(archivio, pratica({ codice: '2026/017' }), []);
  assert.equal(prossimoCodice(archivio, '2026-11-02'), '2026/018');
});

test('modifica pratica: sostituisce la ripartizione', async () => {
  const { archivio, id, luca, giuseppe } = await appConDati();
  await salvaPratica(archivio, { ...pratica(), id, note: 'rivista' }, [
    { collaboratore_id: luca.id, percentuale: 60 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]);
  const p = modelloDi(archivio).perId.get(id);
  assert.deepEqual(p.voci.map((v) => [v.collaboratoreId, v.fatturatoCent]), [[luca.id, 360000], [giuseppe.id, 240000]]);
  assert.equal(p.note, 'rivista');
});

test('collaboratori e zone in uso non si eliminano, si disattivano', async () => {
  const { archivio, luca, zona } = await appConDati();
  await assert.rejects(eliminaCollaboratore(archivio, luca.id), (e) => e instanceof ErroreOperazione && /non si può eliminare/.test(e.message));
  await assert.rejects(eliminaZona(archivio, zona), (e) => e instanceof ErroreOperazione);
  await aggiornaZona(archivio, zona, { attiva: false });
  assert.equal(elencoZone(archivio)[0].attiva, 0);
  const libero = await creaCollaboratore(archivio, { nome: 'Temporaneo' });
  await eliminaCollaboratore(archivio, libero);
  assert.ok(!elencoCollaboratori(archivio).some((c) => c.id === libero));
  await assert.rejects(creaCollaboratore(archivio, { nome: 'luca' }), (e) => /già/.test(e.campi.nome));
});

test('incassi: registrazione, modifica ed eliminazione aggiornano il modello', async () => {
  const { archivio, id } = await appConDati();
  const inc = await registraIncasso(archivio, { praticaId: id, data: '2026-10-06', importoCent: 366000, pagante: 'Venditore', metodo: 'Bonifico' });
  let p = modelloDi(archivio).perId.get(id);
  assert.equal(p.incassatoCent, 366000);
  assert.equal(p.daIncassareCent, 366000);
  await modificaIncasso(archivio, inc, { data: '2026-10-07', importoCent: 732000 });
  p = modelloDi(archivio).perId.get(id);
  assert.equal(p.daIncassareCent, 0);
  await eliminaIncasso(archivio, inc);
  assert.equal(modelloDi(archivio).perId.get(id).incassatoCent, 0);
  await assert.rejects(registraIncasso(archivio, { praticaId: id, data: '2026-10-06', importoCent: 0 }), ErroreValidazione);
  assert.ok(leggiRegistro(archivio).some((r) => r.tipo === 'incasso_eliminato'));
});

test('liquidazioni: righe per pratica, ricalcolo del da liquidare, eliminazione', async () => {
  const { archivio, id, luca, giuseppe } = await appConDati();
  await assert.rejects(
    registraLiquidazione(archivio, { collaboratoreId: giuseppe.id, data: '2026-10-30', righe: [{ praticaId: id, importoCent: 1000 }] }),
    (e) => e instanceof ErroreValidazione && /ripartizione/.test(e.campi.righe),
  );
  const liq = await registraLiquidazione(archivio, { collaboratoreId: luca.id, data: '2026-10-30', metodo: 'Bonifico', righe: [{ praticaId: id, importoCent: 100000 }] });
  let m = modelloDi(archivio);
  assert.equal(m.perId.get(id).daLiquidareCent, 80000);
  assert.equal(m.liquidazioni[0].totaleCent, 100000);
  assert.equal(m.liquidazioni[0].collaboratoreNome, 'Luca');
  // La pratica non si elimina e il collaboratore non si toglie dalla ripartizione finche' ci sono liquidazioni.
  await assert.rejects(eliminaPratica(archivio, id), (e) => /liquidazioni registrate/.test(e.message));
  await assert.rejects(salvaPratica(archivio, { ...pratica(), id }, [{ collaboratore_id: giuseppe.id, percentuale: 100 }]), (e) => e instanceof ErroreOperazione);
  await eliminaLiquidazione(archivio, liq);
  m = modelloDi(archivio);
  assert.equal(m.perId.get(id).daLiquidareCent, 180000);
});

test('elimina pratica: porta con se\' quote e incassi e lascia traccia nel registro', async () => {
  const { archivio, id } = await appConDati();
  await registraIncasso(archivio, { praticaId: id, data: '2026-10-06', importoCent: 1000 });
  const det = dettaglioEliminazionePratica(archivio, id);
  assert.deepEqual([det.incassi, det.quote, det.liquidazioni], [1, 1, 0]);
  await eliminaPratica(archivio, id);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM pratiche'), 0);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM quote'), 0);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM incassi'), 0);
  assert.ok(leggiRegistro(archivio).some((r) => r.tipo === 'pratica_eliminata' && r.dettaglio.includes('2026/001')));
});

test('scaglioni: salvataggio, rilettura e rifiuto di tabelle sbagliate', async () => {
  const { archivio, zona } = await appConDati();
  await assert.rejects(salvaTabellaScaglioni(archivio, null, [{ da_cent: 500, percentuale: 30 }]), ErroreValidazione);
  await assert.rejects(salvaTabellaScaglioni(archivio, null, [{ da_cent: 0, percentuale: 30 }, { da_cent: 0, percentuale: 40 }]), ErroreValidazione);
  await salvaTabellaScaglioni(archivio, zona, [{ da_cent: 0, percentuale: 20 }, { da_cent: 5000 * E, percentuale: 25 }]);
  assert.equal(leggiTabellaScaglioni(archivio, zona).length, 2);
  assert.equal(leggiTabellaScaglioni(archivio, null).length, 2); // quella predefinita e' rimasta
  await salvaTabellaScaglioni(archivio, zona, []);
  assert.equal(leggiTabellaScaglioni(archivio, zona).length, 0);
});

test('impostazioni salvate e riletta con i valori predefiniti per le mancanti', async () => {
  const app = await appConDati();
  assert.equal(leggiImpostazioni(app.archivio)['calcolo.metodo'], 'raggiunto');
  await scriviImpostazioni(app.archivio, { 'calcolo.metodo': 'progressivo', 'avvisi.giorniBackup': 3 });
  const riaperta = await riapri(app);
  const imp = leggiImpostazioni(riaperta.archivio);
  assert.equal(imp['calcolo.metodo'], 'progressivo');
  assert.equal(imp['avvisi.giorniBackup'], 3);
  assert.deepEqual(imp['iva.aliquote'], [22, 10, 4, 0]);
  await assert.rejects(scriviImpostazioni(riaperta.archivio, { 'inventata': 1 }));
});

test('cambiare il metodo di calcolo cambia davvero le provvigioni', async () => {
  const app = await appConDati();
  const { archivio, zona, luca } = app;
  await salvaPratica(archivio, pratica({ codice: '2026/002', zona_id: zona, data_rogito: '2026-10-20', compenso_venditore_cent: 7000 * E, compenso_acquirente_cent: 0 }), [{ collaboratore_id: luca.id, percentuale: 100 }]);
  // cumulo di Luca in ottobre: 6.000 + 7.000 = 13.000 -> secondo scaglione (35%)
  assert.equal(modelloDi(archivio).cumuli[0].provvigioneCent, 455000);
  await scriviImpostazioni(archivio, { 'calcolo.metodo': 'progressivo' });
  assert.equal(modelloDi(archivio).cumuli[0].provvigioneCent, 405000);
});

// ---------------------------------------------------------------- backup e ripristino

test('backup, modifica, ripristino: si torna ai dati della copia e resta la copia di sicurezza', async () => {
  const app = await appConDati();
  const copia = await creaBackup(app, 'manuale');
  await salvaPratica(app.archivio, pratica({ codice: '2026/050' }), []);
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM pratiche'), 2);
  const r = await ripristinaBackup(app, copia.id);
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM pratiche'), 1);
  assert.equal(r.esito.riepilogo.pratiche, 1);
  const copie = await elencoBackup(app);
  assert.deepEqual(copie.map((c) => c.tipo).sort(), ['manuale', 'pre-ripristino']);
  // la copia di sicurezza contiene lo stato precedente al ripristino (2 pratiche) e permette di annullare
  const sicurezza = copie.find((c) => c.tipo === 'pre-ripristino');
  await ripristinaBackup(app, sicurezza.id);
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM pratiche'), 2);
  assert.ok(leggiRegistro(app.archivio).some((x) => x.tipo === 'ripristino'));
  // dopo il ripristino i dati sono anche su disco
  const riaperta = await riapri(app);
  assert.equal(riaperta.archivio.valore('SELECT COUNT(*) FROM pratiche'), 2);
});

test('esportazione e importazione di un archivio', async () => {
  const origine = await appConDati();
  const esp = await esportaArchivio(origine);
  assert.ok(esp.salvato);
  assert.match(esp.nome, /^GestioneImmobiliare_esportazione_\d{4}-\d{2}-\d{2}_\d{4}\.sqlite$/);
  const file = origine.driver.ultimaEsportazione;

  const destinazione = await nuovaApp();
  destinazione.driver.fileDaScegliere = { nome: 'miei-dati.sqlite', bytes: file.bytes };
  const letto = await leggiFileDaImportare(destinazione);
  assert.ok(letto.esito.valido);
  assert.equal(letto.esito.riepilogo.pratiche, 1);
  await applicaImportazione(destinazione, letto.bytes);
  assert.equal(destinazione.archivio.valore('SELECT COUNT(*) FROM pratiche'), 1);
  assert.ok((await elencoBackup(destinazione)).some((c) => c.tipo === 'pre-importazione'));
});

test('importazione: file non validi vengono rifiutati prima di toccare i dati', async () => {
  const app = await appConDati();
  const SQL = await motore();
  const testo = new TextEncoder().encode('questo non e\' un database '.repeat(20));
  assert.match(ispezionaBytes(SQL, testo).motivo, /non è un archivio|non e' un archivio/);
  assert.match(ispezionaBytes(SQL, new Uint8Array(10)).motivo, /vuoto|piccolo/);
  // un database SQLite valido ma di un altro programma
  const altro = new SQL.Database();
  altro.run('CREATE TABLE cose (a)');
  const esito = ispezionaBytes(SQL, altro.export());
  assert.equal(esito.valido, false);
  assert.match(esito.motivo, /non appartiene/);
  // schema piu' recente
  const futuro = new SQL.Database();
  migra(futuro);
  futuro.run('PRAGMA user_version = 99');
  assert.match(ispezionaBytes(SQL, futuro.export()).motivo, /più recente|piu' recente/);
  await assert.rejects(app.archivio.sostituisciCon(testo), /archivio/);
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM pratiche'), 1);
});

test('un file danneggiato non viene aperto in silenzio', async () => {
  const app = await appConDati();
  const SQL = await motore();
  const intero = app.driver.byte.slice();
  assert.ok(intero.length > 8192, 'il database di prova dovrebbe avere piu\' pagine');
  // copia interrotta a meta' (disco pieno, trasferimento incompleto)
  const troncato = intero.slice(0, Math.floor(intero.length / 2));
  // contenuto sovrascritto nelle pagine dei dati
  const sporco = intero.slice();
  for (let i = 4096; i < sporco.length; i++) sporco[i] = (sporco[i] + 97) & 0xff;
  for (const [nome, bytes] of [['troncato', troncato], ['sporco', sporco]]) {
    const driver = new DriverMemoria();
    driver.byte = bytes;
    await assert.rejects(new Archivio(SQL, driver).apri(), (e) => e instanceof ErroreArchivio && e.codice === 'illeggibile', nome);
    assert.equal(ispezionaBytes(SQL, bytes).valido, false, nome);
  }
});

test('azzeramento: copia di sicurezza, archivio vuoto, collaboratori iniziali', async () => {
  const app = await appConDati();
  const r = await azzeraArchivio(app);
  assert.ok(r.sicurezza.id);
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM pratiche'), 0);
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM zone'), 0);
  assert.deepEqual(elencoCollaboratori(app.archivio).map((c) => c.nome), ['Luca', 'Giuseppe']);
  const sic = (await elencoBackup(app)).find((c) => c.tipo === 'pre-azzeramento');
  await ripristinaBackup(app, sic.id); // si puo' tornare indietro
  assert.equal(app.archivio.valore('SELECT COUNT(*) FROM pratiche'), 1);
});

test('backup automatico: uno al giorno e solo se ci sono dati; potatura', async () => {
  const vuota = await nuovaApp();
  assert.equal(await backupAutomatico(vuota), null);
  const app = await appConDati();
  assert.ok(await backupAutomatico(app));
  assert.equal(await backupAutomatico(app), null); // gia' fatto oggi
  assert.equal((await elencoBackup(app)).filter((c) => c.tipo === 'automatico').length, 1);
  await scriviImpostazioni(app.archivio, { 'backup.massimoAutomatici': 2 });
  for (let i = 1; i <= 4; i++) await app.driver.creaCopia(app.archivio.esporta(), 'automatico', `2026-01-0${i}T10:00:00.000Z`);
  await app.driver.creaCopia(app.archivio.esporta(), 'manuale', '2025-01-01T10:00:00.000Z');
  const eliminate = await potaCopie(app);
  assert.equal(eliminate, 3);
  const dopo = await elencoBackup(app);
  assert.equal(dopo.filter((c) => c.tipo === 'automatico').length, 2);
  assert.equal(dopo.filter((c) => c.tipo === 'manuale').length, 1); // le manuali non si potano mai
});

test('ultimo backup: considera copie e impostazioni', async () => {
  const app = await appConDati();
  assert.equal(await ultimoBackup(app), null);
  const c = await creaBackup(app, 'manuale');
  assert.equal(await ultimoBackup(app), c.creatoIl);
});

// ---------------------------------------------------------------- integrita'

test('verifica integrita\': archivio sano', async () => {
  const { archivio } = await appConDati();
  const r = verificaIntegrita(archivio, modelloDi(archivio));
  assert.ok(r.ok);
  assert.ok(r.controlli.every((c) => c.ok), JSON.stringify(r.controlli));
  assert.equal(r.problemi.length, 0);
});

test('verifica integrita\': segnala incoerenze nei dati', async () => {
  const { archivio, id, luca } = await appConDati();
  // Incassi oltre il dovuto e liquidazione oltre il maturato (situazioni possibili ma da controllare)
  await registraIncasso(archivio, { praticaId: id, data: '2026-10-06', importoCent: 900000 });
  await registraLiquidazione(archivio, { collaboratoreId: luca.id, data: '2026-10-30', righe: [{ praticaId: id, importoCent: 200000 }] });
  const r = verificaIntegrita(archivio, modelloDi(archivio));
  assert.ok(r.ok); // sono avvisi, non errori
  assert.deepEqual(r.problemi.map((p) => p.codice).sort(), ['incassi_eccedenti', 'liquidato_oltre_maturato']);
  assert.equal(r.avvisi, 2);
  // Una ripartizione oltre il 100% scavalcando l'interfaccia e' un errore
  await archivio.transazione(() => archivio.esegui('INSERT INTO quote (pratica_id, collaboratore_id, percentuale) VALUES (?, 2, 50)', [id]));
  const r2 = verificaIntegrita(archivio, modelloDi(archivio));
  assert.ok(!r2.ok);
  assert.ok(r2.problemi.some((p) => p.codice === 'ripartizione_oltre_100'));
});

test('verifica integrita\': scaglioni scritti male sono un errore', async () => {
  const { archivio } = await appConDati();
  await archivio.transazione(() => archivio.esegui('DELETE FROM scaglioni WHERE da_cent = 0'));
  const r = verificaIntegrita(archivio, modelloDi(archivio));
  assert.ok(r.problemi.some((p) => p.codice === 'scaglioni_non_validi'));
});

// ---------------------------------------------------------------- esportazioni CSV

test('CSV per Excel italiano', async () => {
  const { archivio, id } = await appConDati();
  await registraIncasso(archivio, { praticaId: id, data: '2026-10-06', importoCent: 123456, note: 'ha detto "ok"; poi' });
  const m = modelloDi(archivio);
  const csv = csvPratiche(m);
  assert.ok(csv.startsWith('﻿Codice;Stato;'));
  assert.ok(csv.includes('2026/001;Conclusa;01/09/2026;05/10/2026;Centro;Via Roma 1;Minturno;Appartamento;150000,00;'));
  assert.ok(csv.includes('Luca 100%'));
  assert.ok(csvIncassi(m).includes('"ha detto ""ok""; poi"'));
  assert.ok(csvLiquidazioni(m).startsWith('﻿Data;Collaboratore;'));
  const voci = m.pratiche.flatMap((p) => p.voci.map((v) => ({ p, v })));
  assert.ok(csvProvvigioni(m, voci).includes('1800,00'));
});
