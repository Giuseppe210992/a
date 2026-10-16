import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrotonda, puntiBase, creaTabella, controllaTabella, indiceScaglione, percentualeRaggiunta,
  provvigioneSuCumulo, prossimoScaglione, descriviScaglioni, distribuisciProvvigione,
} from '../../src/js/data/calc/scaglioni.js';

const E = 100;
const T = creaTabella([
  { da_cent: 20000 * E, percentuale: 40 }, // volutamente fuori ordine
  { da_cent: 0, percentuale: 30 },
  { da_cent: 10000 * E, percentuale: 35 },
]);

test('arrotondamento intero, mezzi verso l\'alto', () => {
  assert.equal(arrotonda(5, 2), 3);
  assert.equal(arrotonda(4, 3), 1);
  assert.equal(arrotonda(7, 3), 2);
  assert.equal(arrotonda(0, 10000), 0);
  assert.equal(puntiBase(35.25), 3525);
});

test('la tabella viene ordinata per soglia', () => {
  assert.deepEqual(T.map((s) => s.da), [0, 1000000, 2000000]);
});

test('scaglione raggiunto: la soglia esatta appartiene allo scaglione superiore', () => {
  assert.equal(indiceScaglione(T, 0), 0);
  assert.equal(indiceScaglione(T, 999999), 0);
  assert.equal(indiceScaglione(T, 1000000), 1);
  assert.equal(indiceScaglione(T, 1999999), 1);
  assert.equal(indiceScaglione(T, 2000000), 2);
  assert.equal(indiceScaglione(T, 99999999), 2);
  assert.equal(indiceScaglione([], 500), -1);
  assert.equal(percentualeRaggiunta(T, 1500000), 35);
  assert.equal(percentualeRaggiunta([], 1500000), 0);
});

test('provvigione "raggiunto": la percentuale dello scaglione vale su tutto il cumulo', () => {
  assert.equal(provvigioneSuCumulo(T, 1300000, 'raggiunto'), 455000);   // 13.000 x 35%
  assert.equal(provvigioneSuCumulo(T, 999999, 'raggiunto'), 300000);    // 9.999,99 x 30% = 2.999,997
  assert.equal(provvigioneSuCumulo(T, 2500000, 'raggiunto'), 1000000);  // 25.000 x 40%
  assert.equal(provvigioneSuCumulo(T, 0, 'raggiunto'), 0);
  assert.equal(provvigioneSuCumulo([], 1000, 'raggiunto'), 0);
});

test('provvigione "progressivo": ogni percentuale vale solo sulla propria fascia', () => {
  assert.equal(provvigioneSuCumulo(T, 1300000, 'progressivo'), 405000);  // 10.000x30% + 3.000x35%
  assert.equal(provvigioneSuCumulo(T, 2500000, 'progressivo'), 850000);  // 3.000 + 3.500 + 5.000x40%=2.000
  assert.equal(provvigioneSuCumulo(T, 500000, 'progressivo'), 150000);
});

test('prossimo scaglione e cosa manca per raggiungerlo', () => {
  assert.deepEqual(prossimoScaglione(T, 1300000), { indice: 2, da: 2000000, percentuale: 40, mancanteCent: 700000 });
  assert.deepEqual(prossimoScaglione(T, 0), { indice: 1, da: 1000000, percentuale: 35, mancanteCent: 1000000 });
  assert.equal(prossimoScaglione(T, 5000000), null);
  assert.equal(prossimoScaglione([], 0), null);
});

test('descrizione degli scaglioni con estremi inclusi', () => {
  assert.deepEqual(descriviScaglioni(T), [
    { indice: 0, da: 0, a: 999999, percentuale: 30 },
    { indice: 1, da: 1000000, a: 1999999, percentuale: 35 },
    { indice: 2, da: 2000000, a: null, percentuale: 40 },
  ]);
});

test('controllo di validita della tabella', () => {
  assert.deepEqual(controllaTabella(T), []);
  assert.ok(controllaTabella([]).length > 0);
  assert.ok(controllaTabella(creaTabella([{ da_cent: 500, percentuale: 30 }])).some((m) => m.includes('0,00')));
  assert.ok(controllaTabella([{ da: 0, percentuale: 30 }, { da: 0, percentuale: 35 }]).some((m) => m.includes('maggiore')));
  assert.ok(controllaTabella([{ da: 0, percentuale: 130 }]).some((m) => m.includes('tra 0 e 100')));
});

test('la distribuzione sulle singole voci somma esattamente al totale', () => {
  const a = [{ fatturatoCent: 600000 }, { fatturatoCent: 700000 }];
  distribuisciProvvigione(a, T, 'raggiunto');
  assert.deepEqual(a.map((v) => v.provvigioneCent), [210000, 245000]);
  const b = [{ fatturatoCent: 600000 }, { fatturatoCent: 700000 }];
  distribuisciProvvigione(b, T, 'progressivo');
  assert.deepEqual(b.map((v) => v.provvigioneCent), [180000, 225000]);
  // Importi "scomodi": la somma deve coincidere con il totale arrotondato una volta sola.
  const c = [{ fatturatoCent: 333 }, { fatturatoCent: 333 }, { fatturatoCent: 334 }];
  distribuisciProvvigione(c, creaTabella([{ da_cent: 0, percentuale: 33.33 }]), 'raggiunto');
  assert.equal(c.reduce((s, v) => s + v.provvigioneCent, 0), provvigioneSuCumulo([{ da: 0, percentuale: 33.33 }], 1000, 'raggiunto'));
});
