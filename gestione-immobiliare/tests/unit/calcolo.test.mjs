import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcolaModello } from '../../src/js/data/calc/modello.js';
import {
  riepilogo, serieTemporale, perCollaboratore, perZona, confrontoPrezzi, cumuloDelMese,
  ultimePratiche, variazionePct, finestraTemporale, indicatori, perTipologia,
} from '../../src/js/data/calc/aggregati.js';
import { risolviPeriodo } from '../../src/js/core/dates.js';
import { datiBase, aggiungiPratica, EURO as E } from './helpers.mjs';

/** Ottobre 2026: P1 e P4 di Luca, P2 diviso 50/50, P3 di Giuseppe in un'altra zona. */
function ottobre({ conP4 = false } = {}) {
  const d = datiBase();
  aggiungiPratica(d, 1, { data_rogito: '2026-10-05', compenso_venditore_cent: 3000 * E, compenso_acquirente_cent: 3000 * E }, [[1, 100]]);
  aggiungiPratica(d, 2, { data_rogito: '2026-10-20', compenso_venditore_cent: 4000 * E, compenso_acquirente_cent: 3000 * E }, [[1, 50], [2, 50]]);
  aggiungiPratica(d, 3, { data_rogito: '2026-10-12', zona_id: 2, compenso_venditore_cent: 2500 * E, compenso_acquirente_cent: 2500 * E }, [[2, 100]]);
  if (conP4) aggiungiPratica(d, 4, { data_rogito: '2026-10-25', compenso_venditore_cent: 500 * E, compenso_acquirente_cent: 500 * E }, [[1, 100]]);
  return d;
}
const provv = (m, id, collab) => m.perId.get(id).voci.find((v) => v.collaboratoreId === collab);

test('importi della pratica: compensi, IVA e totale lordo', () => {
  const m = calcolaModello(ottobre());
  const p1 = m.perId.get(1);
  assert.equal(p1.compensoTotaleCent, 600000);
  assert.equal(p1.ivaCent, 132000);
  assert.equal(p1.totaleLordoCent, 732000);
  assert.equal(p1.dataRif, '2026-10-05');
  assert.equal(p1.meseRif, '2026-10');
});

test('cumulo per collaboratore e zona, scaglione basso (30%): la pratica condivisa fa un cumulo suo, sul compenso intero', () => {
  const m = calcolaModello(ottobre());
  assert.equal(provv(m, 1, 1).provvigioneCent, 180000);
  assert.equal(provv(m, 2, 1).fatturatoCent, 350000); // la quota di Luca (metà di 7.000)
  assert.equal(provv(m, 2, 1).provvigioneCent, 105000);
  assert.equal(provv(m, 2, 2).provvigioneCent, 105000);
  assert.equal(provv(m, 3, 2).provvigioneCent, 150000);
  const luca = m.cumuli.find((c) => c.firma === '1' && c.zonaId === 1);
  assert.equal(luca.fatturatoCent, 600000); // solo P1: P2 è condivisa con Giuseppe e fa il cumulo della coppia
  assert.equal(luca.scaglioneIdx, 0);
  assert.equal(luca.percentuale, 30);
  assert.equal(luca.prossimo.mancanteCent, 400000);
  const coppia = m.cumuli.find((c) => c.firma === '1+2' && c.zonaId === 1);
  assert.equal(coppia.fatturatoCent, 700000); // il compenso intero di P2, non le due metà
  assert.equal(coppia.collaboratoreNome, 'Luca + Giuseppe');
  assert.equal(coppia.collaboratoreId, null);
  assert.deepEqual(coppia.collaboratoriIds, [1, 2]);
  assert.equal(coppia.provvigioneCent, 210000);
  assert.equal(coppia.prossimo.mancanteCent, 300000);
});

