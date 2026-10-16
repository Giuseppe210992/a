// Persistenza: i dati inseriti dall'interfaccia restano dopo la chiusura e la riapertura del programma
// (stesso profilo del browser = stesso computer), anche chiudendo subito dopo un salvataggio; recupero se il file è danneggiato.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apriContesto, apriApp, vai, rimuoviSpazi, sql, valoreSql, finestra, bottoneFinestra, attendiNotifica, testoSospetto, riquadri, cartellaTemp, scarica } from './lib.mjs';

const E = 100;

/** Apre una finestra del programma sul profilo indicato (come avviare il programma). */
async function avviaProgramma(profilo, opzioni = {}) {
  const c = await apriContesto({ profilo, ...opzioni });
  const pagina = c.ctx.pages()[0] ?? await c.ctx.newPage();
  c.seguiPagina(pagina);
  await apriApp(pagina, opzioni.hash || '');
  return { ...c, pagina };
}

describe('Persistenza dopo chiusura e riapertura', () => {
  const profilo = cartellaTemp('gi-profilo-');
  const cartella = cartellaTemp('gi-persist-');
  let sessione1; let sessione2; let sessione3;
  after(async () => {
    for (const s of [sessione1, sessione2, sessione3]) { try { await s?.chiudi(); } catch { /* già chiusa */ } }
    fs.rmSync(profilo, { recursive: true, force: true });
    fs.rmSync(cartella, { recursive: true, force: true });
  });

  test('1ª apertura: si inseriscono zone, scaglioni, una pratica, un incasso, una liquidazione e le impostazioni, solo dall\'interfaccia', async () => {
    sessione1 = await avviaProgramma(profilo);
    const p = sessione1.pagina;
    try {
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0, 'archivio nuovo: nessun dato');
    // zona
    await vai(p, '#/impostazioni?sezione=zone');
    await p.getByLabel('Nome della zona').fill('Centro');
    await p.click('#aggiungi-zona');
    await attendiNotifica(p, /Zona “Centro” aggiunta/);
    // scaglioni: al primo avvio ci sono già quelli dell'agenzia (5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre)
    await vai(p, '#/impostazioni?sezione=scaglioni');
    assert.deepEqual(await p.locator('#tabella-editor-scaglioni tbody tr').evaluateAll((tr) => tr.map((r) => [...r.querySelectorAll('input')].map((i) => i.value).join('/'))), ['0,00/5', '2.600,01/8', '5.200,01/11', '7.800,01/15', '13.000,01/20']);
    // se ne cambia uno dall'interfaccia (l'ultimo, che non incide sui numeri sotto): deve restare dopo la chiusura
    await p.getByLabel('Percentuale dello scaglione 5').fill('22');
    await p.click('#salva-scaglioni');
    await attendiNotifica(p, /Scaglioni predefiniti salvati/);
    // pratica
    await vai(p, '#/nuova');
    const F = (e, o = {}) => p.locator('#form-pratica').getByLabel(e, o);
    await F('Indirizzo dell\'immobile').fill('Via Persistente 1');
    await F('Comune').fill('Minturno');
    await F(/^Zona$/).selectOption({ label: 'Centro' });
    await F(/^Stato/).selectOption('conclusa');
    await F('Data di apertura').fill('01/10/2026');
    await F('Data del rogito').fill('14/10/2026');
    await F('Prezzo di vendita').fill('200.000');
    await F('Compenso dal venditore').fill('3.000');
    await F('Compenso dall\'acquirente').fill('3.000');
    await p.getByRole('button', { name: 'Tutto a Luca' }).click();
    await p.click('#salva-pratica');
    await attendiNotifica(p, /Pratica 2026\/001 salvata/);
    // incasso e liquidazione dalla dashboard
    await vai(p, '#/');
    await p.click('#op-incasso');
    await finestra(p).getByLabel('Pratica').selectOption({ index: 1 });
    await finestra(p).getByLabel('Importo incassato (IVA inclusa)').fill('2.000');
    await bottoneFinestra(p, 'Registra incasso').click();
    await attendiNotifica(p, /Incasso di 2\.000,00 € registrato/);
    await p.click('#op-liquidazione');
    await finestra(p).getByLabel('Collaboratore').selectOption({ label: /Luca/.test('Luca') ? (await finestra(p).getByLabel('Collaboratore').locator('option').allInnerTexts()).find((x) => x.startsWith('Luca')) : 'Luca' });
    await finestra(p).locator('button:has-text("Nessuna")').click();
    await finestra(p).locator('tbody tr input.input').first().fill('200');
    await bottoneFinestra(p, 'Registra liquidazione').click();
    await attendiNotifica(p, /Liquidazione di 200,00 € registrata per Luca/);
    // impostazioni, tema e barra
    await vai(p, '#/impostazioni?sezione=calcolo');
    await p.locator('input[name="metodo"][value="progressivo"]').check();
    await attendiNotifica(p, /Impostazione salvata/);
    await p.click('.tb-azioni button[aria-label^="Passa al tema"]'); // → scuro
    await p.click('.sb-riduci');
    // backup manuale
    await vai(p, '#/');
    await p.click('#op-backup');
    await attendiNotifica(p, /Backup creato/);
    // cumulo di Luca in ottobre 6.000 € = 3° scaglione (11%); metodo progressivo (scelto sopra): 130 + 208 + 800 × 11% = 426 €, meno 200 € già liquidati
    assert.deepEqual(await riquadri(p), { concluse: 1, compensi: 6000 * E, maturate: 426 * E, daLiquidare: 226 * E, valore: 200000 * E, inCorso: 0 });
    // ultima azione: si chiude SUBITO dopo (la finestra di conferma si chiude solo a salvataggio avvenuto)
    await p.click('#op-incasso');
    await finestra(p).getByLabel('Pratica').selectOption({ index: 1 });
    await finestra(p).getByLabel('Importo incassato (IVA inclusa)').fill('123,45');
    await bottoneFinestra(p, 'Registra incasso').click();
    await p.waitForFunction(() => document.querySelectorAll('dialog.modale').length === 0);
    await sessione1.chiudi(); // chiusura del programma
    sessione1 = null;
    } catch (e) { await sessione1?.chiudi().catch(() => {}); sessione1 = null; throw e; } // una prova fallita non deve lasciare il profilo bloccato
  });

  test('2ª apertura: tutto è ancora al suo posto, compresi tema, barra laterale e impostazioni', async () => {
    sessione2 = await avviaProgramma(profilo);
    const p = sessione2.pagina;
    try {
    assert.deepEqual(await sql(p, 'SELECT (SELECT COUNT(*) FROM pratiche) AS pratiche, (SELECT COUNT(*) FROM zone) AS zone, (SELECT COUNT(*) FROM incassi) AS incassi, (SELECT COUNT(*) FROM liquidazioni) AS liq, (SELECT COUNT(*) FROM scaglioni) AS scaglioni, (SELECT COUNT(*) FROM quote) AS quote'),
      [{ pratiche: 1, zone: 1, incassi: 2, liq: 1, scaglioni: 5, quote: 1 }]);
    assert.deepEqual((await sql(p, 'SELECT percentuale FROM scaglioni WHERE zona_id IS NULL ORDER BY da_cent')).map((r) => r.percentuale), [5, 8, 11, 15, 22], 'anche lo scaglione modificato');
    const pr = (await sql(p, 'SELECT * FROM pratiche'))[0];
    assert.deepEqual([pr.codice, pr.stato, pr.immobile_indirizzo, pr.immobile_comune, pr.data_rogito, pr.prezzo_vendita_cent, pr.compenso_venditore_cent, pr.compenso_acquirente_cent],
      ['2026/001', 'conclusa', 'Via Persistente 1', 'Minturno', '2026-10-14', 20000000, 300000, 300000]);
    assert.deepEqual((await sql(p, 'SELECT importo_cent FROM incassi ORDER BY id')).map((r) => r.importo_cent), [200000, 12345], 'anche l\'incasso inserito subito prima di chiudere');
    // impostazioni, tema e barra laterale
    assert.equal(await valoreSql(p, "SELECT valore FROM impostazioni WHERE chiave = 'calcolo.metodo'"), '"progressivo"');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await p.evaluate(() => document.body.dataset.sidebar), 'ridotta');
    // numeri (incassato 2.123,45 € di 7.320 €)
    assert.deepEqual(await riquadri(p), { concluse: 1, compensi: 6000 * E, maturate: 426 * E, daLiquidare: 226 * E, valore: 200000 * E, inCorso: 0 });
    // il backup manuale di prima è nell'archivio storico, e all'avvio è stata fatta la copia automatica del giorno
    await vai(p, '#/backup');
    const tipi = await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).map((c) => c.tipo).sort());
    assert.deepEqual(tipi, ['automatico', 'manuale']);
    assert.match(rimuoviSpazi(await p.locator('#contenuto').innerText()), /Ultimo backup: 16\/10\/2026 \d\d:\d\d \(oggi\)/);
    // il file conserva anche i filtri? No: i filtri sono di sessione. Si riparte dall'anno corrente.
    assert.match(rimuoviSpazi(await p.textContent('.tb-periodo')), /Anno 2026/);
    // una nuova modifica nella 2ª sessione
    await vai(p, '#/impostazioni?sezione=zone');
    await p.getByLabel('Nome della zona').fill('Lungomare');
    await p.click('#aggiungi-zona');
    await attendiNotifica(p, /Zona “Lungomare” aggiunta/);
    assert.deepEqual(await testoSospetto(p), []);
    assert.deepEqual(sessione2.errori, []);
    await sessione2.chiudi();
    sessione2 = null;
    } catch (e) { await sessione2?.chiudi().catch(() => {}); sessione2 = null; throw e; }
  });

  test('3ª apertura: le modifiche di entrambe le sessioni ci sono; con l\'archivio danneggiato compare la schermata di recupero', async () => {
    sessione3 = await avviaProgramma(profilo);
    const p = sessione3.pagina;
    assert.deepEqual((await sql(p, 'SELECT nome FROM zone ORDER BY nome')).map((r) => r.nome), ['Centro', 'Lungomare']);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 2);
    // si danneggia il file dei dati (come dopo un'interruzione o un disco difettoso) e si riapre
    await p.evaluate(() => new Promise((ok, ko) => {
      const rq = indexedDB.open('gestione-immobiliare', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('archivio', 'readwrite');
        tx.objectStore('archivio').put({ bytes: new Uint8Array(600).fill(7), salvatoIl: 'x' }, 'principale');
        tx.oncomplete = () => { rq.result.close(); ok(); };
        tx.onerror = () => ko(tx.error);
      };
      rq.onerror = () => ko(rq.error);
    }));
    await p.reload();
    await p.waitForSelector('.nota.errore');
    let t = rimuoviSpazi(await p.locator('body').innerText());
    assert.match(t, /L'archivio dei dati non si apre/);
    assert.match(t, /Non è stato cancellato nulla/);
    assert.match(t, /copie disponibili/i);
    assert.match(t, /Copia del 16\/10\/2026 \d\d:\d\d Manuale/);
    assert.match(t, /Automatico/);
    assert.equal(await p.locator('.sidebar').count(), 0, 'nessuna schermata normale: non si lavora su dati illeggibili');
    // ripristino dalla copia manuale
    const riga = p.locator('.riga-elenco', { hasText: 'Manuale' });
    await riga.getByRole('button', { name: 'Ripristina' }).click();
    t = rimuoviSpazi(await finestra(p).innerText());
    assert.match(t, /Ripartire da questa copia\?/);
    assert.match(t, /La copia contiene 1 pratiche/);
    assert.match(t, /Il file illeggibile viene conservato/);
    await bottoneFinestra(p, 'Annulla').click();
    await riga.getByRole('button', { name: 'Ripristina' }).click();
    await bottoneFinestra(p, 'Ripristina').click();
    await p.waitForSelector('.sidebar', { timeout: 20000 });
    await p.waitForFunction(() => window.__gi?.app?.archivio);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 1);
    assert.equal(await valoreSql(p, 'SELECT immobile_indirizzo FROM pratiche'), 'Via Persistente 1');
    // il file danneggiato è stato conservato tra le copie
    const copie = await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).map((c) => ({ tipo: c.tipo, dimensione: c.dimensione })));
    assert.ok(copie.some((c) => c.tipo === 'pre-ripristino' && c.dimensione === 600), `file danneggiato conservato: ${JSON.stringify(copie)}`);
    assert.deepEqual(sessione3.errori.filter((e) => !/illeggibile|SQLite|danneggiat|not a database|malformed/i.test(e)), []);
  });

  test('archivio danneggiato: ripartire da un file di backup oppure da un archivio vuoto (con parola di conferma)', async () => {
    const p = sessione3.pagina;
    // file di backup valido = esportazione dell'archivio attuale
    const file = await scarica(p, async () => { await vai(p, '#/backup'); await p.click('#bk-esporta'); });
    const backup = path.join(cartella, 'backup.sqlite');
    fs.writeFileSync(backup, file.bytes);
    const danneggia = () => p.evaluate(() => new Promise((ok, ko) => {
      const rq = indexedDB.open('gestione-immobiliare', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('archivio', 'readwrite');
        tx.objectStore('archivio').put({ bytes: new Uint8Array(900).fill(3), salvatoIl: 'x' }, 'principale');
        tx.oncomplete = () => { rq.result.close(); ok(); };
      };
      rq.onerror = () => ko(rq.error);
    }));
    await danneggia();
    await p.reload();
    await p.waitForSelector('.nota.errore');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'Scegli un file di backup…' }).click()]);
    await fc.setFiles(backup);
    assert.match(rimuoviSpazi(await finestra(p).innerText()), /“backup\.sqlite” contiene 1 pratiche/);
    await bottoneFinestra(p, 'Usa questo file').click();
    await p.waitForSelector('.sidebar', { timeout: 20000 });
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 1);
    // archivio vuoto: serve scrivere VUOTO
    await danneggia();
    await p.reload();
    await p.waitForSelector('.nota.errore');
    await p.getByRole('button', { name: 'Riparti da un archivio vuoto…' }).click();
    const conferma = bottoneFinestra(p, 'Archivio vuoto');
    assert.equal(await conferma.isDisabled(), true);
    await finestra(p).getByLabel('Scrivi VUOTO per confermare').fill('vuoto');
    assert.equal(await conferma.isDisabled(), false);
    await conferma.click();
    await p.waitForSelector('.sidebar', { timeout: 20000 });
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 0);
    assert.deepEqual((await sql(p, 'SELECT nome FROM collaboratori ORDER BY id')).map((r) => r.nome), ['Luca', 'Giuseppe']);
    // le copie di sicurezza ci sono ancora: si torna ai dati con "Ripristina"
    await vai(p, '#/backup');
    const manuale = p.locator('#tabella-storico tbody tr', { hasText: 'Manuale' }).first();
    await manuale.getByRole('button', { name: 'Ripristina' }).click();
    await bottoneFinestra(p, 'Ripristina questa copia').click();
    await attendiNotifica(p, /Dati ripristinati: 1 pratiche/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), 1);
  });

  test('errore di salvataggio: lo dice chiaramente, non perde le modifiche e permette di riprovare o esportare', async () => {
    const p = sessione3.pagina;
    await vai(p, '#/');
    await p.evaluate(() => {
      const d = window.__gi.app.driver;
      window.__salvaOriginale = d.salva.bind(d);
      d.salva = async () => { throw new Error('Spazio esaurito (prova)'); };
    });
    await p.click('#op-incasso');
    await finestra(p).getByLabel('Pratica').selectOption({ index: 1 });
    await finestra(p).getByLabel('Importo incassato (IVA inclusa)').fill('10');
    await bottoneFinestra(p, 'Registra incasso').click();
    await p.waitForSelector('.banner-errore:not([hidden])');
    const banner = rimuoviSpazi(await p.locator('.banner-errore').innerText());
    assert.match(banner, /I dati non sono stati salvati/);
    assert.match(banner, /Spazio esaurito \(prova\)/);
    assert.equal(await p.locator('.sb-stato-testo').innerText(), 'Errore di salvataggio');
    assert.equal(await p.locator('.sb-punto').getAttribute('data-stato'), 'errore');
    await p.keyboard.press('Escape'); // l'eventuale finestra rimasta aperta
    // riprovare ancora con il problema presente non nasconde l'errore
    await p.getByRole('button', { name: 'Riprova a salvare' }).click();
    await p.waitForTimeout(300);
    assert.equal(await p.locator('.banner-errore').isVisible(), true);
    // risolto il problema, "Riprova" salva e l'avviso sparisce
    await p.evaluate(() => { window.__gi.app.driver.salva = window.__salvaOriginale; });
    await p.getByRole('button', { name: 'Riprova a salvare' }).click();
    await attendiNotifica(p, /Salvataggio riuscito/);
    await p.locator('.banner-errore').waitFor({ state: 'hidden' });
    assert.equal(await p.locator('.sb-stato-testo').innerText(), 'Dati salvati');
    // la modifica fatta durante l'errore è arrivata sul disco: si vede dopo un ricaricamento
    await p.reload();
    await p.waitForFunction(() => window.__gi?.app?.archivio);
    assert.ok((await sql(p, 'SELECT importo_cent FROM incassi')).some((r) => r.importo_cent === 1000));
    await p.evaluate(async () => { const { api, app } = window.__gi; await api.eliminaIncasso(app.archivio, app.archivio.valore('SELECT id FROM incassi WHERE importo_cent = 1000')); });
  });

  test('un\'altra scheda sullo stesso archivio non può sovrascrivere i dati (una sola finestra attiva)', async () => {
    const p = sessione3.pagina;
    const seconda = await sessione3.ctx.newPage();
    sessione3.seguiPagina(seconda);
    await seconda.goto(p.url().split('#')[0]);
    await seconda.waitForSelector('.avvio, .sidebar', { timeout: 15000 });
    const t = rimuoviSpazi(await seconda.locator('body').innerText());
    assert.match(t, /già aperto in un'altra finestra/);
    assert.equal(await seconda.locator('.sidebar').count(), 0, 'la seconda finestra non lavora sui dati');
    // chiusa la prima finestra, la seconda può riprovare e aprirsi
    await p.close();
    // il blocco passa alla seconda finestra appena la prima è davvero chiusa: chi usa il programma riprova finché si apre
    let aperta = false;
    for (let tentativo = 0; tentativo < 10 && !aperta; tentativo++) {
      await seconda.getByRole('button', { name: 'Riprova' }).click();
      aperta = await seconda.waitForSelector('.sidebar', { timeout: 2500 }).then(() => true, () => false);
    }
    assert.ok(aperta, 'dopo aver chiuso la prima finestra, la seconda si apre');
    await seconda.waitForFunction(() => window.__gi?.app?.archivio);
    assert.equal(await valoreSql(seconda, 'SELECT COUNT(*) FROM pratiche'), 1);
  });
});
