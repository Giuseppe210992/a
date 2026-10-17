// Controlli dell'intestazione che le altre prove non avevano mai azionato (individuati con la copertura del codice):
// la campanella con l'elenco degli avvisi e le loro azioni, e la ricerca rapida usata con le frecce e con Invio.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avvia, vai, rimuoviSpazi, sql, valoreSql, idPratica, finestra, bottoneFinestra, attendiNotifica, attendiQuiete, testoSospetto } from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

/** Sposta in avanti l'orologio della pagina (oltre allo scarto fisso già impostato dalle prove). */
const avanzaOrologio = (p, giorni) => p.evaluate((g) => {
  const Reale = window.Date; const scarto = g * 86400000;
  function DataFinta(...a) {
    if (!new.target) return new Reale(Reale.now() + scarto).toString();
    return a.length === 0 ? new Reale(Reale.now() + scarto) : new Reale(...a);
  }
  DataFinta.prototype = Reale.prototype; DataFinta.now = () => Reale.now() + scarto; DataFinta.parse = Reale.parse; DataFinta.UTC = Reale.UTC;
  Object.setPrototypeOf(DataFinta, Reale);
  window.Date = DataFinta;
}, giorni);

const campanella = (p) => p.locator('.topbar').getByRole('button', { name: /^Avvisi/ });
const quanteCopie = (p) => p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).length);

describe('Campanella e avvisi', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && (await finestra(p).count() || await p.locator('.popover-avvisi').count()); i++) await p.keyboard.press('Escape');
    await vai(p, '#/');
  });

  test('la campanella apre l\'elenco; Nascondi toglie un avviso (anche dal numero); Esc chiude e riporta il cursore sul pulsante', async () => {
    const p = app.pagina;
    const n = Number((await campanella(p).getAttribute('aria-label')).match(/(\d+)/)[1]);
    assert.ok(n >= 2, `ci sono avvisi con i dati di prova (${n})`);
    await campanella(p).click();
    const pop = p.locator('.popover-avvisi');
    await pop.waitFor();
    assert.equal(await campanella(p).getAttribute('aria-expanded'), 'true');
    assert.equal(await pop.locator('li.avviso').count(), n, 'l\'elenco ha tanti avvisi quanti dice il pulsante');
    const titoloNascosto = rimuoviSpazi(await pop.locator('li.avviso .avviso-titolo').first().innerText());
    await pop.locator('li.avviso').first().getByRole('button', { name: 'Nascondi' }).click();
    await p.waitForFunction((x) => document.querySelectorAll('.popover-avvisi li.avviso').length === x, n - 1);
    assert.equal(await campanella(p).getAttribute('aria-label'), `Avvisi: ${n - 1}`);
    assert.ok(!rimuoviSpazi(await pop.innerText()).includes(titoloNascosto), 'l\'avviso nascosto non è più nell\'elenco');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.popover-avvisi', { state: 'detached' });
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), `Avvisi: ${n - 1}`, 'il cursore torna sul pulsante');
    // nella dashboard si possono rimostrare
    await vai(p, '#/');
    await p.getByRole('button', { name: /Mostra di nuovo gli avvisi nascosti \(1\)/ }).click();
    await p.waitForFunction((x) => document.querySelector('.topbar button[aria-label^="Avvisi"]').getAttribute('aria-label') === `Avvisi: ${x}`, n);
  });

  test('"Crea backup ora" dall\'avviso crea davvero una copia e l\'avviso sparisce', async () => {
    const p = app.pagina;
    const prima = await quanteCopie(p);
    await campanella(p).click();
    const pop = p.locator('.popover-avvisi');
    await pop.waitFor();
    assert.match(rimuoviSpazi(await pop.innerText()), /Nessun backup eseguito/);
    await pop.getByRole('button', { name: 'Crea backup ora' }).click();
    await attendiNotifica(p, /Fatto\./);
    assert.equal(await quanteCopie(p), prima + 1);
    assert.equal(await p.locator('.popover-avvisi').count(), 0, 'la campanella si chiude dopo l\'azione');
    await campanella(p).click();
    assert.doesNotMatch(rimuoviSpazi(await p.locator('.popover-avvisi').innerText()), /Nessun backup eseguito/);
    await p.keyboard.press('Escape');
  });

  test('con il tasto Invio sul pulsante dell\'avviso succede lo stesso che con il clic', async () => {
    const p = app.pagina;
    await campanella(p).focus();
    await p.keyboard.press('Enter');
    const pop = p.locator('.popover-avvisi');
    await pop.waitFor();
    assert.ok(await pop.locator('li.avviso').count() > 0);
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.popover-avvisi').count(), 0);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
  });
});