/** P4 di Luca portata a 5.000 €: con P1 (6.000 €) il cumulo di Luca da solo supera i 10.000 €. */
function ottobreLucaOltreSoglia() {
  const d = ottobre({ conP4: true });
  const p4 = d.pratiche.find((x) => x.id === 4);
  p4.compenso_venditore_cent = 2500 * E; p4.compenso_acquirente_cent = 2500 * E;
  return d;
}

test('"raggiunto": superata la soglia la percentuale sale su TUTTO il mese', () => {
  const m = calcolaModello(ottobreLucaOltreSoglia(), { metodo: 'raggiunto' });
  const luca = m.cumuli.find((c) => c.firma === '1' && c.zonaId === 1);
  assert.equal(luca.fatturatoCent, 1100000);
  assert.equal(luca.scaglioneIdx, 1);
  assert.equal(luca.percentuale, 35);
  assert.equal(luca.provvigioneCent, 385000);
  assert.deepEqual([1, 4].map((id) => provv(m, id, 1).provvigioneCent), [210000, 175000]);
  assert.equal(provv(m, 2, 1).provvigioneCent, 105000, 'la pratica condivisa resta al 30%: il suo cumulo è 7.000 €');
});

test('"progressivo": la nuova percentuale vale solo sulla parte oltre la soglia', () => {
  const m = calcolaModello(ottobreLucaOltreSoglia(), { metodo: 'progressivo' });
  const luca = m.cumuli.find((c) => c.firma === '1' && c.zonaId === 1);
  assert.equal(luca.provvigioneCent, 335000); // 10.000 x 30% + 1.000 x 35%
  assert.deepEqual([1, 4].map((id) => provv(m, id, 1).provvigioneCent), [180000, 155000]);
});

test('zona condivisa: la percentuale si calcola sul compenso INTERO, poi la provvigione si divide tra i due collaboratori', () => {
  const d = datiBase();
  // 8.737,00 € (senza IVA) e altri 2.000 € nello stesso mese e zona, sempre 50/50: il cumulo è 10.737 € → 35% per entrambe
  aggiungiPratica(d, 1, { data_rogito: '2026-10-03', compenso_venditore_cent: 873700, compenso_acquirente_cent: 0, aliquota_iva: 0 }, [[1, 50], [2, 50]]);
  aggiungiPratica(d, 2, { data_rogito: '2026-10-09', compenso_venditore_cent: 200000, compenso_acquirente_cent: 0, aliquota_iva: 0 }, [[1, 50], [2, 50]]);
  const m = calcolaModello(d);
  const c = m.cumuli.find((x) => x.firma === '1+2');
  assert.equal(c.fatturatoCent, 1073700);
  assert.equal(c.percentuale, 35, 'il vecchio modo (metà a testa, 5.368,50 € ciascuno) sarebbe rimasto al 30%');
  // 8.737,00 × 35% = 3.057,95 €, diviso a metà: 1.528,975 → 1.528,98 e 1.528,97 (la somma torna sempre al centesimo)
  assert.deepEqual([1, 2].map((id) => provv(m, 1, id).provvigioneCent), [152898, 152897]);
  assert.equal(m.perId.get(1).provvigioniCent, 305795);
  assert.deepEqual([1, 2].map((id) => provv(m, 2, id).provvigioneCent), [35000, 35000]); // 2.000 × 35% = 700 €
  assert.equal(c.provvigioneCent, 305795 + 70000);
  // con una ripartizione 60/40: totale 3.057,95 € → 1.834,77 e 1.223,18
  const e = datiBase();
  aggiungiPratica(e, 1, { data_rogito: '2026-10-03', compenso_venditore_cent: 873700, compenso_acquirente_cent: 0, aliquota_iva: 0 }, [[1, 60], [2, 40]]);
  aggiungiPratica(e, 2, { data_rogito: '2026-10-09', compenso_venditore_cent: 200000, compenso_acquirente_cent: 0, aliquota_iva: 0 }, [[1, 60], [2, 40]]);
  const n = calcolaModello(e);
  assert.deepEqual([1, 2].map((id) => n.perId.get(1).voci.find((v) => v.collaboratoreId === id).provvigioneCent), [183477, 122318]);
});

