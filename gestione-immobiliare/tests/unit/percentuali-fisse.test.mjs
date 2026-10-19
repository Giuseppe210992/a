// Mese della proposta e percentuali fisse (il capo il 15% e la segretaria il 4% del COMPENSO TOTALE della pratica, senza IVA,
// in qualsiasi zona e a prescindere da quanto prendono i collaboratori) e conguaglio del cumulo.
// I numeri attesi sono calcolati a mano, a partire dagli scaglioni dell'agenzia: 5% fino a 2.600 €, 8% fino a 5.200 €,
// 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nuovaApp, modelloDi } from './helpers-db.mjs';
import { salvaPratica, registraIncasso } from '../../src/js/data/repo/pratiche.js';
import {
  creaZona, creaCollaboratore, elencoCollaboratori, aggiornaCollaboratore, salvaRipartizioneZona, ripartizioneAutomatica,
} from '../../src/js/data/repo/anagrafiche.js';
import { scriviImpostazioni } from '../../src/js/data/repo/impostazioni.js';
import { ErroreValidazione } from '../../src/js/data/repo/errori.js';
import { calcolaModello } from '../../src/js/data/calc/modello.js';
import { conguaglio } from '../../src/js/data/stima.js';
import { leggiImpostazioni, opzioniCalcolo } from '../../src/js/data/repo/impostazioni.js';
import { oggi } from '../../src/js/core/dates.js';
import { datiBase, aggiungiPratica } from './helpers.mjs';

const E = 100;
const mese = oggi().slice(0, 7); // 2026-10