describe('Avvisi che dipendono dallo stato dei dati', () => {
  test('"Backup non recente": dopo più giorni dall\'ultima copia l\'avviso lo dice e il pulsante ne crea una nuova', async () => {
    const app = await avvia();
    try {
      const p = app.pagina;
      await inserisciDatiProva(p);
      await vai(p, '#/backup');
      await p.click('#bk-crea');
      await attendiNotifica(p, /Backup creato/);
      await avanzaOrologio(p, 9);
      await p.evaluate(() => window.__gi.shell.aggiornaAvvisi());
      await campanella(p).click();
      const pop = p.locator('.popover-avvisi');
      await pop.waitFor();
      const testo = rimuoviSpazi(await pop.innerText());
      assert.match(testo, /Backup non recente/);
      assert.match(testo, /risale a 9 giorni fa \(soglia: 7 giorni\)/);
      await pop.getByRole('button', { name: 'Crea backup ora' }).click();
      await attendiNotifica(p, /Fatto\./);
      await campanella(p).click();
      assert.doesNotMatch(rimuoviSpazi(await p.locator('.popover-avvisi').innerText()), /Backup non recente/);
    } finally { await app.chiudi(); }
  });

  test('"Scaglioni non configurati": con pratiche concluse e nessuno scaglione l\'avviso porta alle impostazioni', async () => {
    const app = await avvia();
    try {
      const p = app.pagina;
      await p.evaluate(async () => {
        const { api, app: a } = window.__gi;
        await api.salvaTabellaScaglioni(a.archivio, null, []); // il programma parte con gli scaglioni dell'agenzia: qui si prova il caso «senza»
        const z = await api.creaZona(a.archivio, { nome: 'Zona prova' });
        const [luca] = api.elencoCollaboratori(a.archivio);
        await api.salvaPratica(a.archivio, {
          codice: 'T/1', stato: 'conclusa', data_pratica: '2026-08-01', data_rogito: '2026-09-15', zona_id: z,
          immobile_indirizzo: 'Via Prova 1', prezzo_vendita_cent: 10000000, compenso_venditore_cent: 300000, compenso_acquirente_cent: 300000, aliquota_iva: 22,
        }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
      });
      await vai(p, '#/');
      await campanella(p).click();
      const pop = p.locator('.popover-avvisi');
      await pop.waitFor();
      assert.match(rimuoviSpazi(await pop.innerText()), /Scaglioni non configurati/);
      await pop.getByRole('link', { name: 'Vai alle impostazioni' }).click();
      await p.waitForFunction(() => location.hash === '#/impostazioni?sezione=scaglioni');
      await p.waitForFunction(() => [...document.querySelectorAll('.imp-corpo h2')].some((h) => h.textContent.trim() === 'Scaglioni e percentuali'));
      assert.equal(await p.locator('.popover-avvisi').count(), 0);
    } finally { await app.chiudi(); }
  });

  test('problemi di integrità: l\'avviso urgente porta alla verifica, che mostra il problema', async () => {
    const app = await avvia();
    try {
      const p = app.pagina;
      await inserisciDatiProva(p);
      // un riferimento a una pratica che non esiste: lo si può creare solo saltando i controlli del database
      await p.evaluate(() => {
        const a = window.__gi.app.archivio;
        a.db.run('PRAGMA foreign_keys = OFF');
        a.db.run('INSERT INTO quote (pratica_id, collaboratore_id, percentuale) VALUES (99999, 1, 10)');
        a.db.run('PRAGMA foreign_keys = ON');
        a.versione += 1;
        return window.__gi.shell.aggiornaAvvisi(); // si attende che gli avvisi siano ricalcolati
      });
      await campanella(p).click();
      const pop = p.locator('.popover-avvisi');
      await pop.waitFor();
      assert.match(rimuoviSpazi(await pop.innerText()), /Problemi di integrità del database/);
      await pop.getByRole('link', { name: 'Vai alla verifica' }).click();
      await p.waitForSelector('#integrita');
      assert.match(rimuoviSpazi(await p.locator('#integrita').innerText()), /fanno riferimento a elementi che non esistono più/);
      // la pagina scorre fino alla scheda della verifica
      await p.waitForFunction(() => { const r = document.getElementById('integrita').getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; });
    } finally { await app.chiudi(); }
  });
});

describe('Ricerca rapida con la tastiera', () => {
  let app;
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); });
  after(async () => { await app.chiudi(); });
  beforeEach(async () => { await vai(app.pagina, '#/'); });

  const voci = (p) => p.locator('.risultati-ricerca .ris-voce');
  const cerca = async (p, testo) => {
    const campo = p.locator('#ricerca-rapida');
    await campo.click();
    await campo.fill(testo);
    // l'elenco si aggiorna dopo una breve attesa: si aspetta quello della parola scritta, non quello delle pratiche recenti
    await p.waitForFunction(() => /pratich[ae] trovat[ae]|Nessun risultato/.test(document.querySelector('#ricerca-risultati').textContent));
    return campo;
  };
  const codiceDelleVoce = async (p, i) => (await voci(p).nth(i).locator('.ris-principale').innerText()).split(' — ')[0].trim();
  const codiceAperto = async (p) => valoreSql(p, 'SELECT codice FROM pratiche WHERE id = ?', [Number((await p.evaluate(() => location.hash)).split('/').pop())]);

  test('le frecce su e giù scorrono i risultati; Invio apre quello evidenziato', async () => {
    const p = app.pagina;
    const campo = await cerca(p, 'Via');
    assert.ok(await voci(p).count() >= 3);
    await campo.press('ArrowDown');
    assert.equal(await voci(p).nth(0).getAttribute('aria-selected'), 'true');
    await campo.press('ArrowDown');
    assert.equal(await voci(p).nth(1).getAttribute('aria-selected'), 'true');
    assert.equal(await voci(p).nth(0).getAttribute('aria-selected'), 'false');
    await campo.press('ArrowUp');
    assert.equal(await voci(p).nth(0).getAttribute('aria-selected'), 'true');
    await campo.press('ArrowDown');
    const atteso = await codiceDelleVoce(p, 1);
    await campo.press('Enter');
    await p.waitForFunction(() => /^#\/pratiche\/\d+$/.test(location.hash));
    assert.equal(await codiceAperto(p), atteso);
    assert.equal(await p.locator('#ricerca-rapida').inputValue(), '', 'la ricerca torna vuota');
  });

  test('senza una scelta, Invio apre la prima pratica se i risultati sono tutti visibili', async () => {
    const p = app.pagina;
    const campo = await cerca(p, 'Lungomare');
    const n = await voci(p).count();
    assert.ok(n >= 2 && n <= 8, `più risultati ma tutti visibili (${n})`);
    assert.match(rimuoviSpazi(await p.locator('.risultati-ricerca .ris-piede').last().innerText()), /Invio apre la prima pratica/);
    const primo = await codiceDelleVoce(p, 0);
    await campo.press('Enter');
    await p.waitForFunction(() => /^#\/pratiche\/\d+$/.test(location.hash));
    assert.equal(await codiceAperto(p), primo);
  });

  test('con più di otto risultati Invio li mostra tutti nell\'archivio; Maiusc+Invio lo fa sempre', async () => {
    const p = app.pagina;
    let campo = await cerca(p, 'Roccaverde');
    assert.ok(await voci(p).count() === 8);
    assert.match(rimuoviSpazi(await p.locator('.risultati-ricerca .ris-piede').last().innerText()), /Mostrati 8 su 13\. Premi Invio per vederli tutti nell'archivio/);
    await campo.press('Enter');
    await p.waitForFunction(() => location.hash === '#/pratiche?q=Roccaverde');
    await p.waitForFunction(() => /13 pratiche/.test(document.querySelector('#contenuto').innerText));
    assert.equal(await p.locator('#ricerca-rapida').inputValue(), '');
    await vai(p, '#/');
    campo = await cerca(p, 'Lungomare');
    await campo.press('Shift+Enter');
    await p.waitForFunction(() => location.hash === '#/pratiche?q=Lungomare');
    await p.waitForSelector('#contenuto h1:has-text("Archivio pratiche")');
    await p.waitForSelector('#tabella-archivio tbody tr');
    await attendiQuiete(p, 100);
    assert.ok(await p.locator('#tabella-archivio tbody tr').count() >= 2);
  });

  test('senza risultati lo spiega, e Invio porta comunque alla ricerca nell\'archivio', async () => {
    const p = app.pagina;
    const campo = p.locator('#ricerca-rapida');
    await campo.click();
    await campo.fill('zzzqq');
    await p.waitForFunction(() => /Nessun risultato/.test(document.querySelector('#ricerca-risultati').textContent));
    assert.match(rimuoviSpazi(await p.locator('.risultati-ricerca').innerText()), /Nessun risultato per “zzzqq”/);
    await campo.press('Enter');
    await p.waitForFunction(() => location.hash === '#/pratiche?q=zzzqq');
    await p.waitForSelector('#contenuto h1:has-text("Archivio pratiche")');
    await p.waitForFunction(() => /Nessuna pratica|nessuna pratica|0 pratiche/.test(document.querySelector('#contenuto').innerText));
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(app.errori, []);
    assert.deepEqual(await testoSospetto(app.pagina), []);
    void sql; void idPratica;
  });
});