test('base di cumulo "zona": il fatturato di tutti i collaboratori fa scaglione insieme', () => {
  const m = calcolaModello(ottobre({ conP4: true }), { baseCumulo: 'zona' });
  const z1 = m.cumuli.find((c) => c.zonaId === 1);
  assert.equal(z1.fatturatoCent, 1400000);
  assert.equal(z1.percentuale, 35);
  assert.equal(z1.provvigioneCent, 490000);
  assert.equal(z1.collaboratoreId, null);
});

test('base di cumulo "collaboratore": le zone si sommano', () => {
  const m = calcolaModello(ottobre({ conP4: true }), { baseCumulo: 'collaboratore' });
  const giuseppe = m.cumuli.find((c) => c.firma === '2');
  assert.equal(giuseppe.fatturatoCent, 500000); // la sua P3; P2 è condivisa con Luca
  assert.equal(giuseppe.percentuale, 30);
  assert.equal(giuseppe.provvigioneCent, 150000);
  assert.equal(giuseppe.zonaId, null);
  assert.equal(m.cumuli.find((c) => c.firma === '1').fatturatoCent, 700000); // P1 + P4 di Luca
});

test('scaglioni propri di una zona', () => {
  const d = ottobre();
  d.zone[1].usa_scaglioni_propri = 1;
  d.scaglioni.push({ id: 10, zona_id: 2, da_cent: 0, percentuale: 20 }, { id: 11, zona_id: 2, da_cent: 400000, percentuale: 25 });
  const m = calcolaModello(d);
  assert.equal(provv(m, 3, 2).provvigioneCent, 125000); // 5.000 x 25%
  assert.equal(provv(m, 1, 1).provvigioneCent, 180000); // la zona A usa la tabella predefinita
});

test('senza scaglioni configurati la provvigione e\' zero (non inventa percentuali)', () => {
  const d = ottobre();
  d.scaglioni = [];
  const m = calcolaModello(d);
  assert.equal(provv(m, 1, 1).provvigioneCent, 0);
  assert.equal(m.cumuli[0].tabellaConfigurata, false);
});

test('la ripartizione divide i compensi senza perdere centesimi', () => {
  const d = datiBase();
  aggiungiPratica(d, 1, { compenso_venditore_cent: 100, compenso_acquirente_cent: 0 }, [[1, 33.33], [2, 33.33], [3, 33.34]]);
  d.collaboratori.push({ id: 3, nome: 'Terzo', attivo: 1, colore: 3 });
  const m = calcolaModello(d);
  assert.deepEqual(m.perId.get(1).voci.map((v) => v.fatturatoCent), [33, 33, 34]);
  const e = datiBase();
  aggiungiPratica(e, 1, { compenso_venditore_cent: 100001, compenso_acquirente_cent: 0 }, [[1, 50], [2, 50]]);
  const n = calcolaModello(e);
  assert.equal(n.perId.get(1).voci.reduce((s, v) => s + v.fatturatoCent, 0), 100001);
});

test('maturazione alla conclusione o all\'incasso', () => {
  const d = ottobre();
  d.incassi.push({ id: 1, pratica_id: 1, data: '2026-10-06', importo_cent: 366000 }); // meta' del lordo (7.320 €)
  const alla = calcolaModello(d, { maturazione: 'conclusione' });
  assert.equal(provv(alla, 1, 1).maturataCent, 180000);
  assert.equal(alla.perId.get(1).incassatoCent, 366000);
  assert.equal(alla.perId.get(1).daIncassareCent, 366000);
  const all = calcolaModello(d, { maturazione: 'incasso' });
  assert.equal(provv(all, 1, 1).maturataCent, 90000);
  assert.equal(provv(all, 2, 1).maturataCent, 0); // nulla incassato su P2
});

