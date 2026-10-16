import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eur, eurInt, eurSegno, eurCompatto, leggiEuro, leggiPercentuale, euroPerInput,
  dataIt, dataEstesa, meseAnno, meseBreve, pct, normalizza, csvCampo, csvEuro, dimensioneFile,
} from '../../src/js/core/format.js';

const n = (s) => s.replace(/ /g, ' ');

test('importi in formato italiano', () => {
  assert.equal(n(eur(123456)), '1.234,56 €');
  assert.equal(n(eur(0)), '0,00 €');
  assert.equal(n(eur(-50)), '-0,50 €');
  assert.equal(n(eur(100000000)), '1.000.000,00 €');
  assert.equal(n(eurInt(123456)), '1.235 €');
  assert.equal(eur(null), '—');
  assert.equal(n(eurSegno(2500)), '+25,00 €');
  assert.equal(n(eurSegno(-2500)), '−25,00 €');
});

test('etichette compatte per gli assi', () => {
  assert.equal(n(eurCompatto(0)), '0');
  assert.equal(n(eurCompatto(50000)), '500');
  assert.equal(n(eurCompatto(500000)), '5 k');
  assert.equal(n(eurCompatto(150000000)), '1,5 M');
});

test('lettura degli importi scritti dall\'utente', () => {
  assert.equal(leggiEuro('1.234,56'), 123456);
  assert.equal(leggiEuro('1234,56'), 123456);
  assert.equal(leggiEuro('1234.56'), 123456);
  assert.equal(leggiEuro('1.234'), 123400);
  assert.equal(leggiEuro('12.5'), 1250);
  assert.equal(leggiEuro('€ 1.000'), 100000);
  assert.equal(leggiEuro('1.000.000'), 100000000);
  assert.equal(leggiEuro('0,5'), 50);
  assert.equal(leggiEuro('-5,50'), -550);
  assert.equal(leggiEuro(''), null);
  assert.equal(leggiEuro('abc'), null);
  assert.equal(leggiEuro('1,5,6'), null);
  assert.equal(leggiEuro(null), null);
  assert.equal(euroPerInput(123456), '1234,56');
  assert.equal(euroPerInput(5), '0,05');
  assert.equal(euroPerInput(null), '');
});

test('percentuali', () => {
  assert.equal(leggiPercentuale('35,5%'), 35.5);
  assert.equal(leggiPercentuale('35'), 35);
  assert.equal(leggiPercentuale('x'), null);
  assert.equal(pct(35), '35%');
  assert.equal(pct(35.5), '35,5%');
});

test('date in formato italiano', () => {
  assert.equal(dataIt('2026-10-16'), '16/10/2026');
  assert.equal(dataIt(null), '—');
  assert.equal(dataEstesa('2026-10-16'), 'venerdì 16 ottobre 2026');
  assert.equal(meseAnno('2026-10'), 'ottobre 2026');
  assert.equal(meseBreve('2026-10'), 'ott 26');
});

test('ricerca senza accenti e maiuscole', () => {
  assert.equal(normalizza('Niccolò Alunno'), 'niccolo alunno');
});

test('campi CSV per Excel italiano', () => {
  assert.equal(csvCampo('a;b'), '"a;b"');
  assert.equal(csvCampo('dice "ciao"'), '"dice ""ciao"""');
  assert.equal(csvCampo('semplice'), 'semplice');
  assert.equal(csvEuro(123456), '1234,56');
});

test('dimensione file', () => {
  assert.equal(dimensioneFile(500), '500 B');
  assert.equal(n(dimensioneFile(2048)), '2 KB');
  assert.equal(n(dimensioneFile(1572864)), '1,5 MB');
});
