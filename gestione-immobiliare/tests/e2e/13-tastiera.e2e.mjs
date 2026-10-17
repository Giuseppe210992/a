// Uso da tastiera: Invio nei moduli e nelle finestre. Chi lavora a un PC scrive il valore e preme Invio:
// deve succedere ciò che farebbe il pulsante principale, e solo dove è sicuro (mai nella liquidazione a più righe).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, conNavigazione, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

describe('Tastiera: Invio nei moduli e nelle finestre', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await vai(p, '#/');
  });

  test('Registra un incasso: Invio nel campo importo lo registra e chiude la finestra', async () => {
    const p = app.pagina;
    const n0 = await valoreSql(p, 'SELECT COUNT(*) FROM incassi');
    await p.click('#op-incasso');
    const f = finestra(p);
    await f.waitFor();
    // con un importo non valido Invio non registra nulla e spiega l'errore
    await f.getByLabel('Pratica').selectOption(String(await idPratica(p, '2026/011')));
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('abc');
    await f.getByLabel('Importo incassato (IVA inclusa)').press('Enter');
    await f.locator('.ha-errore').first().waitFor();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), n0);
    assert.equal(await f.count(), 1, 'la finestra resta aperta');
    // con un importo valido sì
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('500,00');
    await f.getByLabel('Importo incassato (IVA inclusa)').press('Enter');
    await attendiNotifica(p, /Incasso di 500,00 € registrato sulla pratica 2026\/011/);
    assert.equal(await finestra(p).count(), 0);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), n0 + 1);
    assert.equal(await valoreSql(p, "SELECT i.importo_cent FROM incassi i JOIN pratiche p ON p.id = i.pratica_id WHERE p.codice = '2026/011' ORDER BY i.id DESC LIMIT 1"), 50000);
  });

  test('Modifica incasso dalla scheda: Invio salva la modifica', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/011')}`);
    await p.getByRole('button', { name: /Modifica l'incasso del 16\/10\/2026/ }).click();
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel('Importo (IVA inclusa)').fill('600,00');
    await f.getByLabel('Importo (IVA inclusa)').press('Enter');
    await attendiNotifica(p, /Incasso aggiornato/);
    assert.equal(await finestra(p).count(), 0);
    assert.equal(await valoreSql(p, "SELECT i.importo_cent FROM incassi i JOIN pratiche p ON p.id = i.pratica_id WHERE p.codice = '2026/011' ORDER BY i.id DESC LIMIT 1"), 60000);
  });

  test('Registra una liquidazione: Invio nel campo "distribuisci" distribuisce l\'importo e NON registra il pagamento', async () => {
    const p = app.pagina;
    const n0 = await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni');
    await p.click('#op-liquidazione');
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel('Collaboratore').selectOption(String(await valoreSql(p, "SELECT id FROM collaboratori WHERE nome = 'Luca'")));
    await f.locator('tbody input[type="checkbox"]').first().waitFor();
    const campo = f.getByLabel(/^Oppure distribuisci un importo/);
    await campo.fill('1.000,00');
    await campo.press('Enter');
    await p.waitForFunction(() => /1\.000,00\s€/.test(document.querySelector('dialog.modale[open] .riepilogo-calcolo .riga.totale')?.textContent ?? ''));
    assert.equal(await f.count(), 1, 'la finestra resta aperta: Invio non conferma il pagamento');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni'), n0);
    // anche Invio in un importo di riga non registra niente: per una liquidazione serve il pulsante
    await f.locator('tbody input[type="text"]').first().press('Enter');
    assert.equal(await f.count(), 1);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni'), n0);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('Nuova pratica: Invio in un campo salva la pratica e apre la scheda', async () => {
    const p = app.pagina;
    const n0 = await valoreSql(p, 'SELECT COUNT(*) FROM pratiche');
    await vai(p, '#/nuova');
    await p.locator('#form-pratica').getByLabel(/^Zona\*?$/).selectOption({ label: 'Centro' });
    await p.locator('#form-pratica').getByLabel('Nominativo del venditore').fill('Mario Rossi');
    await p.locator('#form-pratica').getByLabel('Nominativo dell\'acquirente').fill('Anna Bianchi');
    const contanti = p.locator('#pagamenti-venditore').getByLabel('Contanti');
    await contanti.fill('1.000');
    await conNavigazione(p, () => contanti.press('Enter'));
    assert.match(await p.evaluate(() => location.hash), /^#\/pratiche\/\d+$/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), n0 + 1);
    assert.equal(await valoreSql(p, 'SELECT venditore_contanti_cent FROM pratiche ORDER BY id DESC LIMIT 1'), 100000);
  });

  test('Nuova zona dal modulo della pratica: Invio crea la zona e la sceglie', async () => {
    const p = app.pagina;
    await vai(p, '#/nuova');
    await p.getByRole('button', { name: 'Nuova zona' }).click();
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel(/^Nome della zona/).fill('Zona Tastiera');
    await f.getByLabel(/^Nome della zona/).press('Enter');
    await attendiNotifica(p, /Zona “Zona Tastiera” creata/);
    assert.equal(await finestra(p).count(), 0);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone WHERE nome = 'Zona Tastiera'"), 1);
    assert.equal(await p.locator('#form-pratica').getByLabel(/^Zona\*?$/).locator('option:checked').innerText(), 'Zona Tastiera');
    // il modulo ha ora modifiche non salvate: si esce confermando
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForFunction(() => document.querySelector('dialog.modale[open]') || document.querySelector('#contenuto h1')?.textContent === 'Dashboard');
    if (await finestra(p).count()) await bottoneFinestra(p, 'Esci senza salvare').click();
  });

  test('Modifica di una zona dalle Impostazioni: Invio salva il nuovo nome', async () => {
    const p = app.pagina;
    await vai(p, '#/impostazioni?sezione=zone');
    await p.locator('.riga-elenco', { hasText: 'Zona Tastiera' }).getByRole('button', { name: 'Modifica' }).click();
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel(/^Nome/).fill('Zona Tastiera Due');
    await f.getByLabel(/^Nome/).press('Enter');
    await attendiNotifica(p, /Modifiche salvate/);
    assert.equal(await finestra(p).count(), 0);
    assert.equal(await valoreSql(p, "SELECT COUNT(*) FROM zone WHERE nome = 'Zona Tastiera Due'"), 1);
  });

  test('"Cancella tutti i dati": Invio senza la parola non fa nulla; con CANCELLA scritta conferma', async () => {
    const p = app.pagina;
    const pratiche0 = await valoreSql(p, 'SELECT COUNT(*) FROM pratiche');
    assert.ok(pratiche0 > 0);
    await vai(p, '#/backup');
    await p.click('#bk-azzera');
    const f = finestra(p);
    await f.waitFor();
    const campo = f.getByLabel('Scrivi CANCELLA per confermare');
    await campo.press('Enter');
    assert.equal(await f.count(), 1, 'senza la parola Invio non conferma');
    await campo.fill('cancel');
    await campo.press('Enter');
    assert.equal(await f.count(), 1, 'con una parola sbagliata nemmeno');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), pratiche0);
    await campo.fill('CANCELLA');
    await campo.press('Enter');
    await attendiNotifica(p, /Archivio azzerato/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    assert.deepEqual((await sql(p, 'SELECT nome FROM collaboratori ORDER BY id')).map((r) => r.nome), ['Luca', 'Giuseppe', 'Capo', 'Segretaria']);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
    void rimuoviSpazi;
  });
});