test('le provvigioni sono considerate già pagate: liquidato = maturato e nulla da liquidare, anche con liquidazioni vecchie nei dati', () => {
  const d = ottobre();
  d.liquidazioni.push({ id: 1, collaboratore_id: 1, data: '2026-10-30' });
  d.righe.push({ id: 1, liquidazione_id: 1, pratica_id: 1, importo_cent: 100000 });
  const m = calcolaModello(d);
  const v = provv(m, 1, 1);
  assert.equal(v.liquidataCent, 180000);
  assert.equal(v.daLiquidareCent, 0);
  const luca = m.collaboratori.find((c) => c.id === 1);
  assert.deepEqual([luca.maturateCent, luca.liquidateCent, luca.daLiquidareCent], [285000, 285000, 0]);
});

test('dati mancanti riconosciuti', () => {
  const d = datiBase();
  aggiungiPratica(d, 5, { zona_id: null, data_rogito: null, prezzo_vendita_cent: null, compenso_venditore_cent: 0, compenso_acquirente_cent: 0 }, []);
  aggiungiPratica(d, 6, {}, [[1, 60], [2, 30]]);
  const m = calcolaModello(d);
  assert.deepEqual(m.perId.get(5).mancanti.map((x) => x.codice), ['zona', 'data_rogito', 'prezzo_vendita', 'compensi', 'ripartizione']);
  assert.deepEqual(m.perId.get(6).mancanti.map((x) => x.codice), ['ripartizione_somma']);
  assert.ok(m.perId.get(5).incompleta);
  // Senza data di rogito la pratica resta visibile (usa la data apertura) ma e' segnalata.
  assert.equal(m.perId.get(5).dataRif, '2026-09-01');
});

test('una quota non assegnata conta per lo scaglione ma non genera provvigione', () => {
  const d = datiBase();
  aggiungiPratica(d, 1, {}, []); // nessuna ripartizione
  const m = calcolaModello(d);
  assert.equal(m.perId.get(1).voci.length, 1);
  assert.equal(m.perId.get(1).voci[0].collaboratoreId, null);
  assert.equal(m.perId.get(1).provvigioniCent, 0);
});

// ---------------------------------------------------------------- aggregati

const ctxOttobre = (extra = {}) => ({
  periodo: risolviPeriodo({ tipo: 'mese', anno: 2026, mese: 10 }, '2026-10-16'), zonaId: null, collaboratoreId: null, ...extra,
});

test('riquadri della dashboard sul periodo', () => {
  const m = calcolaModello(ottobre({ conP4: true }));
  const r = riepilogo(m, ctxOttobre());
  assert.equal(r.concluse, 4);
  assert.equal(r.compensiCent, 1900000);
  assert.equal(r.valoreVendutoCent, 4 * 150000 * E);
  assert.equal(r.maturateCent, 570000); // 2.100 (Luca solo: P1+P4 al 30%) + 2.100 (P2 condivisa) + 1.500 (P3 di Giuseppe)
  assert.equal(r.liquidateCent, 570000, 'già pagate');
  assert.equal(r.daLiquidareCent, 0);
  assert.equal(r.inCorso, 0);
});

test('i filtri per collaboratore e per zona cambiano i riquadri in modo coerente', () => {
  const m = calcolaModello(ottobre({ conP4: true }));
  const luca = riepilogo(m, ctxOttobre({ collaboratoreId: 1 }));
  assert.equal(luca.concluse, 3);               // P1, P2, P4
  assert.equal(luca.compensiCent, 1050000);     // 6.000 + 3.500 (meta' di P2) + 1.000
  assert.equal(luca.maturateCent, 315000); // 1.800 + 300 + 1.050 (metà di P2)
  const zonaB = riepilogo(m, ctxOttobre({ zonaId: 2 }));
  assert.equal(zonaB.concluse, 1);
  assert.equal(zonaB.compensiCent, 500000);
  const nessuno = riepilogo(m, { ...ctxOttobre(), periodo: risolviPeriodo({ tipo: 'mese', anno: 2026, mese: 9 }, '2026-10-16') });
  assert.equal(nessuno.concluse, 0);
  assert.equal(nessuno.compensiCent, 0);
});

