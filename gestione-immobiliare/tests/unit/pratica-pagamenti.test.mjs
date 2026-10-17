// Una pratica inserita dal modulo semplificato: codice, stato e date automatici, niente indirizzo, importi pagati da
// ciascuna parte (contanti senza IVA, bonifico e assegno con IVA compresa) e ripartizione automatica a seconda della zona.
// I numeri attesi sono calcolati a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nuovaApp, modelloDi } from './helpers-db.mjs';
import { salvaPratica, registraIncasso, eliminaPratica } from '../../src/js/data/repo/pratiche.js';
import {
  creaZona, creaCollaboratore, elencoCollaboratori, eliminaCollaboratore, aggiornaCollaboratore, usiCollaboratore,
  leggiRipartizioneZona, salvaRipartizioneZona, ripartizioneAutomatica, eliminaZona,
} from '../../src/js/data/repo/anagrafiche.js';
import { scriviImpostazioni, leggiImpostazioni } from '../../src/js/data/repo/impostazioni.js';
import { ErroreValidazione, ErroreOperazione } from '../../src/js/data/repo/errori.js';
import { oggi } from '../../src/js/core/dates.js';

const E = 100;

async function appConZona() {
  const app = await nuovaApp();
  const zona = await creaZona(app.archivio, { nome: 'Centro' });
  const [luca, giuseppe] = elencoCollaboratori(app.archivio);
  return { ...app, zona, luca, giuseppe };
}

const riga = (archivio, id) => archivio.uno('SELECT * FROM pratiche WHERE id = ?', [id]);