async function appCompleta() {
  const app = await nuovaApp(undefined, { conPercentualiFisse: true });
  const [luca, giuseppe, capo, segretaria] = elencoCollaboratori(app.archivio);
  const centro = await creaZona(app.archivio, { nome: 'Centro' });
  await salvaRipartizioneZona(app.archivio, centro, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  const collina = await creaZona(app.archivio, { nome: 'Collina' });
  await salvaRipartizioneZona(app.archivio, collina, [{ collaboratore_id: luca.id, percentuale: 60 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]);
  return { ...app, luca, giuseppe, capo, segretaria, centro, collina };
}
const quoteDi = (archivio, zona) => archivio.tutti('SELECT collaboratore_id, percentuale FROM zone_quote WHERE zona_id = ? ORDER BY collaboratore_id', [zona]);
/** Pratica nuova: ciascuna parte paga con bonifico (IVA 22% compresa) l'importo indicato. */
const nuova = (app, zona, { vend, acq, proposta = mese, ...altro }) => salvaPratica(app.archivio, {
  zona_id: zona, prezzo_vendita_cent: 200000 * E, venditore: 'Mario Rossi', acquirente: 'Anna Bianchi', mese_proposta: proposta,
  venditore_bonifico_cent: vend * E, acquirente_bonifico_cent: acq * E, aliquota_iva: 22, ...altro,
}, quoteDi(app.archivio, zona));

test('il primo avvio crea il capo (15%) e la segretaria (4%) accanto a Luca e Giuseppe', async () => {
  const { archivio } = await nuovaApp(undefined, { conPercentualiFisse: true });
  assert.deepEqual(elencoCollaboratori(archivio).map((c) => [c.nome, c.percentuale_fissa]), [['Luca', null], ['Giuseppe', null], ['Capo', 15], ['Segretaria', 4]]);
});

test('Luca solo: 10.000 € di compenso → Luca 15% = 1.500 €; il capo prende il 15% del compenso (1.500 €) e la segretaria il 4% (400 €)', async () => {
  const app = await appCompleta();
  // 6.100 per parte con IVA 22% compresa = 5.000 + 1.100 → compenso senza IVA 10.000 €
  const id = await nuova(app, app.centro, { vend: 6100, acq: 6100 });
  const p = modelloDi(app.archivio).perId.get(id);
  assert.equal(p.compensoTotaleCent, 10000 * E);
  const voce = (chi) => p.voci.find((v) => v.collaboratoreId === chi.id);
  assert.equal(voce(app.luca).provvigioneCent, 1500 * E);
  assert.equal(voce(app.capo).provvigioneCent, 1500 * E, '15% di 10.000, non di quanto prende Luca');
  assert.equal(voce(app.segretaria).provvigioneCent, 400 * E, '4% di 10.000');
  assert.equal(voce(app.capo).baseCent, 10000 * E);
  assert.deepEqual([voce(app.capo).fissa, voce(app.capo).fatturatoCent, voce(app.capo).quotaPct], [true, 0, 0]);
  assert.equal(p.provvigioniCent, (1500 + 1500 + 400) * E, 'totale della pratica: 3.400 €');
  // tutto è già pagato: nulla da liquidare
  assert.deepEqual([p.maturateCent, p.liquidateCent, p.daLiquidareCent], [3400 * E, 3400 * E, 0]);
  // margine dell'agenzia: compensi − tutte le provvigioni = 10.000 − 3.400
  const m = modelloDi(app.archivio);
  const margine = m.pratiche.reduce((s, x) => s + x.voci.reduce((t, v) => t + v.fatturatoCent - v.provvigioneCent, 0), 0);
  assert.equal(margine, 6600 * E);
  const riep = Object.fromEntries(m.collaboratori.map((c) => [c.nome, [c.maturateCent, c.pratiche, c.fatturatoCent, c.percentualeFissa]]));
  assert.deepEqual(riep.Capo, [1500 * E, 0, 0, 15]);
  assert.deepEqual(riep.Segretaria, [400 * E, 0, 0, 4]);
  assert.deepEqual(riep.Luca, [1500 * E, 1, 10000 * E, null]);
});
test('zona divisa 60/40: la percentuale si calcola sul compenso intero e poi si divide; capo e segretaria prendono comunque la percentuale sul compenso totale', async () => {
  const app = await appCompleta();
  const id = await nuova(app, app.collina, { vend: 6100, acq: 6100 }); // compenso 10.000 €
  const p = modelloDi(app.archivio).perId.get(id);
  const prov = (chi) => p.voci.find((v) => v.collaboratoreId === chi.id).provvigioneCent;
  // il cumulo è del compenso intero: 10.000 € → 4° scaglione (15%) = 1.500 €, poi diviso 60/40: Luca 900 €, Giuseppe 600 €
  assert.equal(prov(app.luca), 900 * E);
  assert.equal(prov(app.giuseppe), 600 * E);
  // capo e segretaria: 15% e 4% di 10.000 €, non di 980 €
  assert.equal(prov(app.capo), 1500 * E);
  assert.equal(prov(app.segretaria), 400 * E);
});
test('in qualsiasi zona: stessa percentuale sul compenso; arrotondamento al centesimo pratica per pratica (mezzi verso l\'alto)', () => {
  const dati = datiBase();
  dati.collaboratori.push({ id: 3, nome: 'Capo', attivo: 1, colore: 3, percentuale_fissa: 15 }, { id: 4, nome: 'Segretaria', attivo: 1, colore: 4, percentuale_fissa: 4 });
  aggiungiPratica(dati, 1, { zona_id: 2, compenso_venditore_cent: 3000 * E, compenso_acquirente_cent: 3000 * E, aliquota_iva: 0 }, [[2, 100]]);
  // compenso 111,10 € (IVA 0%): 15% = 16,665 → 16,67; 4% = 4,444 → 4,44
  aggiungiPratica(dati, 2, { zona_id: 1, data_rogito: '2026-09-10', compenso_venditore_cent: 11110, compenso_acquirente_cent: 0, aliquota_iva: 0 }, [[1, 100]]);
  const m = calcolaModello(dati);
  const voce = (id, collab) => m.perId.get(id).voci.find((v) => v.collaboratoreId === collab);
  assert.equal(voce(1, 3).provvigioneCent, 900 * E, 'capo: 15% di 6.000 € in zona B');
  assert.equal(voce(1, 4).provvigioneCent, 240 * E, 'segretaria: 4% di 6.000 €');
  assert.equal(voce(2, 3).provvigioneCent, 1667);
  assert.equal(voce(2, 4).provvigioneCent, 444);
});
test('pratica non conclusa: niente quota per capo e segretaria; anche senza ripartizione prendono la loro percentuale sul compenso', async () => {
  const app = await appCompleta();
  const inCorso = await salvaPratica(app.archivio, { stato: 'in_corso', zona_id: app.centro, venditore_bonifico_cent: 6100 * E, venditore: 'A', acquirente: 'B' }, quoteDi(app.archivio, app.centro));
  const senzaQuote = await salvaPratica(app.archivio, { zona_id: app.centro, venditore_bonifico_cent: 6100 * E, venditore: 'A', acquirente: 'B' }, []);
  const m = modelloDi(app.archivio);
  assert.equal(m.perId.get(inCorso).voci.filter((v) => v.fissa).length, 0);
  assert.deepEqual(m.perId.get(senzaQuote).voci.filter((v) => v.fissa).map((v) => v.provvigioneCent), [750 * E, 200 * E], 'compenso 5.000 €: 15% = 750, 4% = 200');
});
test('maturazione all\'incasso: anche capo e segretaria maturano in proporzione a quanto è stato incassato', async () => {
  const app = await appCompleta();
  await scriviImpostazioni(app.archivio, { 'calcolo.maturazione': 'incasso' });
  // pratica "vecchia" (compenso senza IVA 10.000 + IVA 2.200 = 12.200 da incassare): nulla incassato
  const id = await salvaPratica(app.archivio, { zona_id: app.centro, compenso_venditore_cent: 5000 * E, compenso_acquirente_cent: 5000 * E, aliquota_iva: 22, mese_proposta: mese, venditore: 'A', acquirente: 'B' }, quoteDi(app.archivio, app.centro));
  const dopoDati = () => modelloDi(app.archivio).perId.get(id);
  assert.equal(dopoDati().maturateCent, 0);
  await registraIncasso(app.archivio, { praticaId: id, data: oggi(), importoCent: 6100 * E }); // metà del dovuto
  const p = dopoDati();
  const m = (chi) => p.voci.find((v) => v.collaboratoreId === chi.id).maturataCent;
  assert.deepEqual([m(app.luca), m(app.capo), m(app.segretaria)], [750 * E, 750 * E, 200 * E], 'metà di 1.500, 1.500 e 400');
});
test('modificare la pratica ricalcola capo e segretaria sul nuovo compenso', async () => {
  const app = await appCompleta();
  const id = await nuova(app, app.centro, { vend: 6100, acq: 6100 });
  await salvaPratica(app.archivio, { id, codice: '2026/001', zona_id: app.centro, prezzo_vendita_cent: 250000 * E, venditore: 'Mario Rossi', acquirente: 'Anna Bianchi', mese_proposta: mese, venditore_bonifico_cent: 3050 * E, acquirente_bonifico_cent: 3050 * E, aliquota_iva: 22 }, quoteDi(app.archivio, app.centro));
  const p = modelloDi(app.archivio).perId.get(id); // compenso 5.000 €
  const v = (chi) => p.voci.find((x) => x.collaboratoreId === chi.id).provvigioneCent;
  assert.deepEqual([v(app.luca), v(app.capo), v(app.segretaria)], [400 * E, 750 * E, 200 * E]);
});
test('chi prende una percentuale fissa non entra nelle quote, nelle ripartizioni delle zone né nell\'"unico collaboratore"', async () => {
  const app = await appCompleta();
  await assert.rejects(salvaRipartizioneZona(app.archivio, app.centro, [{ collaboratore_id: app.capo.id, percentuale: 100 }]), (e) => e instanceof ErroreValidazione && /percentuale fissa/.test(e.campi.quote));
  await assert.rejects(salvaPratica(app.archivio, { zona_id: app.centro, venditore_bonifico_cent: 1000 * E, venditore: 'A', acquirente: 'B' }, [{ collaboratore_id: app.segretaria.id, percentuale: 100 }]), (e) => e instanceof ErroreValidazione && /percentuale fissa/.test(e.campi.quote));
  // con Giuseppe disattivato resta solo Luca come collaboratore a scaglioni: tutto a lui, senza contare capo e segretaria
  await aggiornaCollaboratore(app.archivio, app.giuseppe.id, { attivo: false });
  const altra = await creaZona(app.archivio, { nome: 'Porto' });
  assert.deepEqual(ripartizioneAutomatica(app.archivio, altra), { origine: 'unico', quote: [{ collaboratore_id: app.luca.id, percentuale: 100 }] });
});

test('la percentuale fissa si imposta tra 0 (escluso) e 100, con al massimo due decimali; non si assegna a chi ha già pratiche', async () => {
  const app = await appCompleta();
  const rifiuta = (valore) => assert.rejects(creaCollaboratore(app.archivio, { nome: `X${valore}`, percentualeFissa: valore }), (e) => e instanceof ErroreValidazione && !!e.campi.percentualeFissa);
  for (const v of [0, -5, 100.01, 15.555, 'abc']) await rifiuta(v);
  const nuovo = await creaCollaboratore(app.archivio, { nome: 'Amministrazione', percentualeFissa: 2.5 });
  assert.equal(elencoCollaboratori(app.archivio).find((c) => c.id === nuovo).percentuale_fissa, 2.5);
  await aggiornaCollaboratore(app.archivio, app.capo.id, { percentualeFissa: 20 });
  assert.equal(elencoCollaboratori(app.archivio).find((c) => c.id === app.capo.id).percentuale_fissa, 20);
  await aggiornaCollaboratore(app.archivio, app.capo.id, { percentualeFissa: null }); // torna un collaboratore normale
  assert.equal(elencoCollaboratori(app.archivio).find((c) => c.id === app.capo.id).percentuale_fissa, null);
  // Luca lavora già a scaglioni su una pratica: non può passare a una percentuale fissa
  await nuova(app, app.centro, { vend: 6100, acq: 6100 });
  await assert.rejects(aggiornaCollaboratore(app.archivio, app.luca.id, { percentualeFissa: 10 }), (e) => e instanceof ErroreValidazione && !!e.campi.percentualeFissa);
});

test('cambiando la percentuale del capo le provvigioni si ricalcolano (come per gli scaglioni, anche sulle pratiche passate)', async () => {
  const app = await appCompleta();
  const id = await nuova(app, app.centro, { vend: 6100, acq: 6100 });
  await aggiornaCollaboratore(app.archivio, app.capo.id, { percentualeFissa: 10 });
  assert.equal(modelloDi(app.archivio).perId.get(id).voci.find((v) => v.collaboratoreId === app.capo.id).provvigioneCent, 1000 * E);
});
test('il mese della proposta decide il cumulo: due pratiche dello stesso mese si cumulano, di mesi diversi no', async () => {
  const app = await nuovaApp();
  const [luca] = elencoCollaboratori(app.archivio);
  const zona = await creaZona(app.archivio, { nome: 'Centro' });
  await salvaRipartizioneZona(app.archivio, zona, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  // ognuna 5.000 € di compenso (6.100 con IVA da una parte sola)
  const a = await nuova({ archivio: app.archivio }, zona, { vend: 6100, acq: 0, proposta: '2026-09' });
  const b = await nuova({ archivio: app.archivio }, zona, { vend: 6100, acq: 0, proposta: '2026-10' });
  let m = modelloDi(app.archivio);
  // inserite oggi (ottobre) ma la prima è di una proposta di settembre: non si cumulano → 8% ciascuna = 400 + 400
  assert.deepEqual([m.perId.get(a).meseRif, m.perId.get(b).meseRif], ['2026-09', '2026-10']);
  assert.deepEqual([m.perId.get(a).provvigioniCent, m.perId.get(b).provvigioniCent], [400 * E, 400 * E]);
  assert.equal(m.cumuli.length, 2);
  // stesso mese: 10.000 € di cumulo → 15% su tutto = 750 + 750
  const c = await nuova({ archivio: app.archivio }, zona, { vend: 6100, acq: 0, proposta: '2026-10' });
  m = modelloDi(app.archivio);
  assert.deepEqual([m.perId.get(b).provvigioniCent, m.perId.get(c).provvigioniCent], [750 * E, 750 * E]);
  assert.equal(m.cumuli.find((x) => x.mese === '2026-10').fatturatoCent, 10000 * E);
  assert.equal(m.cumuli.find((x) => x.mese === '2026-09').fatturatoCent, 5000 * E);
  // la data mostrata è il mese, il giorno vero di inserimento resta quello di oggi
  assert.equal(m.perId.get(a).dataEtichetta, 'settembre 2026');
  assert.equal(m.perId.get(a).dataRif, '2026-09-01');
  assert.equal(m.perId.get(a).data_pratica, oggi());
});

test('mese della proposta: per le pratiche nuove vale di default il mese di oggi, per le vecchie resta vuoto; il formato è controllato', async () => {
  const app = await nuovaApp();
  const nuovaSenza = await salvaPratica(app.archivio, { venditore_bonifico_cent: 1220 * E, venditore: 'A', acquirente: 'B' }, []);
  assert.equal(app.archivio.valore('SELECT mese_proposta FROM pratiche WHERE id = ?', [nuovaSenza]), mese);
  const vecchia = await salvaPratica(app.archivio, { codice: 'V/1', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-09-10', compenso_venditore_cent: 1000 * E }, []);
  assert.equal(app.archivio.valore('SELECT mese_proposta FROM pratiche WHERE id = ?', [vecchia]), null);
  assert.equal(modelloDi(app.archivio).perId.get(vecchia).meseRif, '2026-09', 'le vecchie contano dal rogito');
  for (const brutto of ['2026-13', 'ottobre', '2026-1', '26-10']) {
    await assert.rejects(salvaPratica(app.archivio, { venditore_bonifico_cent: 1000, mese_proposta: brutto }, []), (e) => e instanceof ErroreValidazione && !!e.campi.mese_proposta, brutto);
  }
  // riscrivere una pratica letta dal database non cambia il suo mese
  const riga = app.archivio.uno('SELECT * FROM pratiche WHERE id = ?', [nuovaSenza]);
  await salvaPratica(app.archivio, { ...riga, note: 'ritoccata' }, []);
  assert.equal(app.archivio.valore('SELECT mese_proposta FROM pratiche WHERE id = ?', [nuovaSenza]), mese);
});

// ---------------------------------------------------------------- conguaglio quando la pratica si cumula con altre del mese

test('cumulo: la nuova pratica fa salire lo scaglione, le vecchie guadagnano la differenza; il conguaglio dà già pagato, differenza, nuova e totale', async () => {
  const app = await nuovaApp();
  const [luca] = elencoCollaboratori(app.archivio);
  const zona = await creaZona(app.archivio, { nome: 'Centro' });
  await salvaRipartizioneZona(app.archivio, zona, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  const opz = opzioniCalcolo(leggiImpostazioni(app.archivio));
  const bozza = (compensoConIva) => ({
    zona_id: zona, venditore: 'A', acquirente: 'B', mese_proposta: mese, compensi_da_pagamenti: 1, aliquota_iva: 22, venditore_bonifico_cent: compensoConIva * E,
  });
  const quote = quoteDi(app.archivio, zona);
  // prima pratica del mese: nessun cumulo con altre
  assert.deepEqual(conguaglio(app.archivio, bozza(6100), quote, opz), []);
  await salvaPratica(app.archivio, bozza(6100), quote); // 5.000 € → 8% = 400 € già pagati
  // seconda: altri 5.000 € → cumulo 10.000 € → 15%: la vecchia passa da 400 a 750, la nuova prende 750
  const [r] = conguaglio(app.archivio, bozza(6100), quote, opz);
  assert.equal(r.nome, 'Luca');
  assert.equal(r.pratichePrecedenti, 1);
  assert.deepEqual([r.giaPagatoCent, r.differenzaCent, r.nuovaCent, r.totaleCent], [400 * E, 350 * E, 750 * E, 1500 * E]);
  // seconda più piccola (1.220 con IVA = 1.000 €): cumulo 6.000 € → 11%: vecchia 5.000 × 11% = 550 (+150), nuova 110
  const [r2] = conguaglio(app.archivio, bozza(1220), quote, opz);
  assert.deepEqual([r2.giaPagatoCent, r2.differenzaCent, r2.nuovaCent, r2.totaleCent], [400 * E, 150 * E, 110 * E, 660 * E]);
  // una pratica di un altro mese non si cumula: nessun conguaglio
  assert.deepEqual(conguaglio(app.archivio, { ...bozza(6100), mese_proposta: '2026-09' }, quote, opz), []);
});