test('"pratiche in corso" e\' una fotografia di oggi, indipendente dal periodo', () => {
  const d = ottobre();
  aggiungiPratica(d, 7, { stato: 'in_corso', data_pratica: '2026-03-01', data_rogito: null }, [[1, 100]]);
  aggiungiPratica(d, 8, { stato: 'annullata', data_rogito: null }, [[1, 100]]);
  const m = calcolaModello(d);
  assert.equal(riepilogo(m, ctxOttobre()).inCorso, 1);
  assert.equal(riepilogo(m, ctxOttobre({ zonaId: 2 })).inCorso, 0);
  assert.equal(riepilogo(m, ctxOttobre()).concluse, 3); // l'annullata non conta
});

test('variazione percentuale', () => {
  assert.equal(variazionePct(150, 100), 50);
  assert.equal(variazionePct(50, 100), -50);
  assert.equal(variazionePct(10, 0), null);
  assert.equal(variazionePct(10, null), null);
});

test('serie mensile: sempre almeno 12 mesi di contesto, solo il periodo e\' evidenziato', () => {
  const m = calcolaModello(ottobre());
  const s = serieTemporale(m, ctxOttobre(), { metrica: 'compensi' });
  assert.equal(s.intervalli.length, 12);
  assert.equal(s.intervalli[0].chiave, '2025-11');
  assert.equal(s.intervalli[11].chiave, '2026-10');
  assert.deepEqual(s.intervalli.map((i) => i.inPeriodo), [...Array(11).fill(false), true]);
  assert.equal(s.serie.length, 1);
  assert.equal(s.serie[0].valori[11], 1800000);
  assert.equal(s.serie[0].totale, 1800000);
});

test('serie per collaboratore: colore = identita\' del collaboratore', () => {
  const m = calcolaModello(ottobre());
  const s = serieTemporale(m, ctxOttobre(), { metrica: 'compensi', per: 'collaboratore' });
  assert.deepEqual(s.serie.map((x) => [x.nome, x.colore, x.valori[11]]), [['Luca', 1, 950000], ['Giuseppe', 2, 850000]]);
});

test('serie annuale e metrica "concluse"', () => {
  const d = ottobre();
  aggiungiPratica(d, 20, { data_pratica: '2025-02-01', data_rogito: '2025-03-10' }, [[1, 100]]);
  const m = calcolaModello(d);
  const ctxAnno = { ...ctxOttobre(), periodo: risolviPeriodo({ tipo: 'anno', anno: 2026 }, '2026-10-16') };
  const s = serieTemporale(m, ctxAnno, { granularita: 'annuale', metrica: 'concluse' });
  assert.deepEqual(s.intervalli.map((i) => i.chiave), ['2024', '2025', '2026']);
  assert.deepEqual(s.serie[0].valori, [0, 1, 3]);
});

test('intervallo parziale: conta solo la parte nel periodo', () => {
  const m = calcolaModello(ottobre());
  const ctx = { periodo: risolviPeriodo({ tipo: 'intervallo', da: '2026-10-10', a: '2026-10-31' }, '2026-10-16'), zonaId: null, collaboratoreId: null };
  const s = serieTemporale(m, ctx, { metrica: 'concluse' });
  assert.equal(s.serie[0].valori[11], 2); // P1 (5 ottobre) esclusa
});

test('finestra temporale annuale: almeno tre anni', () => {
  const f = finestraTemporale(risolviPeriodo({ tipo: 'mese', anno: 2026, mese: 10 }), 'annuale');
  assert.deepEqual(f.map((x) => x.chiave), ['2024', '2025', '2026']);
});