test('pratica dal modulo: numero, stato e date si assegnano da soli; nessun indirizzo', async () => {
  const { archivio, zona, luca } = await appConZona();
  const id = await salvaPratica(archivio, {
    zona_id: zona, prezzo_vendita_cent: 150000 * E,
    venditore_bonifico_cent: 3660 * E, acquirente_contanti_cent: 2000 * E, aliquota_iva: 22,
  }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  const p = riga(archivio, id);
  assert.match(p.codice, /^\d{4}\/001$/);
  assert.equal(p.stato, 'conclusa');
  assert.equal(p.data_pratica, oggi());
  assert.equal(p.data_rogito, oggi(), 'la data del rogito è quella dell\'inserimento');
  assert.equal(p.immobile_indirizzo, null);
  assert.equal(p.compensi_da_pagamenti, 1);
  // a mano: venditore 3.660 con IVA 22% = 3.000 + 660; acquirente 2.000 in contanti, già senza IVA
  assert.deepEqual([p.compenso_venditore_cent, p.compenso_acquirente_cent], [3000 * E, 2000 * E]);
  assert.deepEqual([p.venditore_contanti_cent, p.venditore_bonifico_cent, p.venditore_assegno_cent], [0, 3660 * E, 0]);
  assert.deepEqual([p.acquirente_contanti_cent, p.acquirente_bonifico_cent, p.acquirente_assegno_cent], [2000 * E, 0, 0]);
  // un secondo inserimento prende il numero successivo
  const id2 = await salvaPratica(archivio, { zona_id: zona, acquirente_contanti_cent: 1000 * E }, []);
  assert.match(riga(archivio, id2).codice, /^\d{4}\/002$/);
});

test('il modello calcola compenso senza IVA, IVA e totale pagato dai pagamenti, e conta il pagato come già incassato', async () => {
  const { archivio, zona, luca } = await appConZona();
  const id = await salvaPratica(archivio, {
    zona_id: zona, prezzo_vendita_cent: 150000 * E,
    venditore_bonifico_cent: 3660 * E, acquirente_contanti_cent: 2000 * E, aliquota_iva: 22,
  }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  const p = modelloDi(archivio).perId.get(id);
  assert.equal(p.compensoTotaleCent, 5000 * E, 'compenso totale senza IVA: 3.000 + 2.000');
  assert.equal(p.ivaCent, 660 * E, 'IVA solo su quanto pagato con bonifico: i contanti sono già senza IVA');
  assert.equal(p.totaleLordoCent, 5660 * E);
  assert.equal(p.pagatoAllaConclusioneCent, 5660 * E);
  assert.equal(p.incassatoCent, 5660 * E);
  assert.equal(p.daIncassareCent, 0);
  assert.equal(p.compenso_venditore_cent, 3000 * E);
  assert.equal(p.compenso_acquirente_cent, 2000 * E);
  assert.equal(p.descrizione, 'Zona Centro');
  assert.equal(p.incompleta, false, 'zona, prezzo, compensi e ripartizione ci sono');
  // gli scaglioni preimpostati: 5.000 € di cumulo = 2° scaglione (8%) → 400,00 €
  assert.equal(p.provvigioniCent, 400 * E);
  // l'elenco dei pagamenti fatti alla conclusione (per le statistiche e le esportazioni)
  const m = modelloDi(archivio);
  assert.deepEqual(m.pagamenti.map((x) => [x.parte, x.modalita, x.importo_cent, x.conIva]), [['Venditore', 'Bonifico', 366000, true], ['Acquirente', 'Contanti', 200000, false]]);
  assert.equal(m.pagamenti[0].data, oggi());
  // un incasso registrato dopo si somma a quanto pagato alla conclusione
  await registraIncasso(archivio, { praticaId: id, data: oggi(), importoCent: 100 * E });
  assert.equal(modelloDi(archivio).perId.get(id).incassatoCent, 5760 * E);
});

test('bonifico e assegno insieme: l\'IVA si toglie dalla somma; contanti, bonifico e assegno di una stessa parte', async () => {
  const { archivio, zona, luca } = await appConZona();
  const id = await salvaPratica(archivio, {
    zona_id: zona, venditore_contanti_cent: 1000 * E, venditore_bonifico_cent: 1220 * E, venditore_assegno_cent: 2440 * E, aliquota_iva: 22,
  }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  const p = modelloDi(archivio).perId.get(id);
  // con IVA: 1.220 + 2.440 = 3.660 → 3.000 + 660; più 1.000 di contanti già senza IVA
  assert.deepEqual([p.compensoTotaleCent, p.ivaCent, p.totaleLordoCent], [4000 * E, 660 * E, 4660 * E]);
  assert.equal(p.compensi.venditore.imponibileCent, 4000 * E);
});

test('modificare una pratica ricalcola tutto e si può cambiare modo di pagamento', async () => {
  const { archivio, zona, luca } = await appConZona();
  const quote = [{ collaboratore_id: luca.id, percentuale: 100 }];
  const id = await salvaPratica(archivio, { zona_id: zona, venditore_bonifico_cent: 3660 * E, aliquota_iva: 22 }, quote);
  const prima = riga(archivio, id);
  await salvaPratica(archivio, { id, codice: prima.codice, stato: prima.stato, data_pratica: prima.data_pratica, data_rogito: prima.data_rogito, zona_id: zona, venditore_contanti_cent: 3000 * E, aliquota_iva: 22 }, quote);
  const dopo = riga(archivio, id);
  assert.deepEqual([dopo.venditore_contanti_cent, dopo.venditore_bonifico_cent, dopo.compenso_venditore_cent], [3000 * E, 0, 3000 * E]);
  const p = modelloDi(archivio).perId.get(id);
  assert.deepEqual([p.compensoTotaleCent, p.ivaCent, p.totaleLordoCent], [3000 * E, 0, 3000 * E], 'stesso compenso, ora in contanti: niente IVA');
  assert.equal(dopo.codice, prima.codice, 'il numero non cambia');
});

test('importi dei pagamenti non validi vengono rifiutati con il nome del campo', async () => {
  const { archivio, zona } = await appConZona();
  await assert.rejects(
    salvaPratica(archivio, { zona_id: zona, venditore_assegno_cent: -1 }, []),
    (e) => e instanceof ErroreValidazione && /Venditore, assegno/.test(e.campi.venditore_assegno_cent),
  );
  await assert.rejects(
    salvaPratica(archivio, { zona_id: zona, acquirente_bonifico_cent: 100_000_000_001 }, []),
    (e) => e instanceof ErroreValidazione && 'acquirente_bonifico_cent' in e.campi,
  );
});

test('una pratica vecchia (solo compenso senza IVA) resta com\'era: IVA in cima, nessun pagamento', async () => {
  const { archivio, zona, luca } = await appConZona();
  const id = await salvaPratica(archivio, {
    codice: 'V/1', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-09-10', zona_id: zona,
    immobile_indirizzo: 'Via Roma 1', prezzo_vendita_cent: 100000 * E,
    compenso_venditore_cent: 2800 * E, compenso_acquirente_cent: 2800 * E, aliquota_iva: 22,
  }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  assert.equal(riga(archivio, id).compensi_da_pagamenti, 0);
  const p = modelloDi(archivio).perId.get(id);
  assert.deepEqual([p.compensoTotaleCent, p.ivaCent, p.totaleLordoCent, p.incassatoCent, p.daIncassareCent], [5600 * E, 1232 * E, 6832 * E, 0, 6832 * E]);
  assert.equal(p.descrizione, 'Via Roma 1');
  assert.equal(modelloDi(archivio).pagamenti.length, 0);
});

test('modificare e risalvare una pratica non cambia il suo modello: la vecchia resta vecchia, la nuova resta nuova', async () => {
  const { archivio, zona, luca } = await appConZona();
  const quote = [{ collaboratore_id: luca.id, percentuale: 100 }];
  const vecchia = await salvaPratica(archivio, {
    codice: 'V/2', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: '2026-09-10', zona_id: zona,
    prezzo_vendita_cent: 100000 * E, compenso_venditore_cent: 2800 * E, compenso_acquirente_cent: 2800 * E, aliquota_iva: 22,
  }, quote);
  const nuova = await salvaPratica(archivio, { zona_id: zona, venditore_bonifico_cent: 3660 * E, acquirente_contanti_cent: 2000 * E, aliquota_iva: 22 }, quote);
  // si riscrive la riga così com'è nel database (colonne dei pagamenti a 0 per la vecchia)
  for (const id of [vecchia, nuova]) await salvaPratica(archivio, { ...riga(archivio, id), note: 'ritoccata' }, quote);
  const v = riga(archivio, vecchia);
  assert.deepEqual([v.compensi_da_pagamenti, v.compenso_venditore_cent, v.compenso_acquirente_cent, v.venditore_bonifico_cent], [0, 2800 * E, 2800 * E, 0]);
  const n = riga(archivio, nuova);
  assert.deepEqual([n.compensi_da_pagamenti, n.compenso_venditore_cent, n.compenso_acquirente_cent, n.venditore_bonifico_cent, n.acquirente_contanti_cent], [1, 3000 * E, 2000 * E, 3660 * E, 2000 * E]);
  const m = modelloDi(archivio);
  assert.deepEqual([m.perId.get(vecchia).totaleLordoCent, m.perId.get(vecchia).incassatoCent], [6832 * E, 0]);
  assert.deepEqual([m.perId.get(nuova).totaleLordoCent, m.perId.get(nuova).incassatoCent], [5660 * E, 5660 * E]);
});

// ---------------------------------------------------------------- ripartizione automatica a seconda della zona

test('la ripartizione di una zona si salva, si rilegge e si cancella; deve fare esattamente 100%', async () => {
  const { archivio, zona, luca, giuseppe } = await appConZona();
  assert.deepEqual(leggiRipartizioneZona(archivio, zona), []);
  await salvaRipartizioneZona(archivio, zona, [{ collaboratore_id: luca.id, percentuale: 60 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]);
  assert.deepEqual(leggiRipartizioneZona(archivio, zona), [{ collaboratore_id: luca.id, percentuale: 60 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]);
  assert.deepEqual(modelloDi(archivio).zone.find((z) => z.id === zona).ripartizione, [{ collaboratoreId: luca.id, percentuale: 60 }, { collaboratoreId: giuseppe.id, percentuale: 40 }]);
  const rifiuta = (righe, parte) => assert.rejects(salvaRipartizioneZona(archivio, zona, righe), (e) => e instanceof ErroreValidazione && parte.test(e.campi.quote));
  await rifiuta([{ collaboratore_id: luca.id, percentuale: 60 }], /100%/);
  await rifiuta([{ collaboratore_id: luca.id, percentuale: 70 }, { collaboratore_id: giuseppe.id, percentuale: 40 }], /100%/);
  await rifiuta([{ collaboratore_id: luca.id, percentuale: 50 }, { collaboratore_id: luca.id, percentuale: 50 }], /due volte/);
  await rifiuta([{ collaboratore_id: luca.id, percentuale: 0 }, { collaboratore_id: giuseppe.id, percentuale: 100 }], /maggiore di 0/);
  await rifiuta([{ collaboratore_id: 999, percentuale: 100 }], /non esiste/);
  assert.equal(leggiRipartizioneZona(archivio, zona).length, 2, 'dopo i rifiuti resta quella di prima');
  // quote con decimali: 33,33 + 33,33 + 33,34 = 100
  const terzo = await creaCollaboratore(archivio, { nome: 'Marco' });
  await salvaRipartizioneZona(archivio, zona, [{ collaboratore_id: luca.id, percentuale: 33.33 }, { collaboratore_id: giuseppe.id, percentuale: 33.33 }, { collaboratore_id: terzo, percentuale: 33.34 }]);
  assert.equal(leggiRipartizioneZona(archivio, zona).length, 3);
  await salvaRipartizioneZona(archivio, zona, []);
  assert.deepEqual(leggiRipartizioneZona(archivio, zona), []);
  await assert.rejects(salvaRipartizioneZona(archivio, 999, []), ErroreOperazione);
});

test('ripartizione automatica: prima quella della zona, poi la predefinita, poi il collaboratore unico, altrimenti nessuna', async () => {
  const { archivio, zona, luca, giuseppe } = await appConZona();
  const altraZona = await creaZona(archivio, { nome: 'Lungomare' });
  // nessuna ripartizione impostata e due collaboratori attivi: la pratica resterà senza ripartizione
  assert.deepEqual(ripartizioneAutomatica(archivio, zona), { origine: 'nessuna', quote: [] });
  // ripartizione predefinita delle Impostazioni
  await scriviImpostazioni(archivio, { 'ripartizione.predefinita': [{ collaboratoreId: luca.id, percentuale: 50 }, { collaboratoreId: giuseppe.id, percentuale: 50 }] });
  assert.deepEqual(ripartizioneAutomatica(archivio, zona), { origine: 'predefinita', quote: [{ collaboratore_id: luca.id, percentuale: 50 }, { collaboratore_id: giuseppe.id, percentuale: 50 }] });
  // quella della zona vince sulla predefinita; l'altra zona continua a usare la predefinita
  await salvaRipartizioneZona(archivio, zona, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  assert.deepEqual(ripartizioneAutomatica(archivio, zona), { origine: 'zona', quote: [{ collaboratore_id: luca.id, percentuale: 100 }] });
  assert.equal(ripartizioneAutomatica(archivio, altraZona).origine, 'predefinita');
  assert.equal(ripartizioneAutomatica(archivio, null).origine, 'predefinita', 'senza zona vale la predefinita');
  // una predefinita che non fa 100% non si usa
  await scriviImpostazioni(archivio, { 'ripartizione.predefinita': [{ collaboratoreId: luca.id, percentuale: 40 }] });
  assert.equal(ripartizioneAutomatica(archivio, altraZona).origine, 'nessuna');
  // un solo collaboratore attivo: tutto a lui
  await aggiornaCollaboratore(archivio, giuseppe.id, { attivo: false });
  assert.deepEqual(ripartizioneAutomatica(archivio, altraZona), { origine: 'unico', quote: [{ collaboratore_id: luca.id, percentuale: 100 }] });
  assert.equal(leggiImpostazioni(archivio)['ripartizione.predefinita'].length, 1);
});

test('un collaboratore nella ripartizione di una zona non si elimina; una zona si elimina portandosi via la sua ripartizione', async () => {
  const { archivio, zona, luca, giuseppe } = await appConZona();
  await salvaRipartizioneZona(archivio, zona, [{ collaboratore_id: luca.id, percentuale: 100 }]);
  assert.deepEqual(usiCollaboratore(archivio, luca.id), { pratiche: 0, liquidazioni: 0, zone: 1 });
  await assert.rejects(eliminaCollaboratore(archivio, luca.id), (e) => e instanceof ErroreOperazione && /fa parte della ripartizione di 1 zona/.test(e.message));
  await eliminaCollaboratore(archivio, giuseppe.id); // non è in nessuna zona
  await eliminaZona(archivio, zona);
  assert.equal(archivio.valore('SELECT COUNT(*) FROM zone_quote'), 0);
  await eliminaCollaboratore(archivio, luca.id);
  assert.equal(elencoCollaboratori(archivio).length, 0);
});

test('eliminare una pratica senza indirizzo lascia nel registro la zona, non "null"', async () => {
  const { archivio, zona } = await appConZona();
  const id = await salvaPratica(archivio, { zona_id: zona, acquirente_contanti_cent: 100 * E }, []);
  await eliminaPratica(archivio, id);
  const voce = archivio.valore("SELECT dettaglio FROM registro WHERE tipo = 'pratica_eliminata'");
  assert.match(voce, /zona Centro/);
  assert.doesNotMatch(voce, /null|undefined/);
});
