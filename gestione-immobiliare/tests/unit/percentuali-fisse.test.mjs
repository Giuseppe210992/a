// Mese della proposta e percentuali fisse (il capo il 15% e la segretaria il 4% del totale delle provvigioni, in qualsiasi zona).
// I numeri attesi sono calcolati a mano, a partire dagli scaglioni dell'agenzia: 5% fino a 2.600 €, 8% fino a 5.200 €,
// 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nuovaApp, modelloDi } from './helpers-db.mjs';
import { salvaPratica, registraIncasso, registraLiquidazione } from '../../src/js/data/repo/pratiche.js';
import {
  creaZona, creaCollaboratore, elencoCollaboratori, aggiornaCollaboratore, salvaRipartizioneZona, ripartizioneAutomatica,
} from '../../src/js/data/repo/anagrafiche.js';
import { scriviImpostazioni } from '../../src/js/data/repo/impostazioni.js';
import { ErroreValidazione } from '../../src/js/data/repo/errori.js';
import { calcolaModello } from '../../src/js/data/calc/modello.js';
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

test('Luca solo: 10.000 € di compenso → 15% = 1.500 €; il capo prende il 15% di 1.500 (225 €) e la segretaria il 4% (60 €)', async () => {
  const app = await appCompleta();
  // 6.100 per parte con IVA 22% compresa = 5.000 + 1.100 → compenso senza IVA 10.000 €
  const id = await nuova(app, app.centro, { vend: 6100, acq: 6100 });
  const p = modelloDi(app.archivio).perId.get(id);
  assert.equal(p.compensoTotaleCent, 10000 * E);
  const voce = (chi) => p.voci.find((v) => v.collaboratoreId === chi.id);
  assert.equal(voce(app.luca).provvigioneCent, 1500 * E);
  assert.equal(voce(app.capo).provvigioneCent, 225 * E);
  assert.equal(voce(app.segretaria).provvigioneCent, 60 * E);
  assert.equal(voce(app.capo).baseCent, 1500 * E, 'la percentuale si calcola sul totale delle provvigioni dei collaboratori');
  assert.deepEqual([voce(app.capo).fissa, voce(app.capo).fatturatoCent, voce(app.capo).quotaPct], [true, 0, 0]);
  assert.equal(p.provvigioniCent, (1500 + 225 + 60) * E, 'totale della pratica: 1.785 €');
  assert.equal(p.maturateCent, 1785 * E);
  assert.equal(p.daLiquidareCent, 1785 * E);
  // margine dell'agenzia: compensi − tutte le provvigioni (anche del capo e della segretaria) = 10.000 − 1.785
  const m = modelloDi(app.archivio);
  const margine = m.pratiche.reduce((s, x) => s + x.voci.reduce((t, v) => t + v.fatturatoCent - v.provvigioneCent, 0), 0);
  assert.equal(margine, 8215 * E);
  // nel riepilogo per collaboratore
  const riep = Object.fromEntries(m.collaboratori.map((c) => [c.nome, [c.maturateCent, c.pratiche, c.fatturatoCent, c.percentualeFissa]]));
  assert.deepEqual(riep.Capo, [225 * E, 0, 0, 15]);
  assert.deepEqual(riep.Segretaria, [60 * E, 0, 0, 4]);
  assert.deepEqual(riep.Luca, [1500 * E, 1, 10000 * E, null]);
});

test('zona divisa 60/40: ognuno ha il suo scaglione; capo e segretaria prendono la percentuale sul totale delle provvigioni', async () => {
  const app = await appCompleta();
  const id = await nuova(app, app.collina, { vend: 6100, acq: 6100 }); // compenso 10.000 €
  const p = modelloDi(app.archivio).perId.get(id);
  const prov = (chi) => p.voci.find((v) => v.collaboratoreId === chi.id).provvigioneCent;
  // Luca 6.000 € → 3° scaglione (da 5.200,01 a 7.800: 11%) = 660 €; Giuseppe 4.000 € → 2° scaglione (8%) = 320 €
  assert.equal(prov(app.luca), 660 * E);
  assert.equal(prov(app.giuseppe), 320 * E);
  // totale 980 €: capo 15% = 147,00 €, segretaria 4% = 39,20 €
  assert.equal(prov(app.capo), 147 * E);
  assert.equal(prov(app.segretaria), 3920);
});

