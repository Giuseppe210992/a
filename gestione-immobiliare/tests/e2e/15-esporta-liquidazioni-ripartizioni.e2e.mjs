// Altri controlli che le prove precedenti non avevano mai azionato: esportazioni CSV di liquidazioni e incassi, tutti i modi di usare
// la finestra "Registra una liquidazione", il pulsante dentro la notifica, la ripartizione predefinita e le quote nel modulo della pratica.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, centesimi, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, attendiQuiete, testoSospetto, scarica, leggiCsv } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

describe('Provvigioni: esportazioni CSV di liquidazioni e incassi', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });

  test('Liquidazioni › Esporta in CSV: una riga per ogni pratica pagata, in italiano', async () => {
    const p = app.pagina;
    await vai(p, '#/provvigioni');
    await p.getByRole('tab', { name: /Liquidazioni/ }).click();
    await p.locator('#tabella-liquidazioni').waitFor();
    const file = await scarica(p, () => p.getByRole('button', { name: 'Esporta in CSV' }).click());
    assert.match(file.nome, /Liquidazioni.*\.csv$/);
    const csv = leggiCsv(file.bytes);
    assert.equal(csv.bom, true, 'UTF-8 con BOM: Excel mostra bene le lettere accentate');
    assert.deepEqual(csv.intestazioni, ['Data', 'Collaboratore', 'Pratica', 'Importo', 'Metodo', 'Note']);
    assert.equal(csv.righe.length, await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni_righe'));
    const totale = csv.righe.reduce((s, r) => s + centesimi(r[3]), 0);
    assert.equal(totale, await valoreSql(p, 'SELECT SUM(importo_cent) FROM liquidazioni_righe'));
    assert.match(csv.righe[0][0], /^\d{2}\/\d{2}\/\d{4}$/, 'date come gg/mm/aaaa');
    await attendiNotifica(p, /Liquidazioni esportate in CSV/);
  });

  test('Incassi › Esporta in CSV: una riga per incasso, con importi in euro', async () => {
    const p = app.pagina;
    await vai(p, '#/provvigioni');
    await p.getByRole('tab', { name: /Incassi/ }).click();
    await p.locator('#tabella-incassi').waitFor();
    const file = await scarica(p, () => p.getByRole('button', { name: 'Esporta in CSV' }).click());
    assert.match(file.nome, /Incassi.*\.csv$/);
    const csv = leggiCsv(file.bytes);
    assert.deepEqual(csv.intestazioni, ['Data', 'Codice pratica', 'Pratica', 'Importo', 'IVA', 'Pagante', 'Metodo', 'Note']);
    assert.ok(csv.righe.every((r) => r[4] === 'compresa'), 'gli incassi registrati a parte sono sempre indicati IVA compresa');
    assert.equal(csv.righe.length, await valoreSql(p, 'SELECT COUNT(*) FROM incassi'));
    assert.equal(csv.righe.reduce((s, r) => s + centesimi(r[3]), 0), await valoreSql(p, 'SELECT SUM(importo_cent) FROM incassi'));
    await attendiNotifica(p, /Incassi esportati in CSV/);
  });

  test('Archivio pratiche › Esporta l\'elenco con filtri che non trovano nulla lo dice senza scaricare niente', async () => {
    const p = app.pagina;
    await vai(p, '#/pratiche?q=zzzqq');
    await p.getByRole('button', { name: 'Esporta l\'elenco' }).click();
    await attendiNotifica(p, /Non ci sono pratiche da esportare con questi filtri/);
  });
});