test('riepiloghi per collaboratore e per zona', () => {
  const m = calcolaModello(ottobre({ conP4: true }));
  const pc = perCollaboratore(m, ctxOttobre());
  assert.deepEqual(pc.map((r) => [r.nome, r.pratiche, r.fatturatoCent, r.maturateCent]), [
    ['Luca', 3, 1050000, 315000],
    ['Giuseppe', 2, 850000, 255000],
  ]);
  const pz = perZona(m, ctxOttobre());
  assert.deepEqual(pz.map((r) => [r.nome, r.pratiche, r.fatturatoCent, r.provvigioniCent]), [
    ['Zona A', 3, 1400000, 420000],
    ['Zona B', 1, 500000, 150000],
  ]);
});

test('confronto acquisto/vendita solo dove ci sono entrambi i prezzi', () => {
  const d = ottobre();
  d.pratiche[0].prezzo_acquisto_cent = 100000 * E; // P1: 100.000 -> 150.000
  d.pratiche[1].prezzo_acquisto_cent = 200000 * E; // P2: 200.000 -> 150.000
  const m = calcolaModello(d);
  const c = confrontoPrezzi(m, ctxOttobre());
  assert.equal(c.totale, 2);
  assert.equal(c.mancanti, 1);
  const p1 = c.righe.find((r) => r.pratica.id === 1);
  assert.equal(p1.deltaCent, 50000 * E);
  assert.equal(p1.deltaPct, 50);
  assert.equal(c.righe.find((r) => r.pratica.id === 2).deltaPct, -25);
  assert.equal(c.mediaDeltaPct, 12.5);
});

test('cumulo del mese per zona include anche chi non ha ancora fatturato', () => {
  const m = calcolaModello(ottobre());
  const g = cumuloDelMese(m, '2026-10');
  assert.deepEqual(g.map((x) => x.zonaNome), ['Zona A', 'Zona B']);
  assert.equal(g[0].righe.length, 3); // Luca, Giuseppe e la riga «Luca + Giuseppe» della pratica condivisa (c'è solo se nel mese ne esistono)
  assert.deepEqual(g[0].righe.map((r) => r.collaboratoreNome), ['Luca', 'Giuseppe', 'Luca + Giuseppe']);
  assert.equal(g[1].righe.length, 2);
  const lucaB = g[1].righe.find((r) => r.collaboratoreId === 1);
  assert.equal(lucaB.fatturatoCent, 0);
  assert.equal(lucaB.percentuale, 30);
  assert.equal(lucaB.prossimo.mancanteCent, 1000000);
  const solo = cumuloDelMese(m, '2026-10', { zonaId: 2, collaboratoreId: 2 });
  assert.equal(solo.length, 1);
  assert.equal(solo[0].righe.length, 1);
  assert.equal(solo[0].righe[0].fatturatoCent, 500000);
});

test('ultime pratiche ordinate per ultima modifica', () => {
  const d = ottobre();
  d.pratiche[0].aggiornato_il = '2026-10-10T10:00:00.000Z';
  d.pratiche[1].aggiornato_il = '2026-10-12T10:00:00.000Z';
  d.pratiche[2].aggiornato_il = '2026-10-11T10:00:00.000Z';
  const m = calcolaModello(d);
  assert.deepEqual(ultimePratiche(m, { zonaId: null, collaboratoreId: null }, 2).map((p) => p.id), [2, 3]);
});

test('indicatori medi e tipologie', () => {
  const m = calcolaModello(ottobre());
  const ind = indicatori(m, ctxOttobre());
  assert.equal(ind.compensoMedioCent, 600000); // (6.000 + 7.000 + 5.000) / 3
  assert.equal(ind.prezzoMedioCent, 150000 * E);
  const t = perTipologia(m, ctxOttobre());
  assert.equal(t[0].nome, 'Appartamento');
  assert.equal(t[0].pratiche, 3);
});