test('in qualsiasi zona: stessa percentuale; arrotondamento al centesimo pratica per pratica (mezzi verso l\'alto)', () => {
  const dati = datiBase();
  dati.collaboratori.push({ id: 3, nome: 'Capo', attivo: 1, colore: 3, percentuale_fissa: 15 }, { id: 4, nome: 'Segretaria', attivo: 1, colore: 4, percentuale_fissa: 4 });
  // pratica in zona B di Giuseppe, compenso 6.000 € → cumulo 6.000 → 30% = 1.800 €
  aggiungiPratica(dati, 1, { zona_id: 2, compenso_venditore_cent: 3000 * E, compenso_acquirente_cent: 3000 * E }, [[2, 100]]);
  // pratica in zona A di Luca con un compenso che dà una provvigione di 33,33 € (111,10 × 30% = 33,33)
  aggiungiPratica(dati, 2, { zona_id: 1, data_rogito: '2026-09-10', compenso_venditore_cent: 11110, compenso_acquirente_cent: 0, aliquota_iva: 0 }, [[1, 100]]);
  const m = calcolaModello(dati);
  const voce = (id, collab) => m.perId.get(id).voci.find((v) => v.collaboratoreId === collab);
  assert.equal(voce(1, 2).provvigioneCent, 1800 * E);
  assert.equal(voce(1, 3).provvigioneCent, 270 * E, 'capo: 15% di 1.800 € in zona B');
  assert.equal(voce(1, 4).provvigioneCent, 72 * E, 'segretaria: 4% di 1.800 €');
  assert.equal(voce(2, 1).provvigioneCent, 3333);
  assert.equal(voce(2, 3).provvigioneCent, 500, '15% di 33,33 € = 5,0 € (4,9995 → 5,00)');
  assert.equal(voce(2, 4).provvigioneCent, 133, '4% di 33,33 € = 1,3332 → 1,33');
});

test('pratica non conclusa o senza provvigioni: niente quota per capo e segretaria', async () => {
  const app = await appCompleta();
  const inCorso = await salvaPratica(app.archivio, { stato: 'in_corso', zona_id: app.centro, venditore_bonifico_cent: 6100 * E, venditore: 'A', acquirente: 'B' }, quoteDi(app.archivio, app.centro));
  const senzaQuote = await salvaPratica(app.archivio, { zona_id: app.centro, venditore_bonifico_cent: 6100 * E, venditore: 'A', acquirente: 'B' }, []);
  const m = modelloDi(app.archivio);
  assert.equal(m.perId.get(inCorso).voci.filter((v) => v.fissa).length, 0);
  assert.equal(m.perId.get(senzaQuote).voci.filter((v) => v.fissa).length, 0, 'nessuna provvigione ai collaboratori: niente base');
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
  assert.deepEqual([m(app.luca), m(app.capo), m(app.segretaria)], [750 * E, 112.5 * E, 30 * E], 'metà di 1.500, 225 e 60');
});

test('si può liquidare il capo: da liquidare scende e la pratica si modifica senza problemi', async () => {
  const app = await appCompleta();
  const id = await nuova(app, app.centro, { vend: 6100, acq: 6100 });
  await registraLiquidazione(app.archivio, { collaboratoreId: app.capo.id, data: oggi(), righe: [{ praticaId: id, importoCent: 100 * E }] });
  const v = () => modelloDi(app.archivio).perId.get(id).voci.find((x) => x.collaboratoreId === app.capo.id);
  assert.deepEqual([v().maturataCent, v().liquidataCent, v().daLiquidareCent], [225 * E, 100 * E, 125 * E]);
  // modificare la pratica non è bloccato dalle liquidazioni del capo (non è nelle quote)
  await salvaPratica(app.archivio, { id, codice: '2026/001', zona_id: app.centro, prezzo_vendita_cent: 250000 * E, venditore: 'Mario Rossi', acquirente: 'Anna Bianchi', mese_proposta: mese, venditore_bonifico_cent: 6100 * E, acquirente_bonifico_cent: 6100 * E, aliquota_iva: 22 }, quoteDi(app.archivio, app.centro));
  assert.equal(v().liquidataCent, 100 * E);
  // una pratica senza quote non si può liquidare al capo
  const senza = await salvaPratica(app.archivio, { zona_id: app.centro, venditore_bonifico_cent: 6100 * E, venditore: 'A', acquirente: 'B' }, []);
  await assert.rejects(registraLiquidazione(app.archivio, { collaboratoreId: app.capo.id, data: oggi(), righe: [{ praticaId: senza, importoCent: 1 * E }] }), ErroreValidazione);
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
  assert.equal(modelloDi(app.archivio).perId.get(id).voci.find((v) => v.collaboratoreId === app.capo.id).provvigioneCent, 150 * E);
});

// ---------------------------------------------------------------- mese della proposta

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
