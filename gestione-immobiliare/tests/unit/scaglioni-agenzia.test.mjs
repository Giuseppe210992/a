// Gli scaglioni dell'agenzia, preimpostati al primo avvio, provati con il calcolo fatto a mano dalle sue parole:
// «5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, oltre i 13.000 sempre 20%».
// I numeri attesi sono scritti qui a mano: non vengono ricavati dal programma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nuovaApp, modelloDi } from './helpers-db.mjs';
import { SCAGLIONI_INIZIALI } from '../../src/js/data/inizializza.js';
import { leggiTabellaScaglioni, creaZona, elencoCollaboratori } from '../../src/js/data/repo/anagrafiche.js';
import { salvaPratica } from '../../src/js/data/repo/pratiche.js';
import { scriviImpostazioni } from '../../src/js/data/repo/impostazioni.js';
import {
  creaTabella, controllaTabella, percentualeRaggiunta, provvigioneSuCumulo, prossimoScaglione, descriviScaglioni,
} from '../../src/js/data/calc/scaglioni.js';

const E = 100;
const tabella = creaTabella(SCAGLIONI_INIZIALI);

// Lettura diretta delle parole dell'agenzia («fino a X» comprende X), in centesimi.
const aParole = (c) => (c <= 2600 * E ? 5 : c <= 5200 * E ? 8 : c <= 7800 * E ? 11 : c <= 13000 * E ? 15 : 20);

test('gli scaglioni dell\'agenzia sono una tabella valida e si leggono come lei li ha detti', () => {
  assert.deepEqual(controllaTabella(tabella), []);
  assert.deepEqual(descriviScaglioni(tabella), [
    { indice: 0, da: 0, a: 2600 * E, percentuale: 5 },
    { indice: 1, da: 2600 * E + 1, a: 5200 * E, percentuale: 8 },
    { indice: 2, da: 5200 * E + 1, a: 7800 * E, percentuale: 11 },
    { indice: 3, da: 7800 * E + 1, a: 13000 * E, percentuale: 15 },
    { indice: 4, da: 13000 * E + 1, a: null, percentuale: 20 },
  ]);
});

test('la percentuale è quella detta dall\'agenzia, anche a un centesimo dai confini', () => {
  const controlli = [];
  for (const confine of [2600, 5200, 7800, 13000]) {
    for (const delta of [-100, -2, -1, 0, 1, 2, 100]) controlli.push(confine * E + delta);
  }
  for (let c = 1; c <= 20000 * E; c += 100) controlli.push(c); // ogni euro intero fino a 20.000
  for (const c of controlli) assert.equal(percentualeRaggiunta(tabella, c), aParole(c), `cumulo di ${c / 100} €`);
  // i confini a parole
  assert.equal(percentualeRaggiunta(tabella, 2600 * E), 5, '2.600,00 € precisi: ancora 5%');
  assert.equal(percentualeRaggiunta(tabella, 2600 * E + 1), 8, '2.600,01 €: 8%');
  assert.equal(percentualeRaggiunta(tabella, 13000 * E), 15, '13.000,00 € precisi: ancora 15%');
  assert.equal(percentualeRaggiunta(tabella, 13000 * E + 1), 20, 'oltre i 13.000: 20%');
  assert.equal(percentualeRaggiunta(tabella, 90000 * E), 20, 'oltre i 13.000 sempre 20%');
});

test('provvigione con «scaglione raggiunto»: la percentuale dello scaglione si applica a tutto il cumulo', () => {
  const attesi = [ // [cumulo in centesimi, provvigione in centesimi]
    [1000 * E, 50 * E],           //  1.000,00 × 5%  =    50,00
    [2600 * E, 130 * E],          //  2.600,00 × 5%  =   130,00
    [2600 * E + 1, 20800],        //  2.600,01 × 8%  =   208,0008 → 208,00
    [5200 * E, 416 * E],          //  5.200,00 × 8%  =   416,00
    [5200 * E + 1, 57200],        //  5.200,01 × 11% =   572,0011 → 572,00
    [7800 * E, 858 * E],          //  7.800,00 × 11% =   858,00
    [7800 * E + 1, 117000],       //  7.800,01 × 15% = 1.170,0015 → 1.170,00
    [10000 * E, 1500 * E],        // 10.000,00 × 15% = 1.500,00
    [13000 * E, 1950 * E],        // 13.000,00 × 15% = 1.950,00
    [13000 * E + 1, 260000],      // 13.000,01 × 20% = 2.600,002 → 2.600,00
    [20000 * E, 4000 * E],        // 20.000,00 × 20% = 4.000,00
  ];
  for (const [cumulo, provvigione] of attesi) assert.equal(provvigioneSuCumulo(tabella, cumulo, 'raggiunto'), provvigione, `cumulo di ${cumulo / 100} €`);
  assert.equal(provvigioneSuCumulo(tabella, 0, 'raggiunto'), 0);
});