describe('Finestre di registrazione: tutti i pulsanti', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await vai(p, '#/');
  });
  const idCollab = (p, nome) => valoreSql(p, 'SELECT id FROM collaboratori WHERE nome = ?', [nome]);
  const dovutoA = (p, nome) => p.evaluate((n) => window.__gi.modello().collaboratori.find((c) => c.nome === n).daLiquidareCent, nome);
  const totaleDialogo = async (p) => centesimi(await finestra(p).locator('.riepilogo-calcolo .riga.totale').innerText());

  test('Liquidazione: "Nessuna" e "Tutte" selezionano le pratiche e compilano gli importi; il totale è quello da liquidare', async () => {
    const p = app.pagina;
    await p.click('#op-liquidazione');
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel('Collaboratore').selectOption(String(await idCollab(p, 'Luca')));
    await f.locator('tbody input[type="checkbox"]').first().waitFor();
    const dovuto = await dovutoA(p, 'Luca');
    assert.ok(dovuto > 0);
    await f.getByRole('button', { name: 'Nessuna' }).click();
    assert.equal(await f.locator('tbody input[type="checkbox"]:checked').count(), 0);
    assert.equal(await totaleDialogo(p), 0);
    await f.getByRole('button', { name: 'Tutte' }).click();
    assert.ok(await f.locator('tbody input[type="checkbox"]:checked').count() > 0);
    assert.equal(await totaleDialogo(p), dovuto, 'il totale è tutto ciò che resta da liquidare a Luca');
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('Liquidazione: spuntare una pratica con l\'importo vuoto propone l\'importo da liquidare; "Distribuisci" senza importo spiega cosa fare', async () => {
    const p = app.pagina;
    await p.click('#op-liquidazione');
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel('Collaboratore').selectOption(String(await idCollab(p, 'Luca')));
    const casella = f.locator('tbody input[type="checkbox"]').first();
    const importo = f.locator('tbody input[type="text"]').first();
    await casella.waitFor();
    const proposto = await importo.inputValue();
    assert.ok(proposto && proposto !== '0,00');
    await importo.fill('');
    await casella.uncheck();
    await casella.check();
    assert.equal(await importo.inputValue(), proposto, 'spuntando, l\'importo vuoto si compila con quello da liquidare');
    // Distribuisci senza scrivere l'importo
    await f.getByLabel(/^Oppure distribuisci un importo/).fill('');
    await f.getByRole('button', { name: 'Distribuisci' }).click();
    assert.match(rimuoviSpazi(await f.innerText()), /Scrivi l'importo da distribuire/);
    await bottoneFinestra(p, 'Annulla').click();
  });

  test('Liquidazione: un collaboratore senza nulla da liquidare lo dice; senza collaboratori rimanda alle impostazioni', async () => {
    const p = app.pagina;
    await p.evaluate(async () => { const { api, app: a } = window.__gi; await api.creaCollaboratore(a.archivio, { nome: 'Nuova Persona' }); });
    await p.click('#op-liquidazione');
    const f = finestra(p);
    await f.waitFor();
    await f.getByLabel('Collaboratore').selectOption(String(await idCollab(p, 'Nuova Persona')));
    await p.waitForFunction(() => /Non c'è nulla da liquidare a questo collaboratore/.test(document.querySelector('dialog.modale[open]').textContent));
    await bottoneFinestra(p, 'Annulla').click();
    // senza nessun collaboratore (si eliminano quelli senza usi) la finestra spiega cosa fare
    const app2 = await avvia();
    try {
      const q = app2.pagina;
      await q.evaluate(async () => {
        const { api, app: a } = window.__gi;
        for (const c of api.elencoCollaboratori(a.archivio)) await api.eliminaCollaboratore(a.archivio, c.id);
      });
      await q.click('#op-liquidazione');
      await finestra(q).waitFor();
      assert.match(rimuoviSpazi(await finestra(q).innerText()), /Non ci sono collaboratori\. Aggiungili da Impostazioni/);
    } finally { await app2.chiudi(); }
  });

  test('Incasso: togliendo la pratica il riepilogo sparisce; dopo il salvataggio la notifica ha il pulsante "Apri la pratica"', async () => {
    const p = app.pagina;
    await p.click('#op-incasso');
    const f = finestra(p);
    await f.waitFor();
    const id = await idPratica(p, '2026/012');
    await f.getByLabel('Pratica').selectOption(String(id));
    await f.locator('.riepilogo-calcolo').waitFor({ state: 'visible' });
    await f.getByLabel('Pratica').selectOption('');
    await f.locator('.riepilogo-calcolo').waitFor({ state: 'hidden' });
    await f.getByLabel('Pratica').selectOption(String(id));
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('100,00');
    await bottoneFinestra(p, 'Registra incasso').click();
    await attendiNotifica(p, /Incasso di 100,00 € registrato sulla pratica 2026\/012/);
    await p.locator('.toast-area .toast:not([data-vecchia])').getByRole('button', { name: 'Apri la pratica' }).click();
    await p.waitForFunction((x) => location.hash === `#/pratiche/${x}`, id);
    await p.waitForSelector('#contenuto h1:has-text("Via Pergolesi 1")');
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
    void sql; void attendiQuiete;
  });
});

describe('Ripartizione predefinita, zone e quote nel modulo della pratica', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await vai(p, '#/');
  });
  const apriRipartizione = async (p) => { await vai(p, '#/impostazioni?sezione=ripartizione'); await p.waitForSelector('#salva-ripartizione'); };
  const L = (p, nome) => p.locator('#form-pratica').getByLabel(nome);

  test('Impostazioni › Ripartizione predefinita: cambiare collaboratore, togliere una riga, errori chiari e salvataggio', async () => {
    const p = app.pagina;
    await apriRipartizione(p);
    // nessuna riga: si aggiunge Luca, poi la seconda riga propone Giuseppe
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    assert.equal(await p.locator('.quota-riga').count(), 2);
    // con tutti i collaboratori già usati il pulsante lo dice
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    await attendiNotifica(p, /Hai già aggiunto tutti i collaboratori attivi/);
    // una riga senza collaboratore impedisce di salvare
    await p.getByLabel('Collaboratore 2', { exact: true }).selectOption('');
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /C'è una riga senza collaboratore/);
    // si cambia il collaboratore della prima riga (Luca → Giuseppe) e si toglie la seconda
    await p.getByLabel('Collaboratore 1', { exact: true }).selectOption({ label: 'Giuseppe' });
    await p.getByRole('button', { name: 'Togli il collaboratore 2' }).click();
    assert.equal(await p.locator('.quota-riga').count(), 1);
    await p.getByLabel('Quota 1', { exact: true }).fill('100');
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo').innerText()), /Totale quote: 100%/);
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Ripartizione predefinita salvata/);
    assert.deepEqual(JSON.parse(await valoreSql(p, "SELECT valore FROM impostazioni WHERE chiave = 'ripartizione.predefinita'")).map((r) => r.percentuale), [100]);
    // "Nessuna ripartizione predefinita" svuota l'elenco
    await p.getByRole('button', { name: 'Nessuna ripartizione predefinita' }).click();
    assert.equal(await p.locator('.quota-riga').count(), 0);
    assert.match(rimuoviSpazi(await p.locator('.imp-corpo').innerText()), /Nessuna ripartizione predefinita: le zone senza una ripartizione propria restano senza assegnazione/);
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Ripartizione predefinita salvata/);
  });

  test('Nuova pratica: la ripartizione segue la zona; la predefinita 70/30 vale solo per le zone che non ne hanno una propria', async () => {
    const p = app.pagina;
    // ripartizione predefinita 70/30 (dalle Impostazioni)
    await apriRipartizione(p);
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    await p.getByRole('button', { name: 'Aggiungi collaboratore' }).click();
    await p.getByLabel('Quota 1', { exact: true }).fill('70');
    await p.getByLabel('Quota 2', { exact: true }).fill('30');
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Ripartizione predefinita salvata/);
    // una zona senza ripartizione propria
    await vai(p, '#/impostazioni?sezione=zone');
    await p.getByLabel(/^Nome della zona/).fill('Zona libera');
    await p.getByRole('button', { name: 'Aggiungi zona' }).click();
    await attendiNotifica(p, /Zona “Zona libera” aggiunta/);

    await vai(p, '#/nuova');
    await p.waitForSelector('#form-pratica');
    const righe = async () => (await p.locator('#ripartizione-automatica .ripartizione-elenco li').allInnerTexts()).map(rimuoviSpazi);
    const zona = p.locator('#form-pratica').getByLabel(/^Zona\*?$/);
    assert.equal(await p.locator('.quote-riga').count(), 0, 'nel modulo non si sceglie la ripartizione');
    await zona.selectOption({ label: 'Zona libera' });
    assert.deepEqual(await righe(), ['Luca 70%', 'Giuseppe 30%'], 'la predefinita per la zona senza ripartizione propria');
    await zona.selectOption({ label: 'Collina' });
    assert.deepEqual(await righe(), ['Luca 50%', 'Giuseppe 50%'], 'Collina ha la sua (50/50)');
    await zona.selectOption({ label: 'Lungomare' });
    assert.deepEqual(await righe(), ['Giuseppe 100%'], 'Lungomare è di Giuseppe');
    // si salva in una zona senza ripartizione propria: la pratica prende la predefinita 70/30
    await zona.selectOption({ label: 'Zona libera' });
    await p.locator('#pagamenti-acquirente').getByLabel('Contanti').fill('2.000');
    await conSalvataggio(p);
    assert.deepEqual((await sql(p, "SELECT c.nome, q.percentuale FROM quote q JOIN collaboratori c ON c.id = q.collaboratore_id JOIN pratiche pr ON pr.id = q.pratica_id JOIN zone z ON z.id = pr.zona_id WHERE z.nome = 'Zona libera' ORDER BY c.id")).map((r) => [r.nome, r.percentuale]), [['Luca', 70], ['Giuseppe', 30]]);
    // la ripartizione predefinita non serve più alle prove seguenti
    await apriRipartizione(p);
    await p.getByRole('button', { name: 'Nessuna ripartizione predefinita' }).click();
    await p.click('#salva-ripartizione');
    await attendiNotifica(p, /Ripartizione predefinita salvata/);
    void L;
  });

  test('Impostazioni › Zone: Disattiva e Attiva funzionano; una zona in uso si disattiva dalla finestra che spiega perché non si elimina', async () => {
    const p = app.pagina;
    await vai(p, '#/impostazioni?sezione=zone');
    await p.getByLabel(/^Nome della zona/).fill('Zona di passaggio');
    await p.getByRole('button', { name: 'Aggiungi zona' }).click();
    await attendiNotifica(p, /Zona “Zona di passaggio” aggiunta/);
    const riga = (nome) => p.locator('.riga-elenco', { hasText: nome }).first();
    await riga('Zona di passaggio').getByRole('button', { name: 'Disattiva' }).click();
    await attendiNotifica(p, /Zona di passaggio: disattivata/);
    await p.waitForFunction(() => [...document.querySelectorAll('.riga-elenco')].find((r) => r.dataset.nome === 'Zona di passaggio')?.textContent.includes('Non attivo'));
    assert.equal(await valoreSql(p, "SELECT attiva FROM zone WHERE nome = 'Zona di passaggio'"), 0);
    await riga('Zona di passaggio').getByRole('button', { name: 'Attiva' }).click();
    await attendiNotifica(p, /Zona di passaggio: attivata/);
    assert.equal(await valoreSql(p, "SELECT attiva FROM zone WHERE nome = 'Zona di passaggio'"), 1);
    // "Centro" ha pratiche: Elimina non la cancella e propone di disattivarla
    await riga('Centro').getByRole('button', { name: 'Elimina' }).click();
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Zona in uso: non si può eliminare/);
    await bottoneFinestra(p, 'Disattiva').click();
    await attendiNotifica(p, /Centro disattivata/);
    assert.equal(await valoreSql(p, "SELECT attiva FROM zone WHERE nome = 'Centro'"), 0);
    await riga('Centro').getByRole('button', { name: 'Attiva' }).click();
    await attendiNotifica(p, /Centro: attivata/);
    assert.equal(await valoreSql(p, "SELECT attiva FROM zone WHERE nome = 'Centro'"), 1);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
  });
});

/** Salva la pratica dal pulsante "Salva" e attende la scheda. */
async function conSalvataggio(p) {
  await p.click('#salva-pratica');
  await p.waitForFunction(() => /^#\/pratiche\/\d+$/.test(location.hash));
}
