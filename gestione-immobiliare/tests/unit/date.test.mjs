import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseISO, dataValida, aggiungiGiorni, giorniTra, fineMese, inizioMese, aggiungiMesi, mesiTra,
  risolviPeriodo, periodoPrecedente, oggi, chiaveMese,
} from '../../src/js/core/dates.js';

test('validita delle date', () => {
  assert.ok(dataValida('2026-02-28'));
  assert.ok(!dataValida('2026-02-30'));
  assert.ok(!dataValida('2026-13-01'));
  assert.ok(!dataValida('16/10/2026'));
  assert.ok(dataValida('2028-02-29'));
});

test('aritmetica su giorni e mesi', () => {
  assert.equal(aggiungiGiorni('2026-10-31', 1), '2026-11-01');
  assert.equal(aggiungiGiorni('2026-03-01', -1), '2026-02-28');
  assert.equal(giorniTra('2026-10-01', '2026-10-16'), 15);
  assert.equal(fineMese('2028-02'), '2028-02-29');
  assert.equal(inizioMese('2026-10'), '2026-10-01');
  assert.equal(aggiungiMesi('2026-11', 3), '2027-02');
  assert.equal(aggiungiMesi('2026-01', -1), '2025-12');
  assert.deepEqual(mesiTra('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(chiaveMese('2026-10-16'), '2026-10');
});

test('oggi usa il fuso orario locale', () => {
  assert.equal(oggi(new Date(2026, 9, 16, 23, 59)), '2026-10-16');
  assert.equal(oggi(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('risoluzione del periodo', () => {
  const m = risolviPeriodo({ tipo: 'mese', anno: 2026, mese: 10 }, '2026-10-16');
  assert.deepEqual([m.da, m.a, m.etichetta], ['2026-10-01', '2026-10-31', 'ottobre 2026']);
  const a = risolviPeriodo({ tipo: 'anno', anno: 2026 }, '2026-10-16');
  assert.deepEqual([a.da, a.a, a.etichetta], ['2026-01-01', '2026-12-31', 'Anno 2026']);
  const i = risolviPeriodo({ tipo: 'intervallo', da: '2026-09-20', a: '2026-09-01' }, '2026-10-16');
  assert.deepEqual([i.da, i.a], ['2026-09-01', '2026-09-20']); // estremi invertiti, corretti
  const t = risolviPeriodo({ tipo: 'tutto' }, '2026-10-16', { da: '2024-03-04', a: '2026-08-01' });
  assert.deepEqual([t.da, t.a], ['2024-03-04', '2026-10-16']);
});

test('periodo precedente di pari durata', () => {
  const m = periodoPrecedente(risolviPeriodo({ tipo: 'mese', anno: 2026, mese: 1 }));
  assert.deepEqual([m.da, m.a], ['2025-12-01', '2025-12-31']);
  const a = periodoPrecedente(risolviPeriodo({ tipo: 'anno', anno: 2026 }));
  assert.deepEqual([a.da, a.a], ['2025-01-01', '2025-12-31']);
  const i = periodoPrecedente(risolviPeriodo({ tipo: 'intervallo', da: '2026-10-11', a: '2026-10-20' }));
  assert.deepEqual([i.da, i.a], ['2026-10-01', '2026-10-10']);
  assert.equal(periodoPrecedente({ tipo: 'tutto' }), null);
});