test('provvigione con il metodo progressivo: ogni percentuale solo sulla sua fascia', () => {
  // fasce dell'agenzia: i primi 2.600 al 5%, i successivi 2.600 all'8%, altri 2.600 all'11%, fino a 13.000 al 15%, il resto al 20%
  const attesi = [
    [2600 * E, 130 * E],                      // 130
    [5200 * E, 338 * E],                      // 130 + 208
    [7800 * E, 624 * E],                      // 130 + 208 + 286
    [10000 * E, 954 * E],                     // 624 + 2.200 × 15% (330)
    [13000 * E, 1404 * E],                    // 624 + 5.200 × 15% (780)
    [20000 * E, 2804 * E],                    // 1.404 + 7.000 × 20% (1.400)
  ];
  for (const [cumulo, provvigione] of attesi) assert.equal(provvigioneSuCumulo(tabella, cumulo, 'progressivo'), provvigione, `cumulo di ${cumulo / 100} €`);
});

test('quanto manca al prossimo scaglione: a 2.600,00 € precisi manca un centesimo', () => {
  assert.deepEqual(prossimoScaglione(tabella, 2500 * E), { indice: 1, da: 2600 * E + 1, percentuale: 8, mancanteCent: 100 * E + 1 });
  assert.deepEqual(prossimoScaglione(tabella, 2600 * E), { indice: 1, da: 2600 * E + 1, percentuale: 8, mancanteCent: 1 });
  assert.equal(prossimoScaglione(tabella, 15000 * E), null, 'oltre i 13.000 non c\'è un altro scaglione');
});

test('dall\'archivio nuovo alle provvigioni di Luca e di Giuseppe: stessa tabella, un cumulo per ogni gruppo di collaboratori', async () => {
  const { archivio } = await nuovaApp();
  assert.deepEqual(leggiTabellaScaglioni(archivio, null), SCAGLIONI_INIZIALI);
  const zona = await creaZona(archivio, { nome: 'Zona prova' });
  const [luca, giuseppe] = elencoCollaboratori(archivio);
  const pratica = (codice, rogito, compensi, quote) => salvaPratica(archivio, {
    codice, stato: 'conclusa', data_pratica: '2026-08-01', data_rogito: rogito, zona_id: zona, immobile_indirizzo: `Via ${codice}`,
    prezzo_vendita_cent: 100000 * E, compenso_venditore_cent: compensi * E, compenso_acquirente_cent: 0, aliquota_iva: 22,
  }, quote);
  // ottobre, zona prova: P/1 è solo di Luca (6.000 €), P/2 è di 8.000 € divisa a metà tra Luca e Giuseppe. Ogni gruppo di collaboratori ha il suo
  // cumulo e conta il compenso intero: Luca da solo 6.000 €, la coppia 8.000 € (non 10.000 e 4.000 come con le metà).
  await pratica('P/1', '2026-10-05', 6000, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  await pratica('P/2', '2026-10-20', 8000, [{ collaboratore_id: luca.id, percentuale: 50 }, { collaboratore_id: giuseppe.id, percentuale: 50 }]);
  const cumuli = modelloDi(archivio).cumuli;
  const solo = cumuli.find((c) => c.firma === String(luca.id));
  const coppia = cumuli.find((c) => c.firma === `${luca.id}+${giuseppe.id}`);
  assert.equal(solo.fatturatoCent, 6000 * E);
  assert.equal(solo.percentuale, 11, '6.000 € → terzo scaglione');
  assert.equal(solo.provvigioneCent, 660 * E);
  assert.equal(coppia.fatturatoCent, 8000 * E, 'il compenso intero di P/2');
  assert.equal(coppia.percentuale, 15, '8.000 € → quarto scaglione (da 7.800,01 €)');
  assert.equal(coppia.provvigioneCent, 1200 * E, '8.000 × 15%, poi diviso: 600 a testa');
  const m = modelloDi(archivio);
  const p2 = m.pratiche.find((p) => p.codice === 'P/2');
  assert.deepEqual(p2.voci.map((v) => v.provvigioneCent), [600 * E, 600 * E]);
  // con il metodo progressivo: Luca da solo 130,00 + 208,00 + 88,00 = 426,00; la coppia 130,00 + 208,00 + 286,00 + 30,00 = 654,00
  await scriviImpostazioni(archivio, { 'calcolo.metodo': 'progressivo' });
  const prog = modelloDi(archivio).cumuli;
  assert.equal(prog.find((c) => c.firma === String(luca.id)).provvigioneCent, 426 * E);
  assert.equal(prog.find((c) => c.firma === `${luca.id}+${giuseppe.id}`).provvigioneCent, 654 * E);
});
