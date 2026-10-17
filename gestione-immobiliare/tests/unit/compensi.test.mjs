// Compensi di una pratica da contanti (già senza IVA), bonifico e assegno (IVA compresa).
// I numeri attesi sono calcolati a mano: non vengono ricavati dal programma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorporoIva, ivaSuImponibile, compensoParte, calcolaCompensi, CAMPI_PAGAMENTO, campoPagamento, MODALITA, PARTI } from '../../src/js/data/calc/compensi.js';

const E = 100;

test('i contanti sono già senza IVA: entrano così come sono', () => {
  const p = compensoParte({ contantiCent: 2000 * E }, 22);
  assert.deepEqual(p, { contantiCent: 200000, bonificoCent: 0, assegnoCent: 0, imponibileCent: 200000, ivaCent: 0, pagatoCent: 200000 });
});

test('bonifico e assegno comprendono l\'IVA: 3.660,00 € con IVA 22% sono 3.000,00 € più 660,00 € di IVA', () => {
  const b = compensoParte({ bonificoCent: 3660 * E }, 22);
  assert.deepEqual([b.imponibileCent, b.ivaCent, b.pagatoCent], [3000 * E, 660 * E, 3660 * E]);
  const a = compensoParte({ assegnoCent: 3660 * E }, 22);
  assert.deepEqual([a.imponibileCent, a.ivaCent, a.pagatoCent], [3000 * E, 660 * E, 3660 * E]);
});

test('una parte può pagare in più modi: contanti 1.000 + bonifico 1.220 + assegno 2.440 (IVA 22%)', () => {
  // con IVA: 1.220 + 2.440 = 3.660 → 3.000 + 660 di IVA; contanti 1.000 senza IVA
  const p = compensoParte({ contantiCent: 1000 * E, bonificoCent: 1220 * E, assegnoCent: 2440 * E }, 22);
  assert.deepEqual([p.imponibileCent, p.ivaCent, p.pagatoCent], [4000 * E, 660 * E, 4660 * E]);
});

test('scorporo con arrotondamento al centesimo più vicino', () => {
  // 1.000,00 / 1,22 = 819,672131… → 819,67; l'IVA è la differenza: 180,33
  assert.equal(scorporoIva(1000 * E, 22), 81967);
  const p = compensoParte({ bonificoCent: 1000 * E }, 22);
  assert.deepEqual([p.imponibileCent, p.ivaCent], [81967, 18033]);
  // mezzo centesimo esatto (13 centesimi con IVA 4%: 13 / 1,04 = 12,5) → arrotondato per eccesso
  assert.equal(scorporoIva(13, 4), 13);
  assert.equal(scorporoIva(26, 4), 25); // 26 / 1,04 = 25 esatti
  assert.equal(scorporoIva(1 * E, 10), 91); // 1,00 € / 1,10 = 0,909090… € → 0,91 € (91 centesimi)
});

test('IVA al 0%: bonifico e assegno non hanno IVA da togliere', () => {
  const p = compensoParte({ bonificoCent: 1000 * E, assegnoCent: 500 * E }, 0);
  assert.deepEqual([p.imponibileCent, p.ivaCent, p.pagatoCent], [1500 * E, 0, 1500 * E]);
});

test('senza arrotondamenti strani: compenso senza IVA + IVA = importo pagato con bonifico/assegno, per ogni importo e aliquota', () => {
  for (const aliquota of [22, 10, 4, 0, 5.5]) {
    for (let c = 0; c <= 30000; c += 7) {
      const p = compensoParte({ bonificoCent: c }, aliquota);
      assert.equal(p.imponibileCent + p.ivaCent, c, `${c} cent al ${aliquota}%`);
      assert.ok(p.ivaCent >= 0 && p.imponibileCent <= c);
    }
  }
});

test('importo massimo ammesso (1 miliardo di euro): nessun errore di calcolo con i numeri grandi', () => {
  const massimo = 100_000_000_000;
  assert.equal(scorporoIva(massimo, 22), 81967213115); // 1.000.000.000 / 1,22 = 819.672.131,147… → 819.672.131,15
  assert.equal(Number.isSafeInteger(massimo * 10000 * 2), true);
});

test('pratica nuova: venditore 3.660,00 € con bonifico, acquirente 2.000,00 € in contanti → compenso 5.000,00 €, IVA 660,00 €, pagato 5.660,00 €', () => {
  const c = calcolaCompensi({
    compensi_da_pagamenti: 1, aliquota_iva: 22,
    venditore_contanti_cent: 0, venditore_bonifico_cent: 366000, venditore_assegno_cent: 0,
    acquirente_contanti_cent: 200000, acquirente_bonifico_cent: 0, acquirente_assegno_cent: 0,
  });
  assert.equal(c.daPagamenti, true);
  assert.equal(c.venditore.imponibileCent, 300000);
  assert.equal(c.acquirente.imponibileCent, 200000);
  assert.deepEqual([c.imponibileCent, c.ivaCent, c.totaleCent, c.pagatoCent], [500000, 66000, 566000, 566000]);
});

test('ogni parte ha la sua IVA: i centesimi si arrotondano per fattura, non sul totale', () => {
  // venditore 1.000,00 con bonifico → 819,67 + 180,33; acquirente 1.000,00 con assegno → 819,67 + 180,33
  const c = calcolaCompensi({
    compensi_da_pagamenti: 1, aliquota_iva: 22,
    venditore_bonifico_cent: 100000, acquirente_assegno_cent: 100000,
  });
  assert.deepEqual([c.venditore.imponibileCent, c.acquirente.imponibileCent, c.imponibileCent, c.ivaCent, c.totaleCent], [81967, 81967, 163934, 36066, 200000]);
});

test('pratica vecchia (solo compenso senza IVA): l\'IVA si aggiunge in cima, come prima', () => {
  const c = calcolaCompensi({ compensi_da_pagamenti: 0, aliquota_iva: 22, compenso_venditore_cent: 280000, compenso_acquirente_cent: 280000 });
  assert.equal(c.daPagamenti, false);
  assert.deepEqual([c.imponibileCent, c.ivaCent, c.totaleCent, c.pagatoCent], [560000, 123200, 683200, 0]);
  assert.deepEqual([c.venditore.imponibileCent, c.acquirente.imponibileCent], [280000, 280000]);
  // l'IVA sulla somma dei due compensi, non per parte: 0,03 € + 0,03 € al 22% = 0,06 € × 0,22 = 1,32 centesimi → 1
  assert.equal(calcolaCompensi({ aliquota_iva: 22, compenso_venditore_cent: 3, compenso_acquirente_cent: 3 }).ivaCent, 1);
});

test('i nomi dei campi nel database sono quelli attesi (sei importi: due parti × tre modi)', () => {
  assert.deepEqual(PARTI.map((p) => p.id), ['venditore', 'acquirente']);
  assert.deepEqual(MODALITA.map((m) => [m.id, m.conIva]), [['contanti', false], ['bonifico', true], ['assegno', true]]);
  assert.equal(campoPagamento('acquirente', 'assegno'), 'acquirente_assegno_cent');
  assert.deepEqual(CAMPI_PAGAMENTO, [
    'venditore_contanti_cent', 'venditore_bonifico_cent', 'venditore_assegno_cent',
    'acquirente_contanti_cent', 'acquirente_bonifico_cent', 'acquirente_assegno_cent',
  ]);
  assert.equal(ivaSuImponibile(560000, 22), 123200);
});
