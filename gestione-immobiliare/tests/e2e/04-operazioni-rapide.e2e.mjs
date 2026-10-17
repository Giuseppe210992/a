// Le otto operazioni rapide della dashboard, una per una, con il loro effetto reale sui dati.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  avvia, vai, riquadri, rimuoviSpazi, centesimi, idPratica, sql, valoreSql, scarica, leggiCsv, apriSqlite, finestra,
  attendiNotifica, bottoneFinestra, testoSospetto, scegliPeriodo, azzeraFiltri, cartellaTemp,
} from './lib.mjs';
import { inserisciDatiProva } from './dati-prova.mjs';

const E = 100;

describe('Dashboard: operazioni rapide', () => {
  let app;
  let baseline; // archivio completo esportato prima delle modifiche
  let prima; // riquadri prima delle modifiche
  const cartella = cartellaTemp('gi-ops-');
  before(async () => { app = await avvia(); await inserisciDatiProva(app.pagina); await vai(app.pagina, '#/'); prima = await riquadri(app.pagina); });
  after(async () => { await app.chiudi(); fs.rmSync(cartella, { recursive: true, force: true }); });
  // ogni prova parte dalla dashboard, senza finestre rimaste aperte da una prova precedente
  beforeEach(async () => {
    const p = app.pagina;
    for (let i = 0; i < 3 && await finestra(p).count(); i++) await p.keyboard.press('Escape');
    await p.evaluate(() => { document.querySelectorAll('dialog.modale').forEach((d) => d.remove()); });
    await vai(p, '#/');
  });

  test('ci sono esattamente otto operazioni rapide, con nome e descrizione', async () => {
    const p = app.pagina;
    const titoli = await p.$$eval('.ops-griglia .op b', (a) => a.map((x) => x.textContent.trim()));
    assert.deepEqual(titoli, [
      'Inserisci nuova compravendita', 'Cerca una pratica', 'Registra un incasso', 'Registra una liquidazione',
      'Consulta il cumulo mensile', 'Esporta i dati', 'Crea un backup', 'Importa un backup precedente',
    ]);
    assert.equal(await p.locator('.ops-griglia .op small').count(), 8);
    // archivio mai salvato: lo dice, senza inventare una data
    await p.waitForFunction(() => /Nessun backup ancora/.test(document.querySelector('#op-backup small')?.textContent ?? '')); // la data dell'ultimo backup si legge dall'archivio
    assert.match(rimuoviSpazi(await p.locator('#op-backup small').innerText()), /Nessun backup ancora/);
  });

  test('1. Inserisci nuova compravendita apre il modulo vuoto', async () => {
    const p = app.pagina;
    await p.click('#op-nuova');
    await p.waitForSelector('#contenuto h1:has-text("Nuova pratica")');
    assert.equal(await p.evaluate(() => location.hash), '#/nuova');
    await vai(p, '#/');
  });

  test('2. Cerca una pratica porta il cursore nella ricerca e mostra le pratiche recenti', async () => {
    const p = app.pagina;
    await p.click('#op-cerca');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'ricerca-rapida');
    await p.waitForSelector('.risultati-ricerca .ris-voce');
    assert.equal(await p.locator('.risultati-ricerca .ris-voce').count(), 5);
    assert.match(await p.locator('.risultati-ricerca').innerText(), /Pratiche recenti/);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
  });

  test('5. Consulta il cumulo mensile apre la schermata del cumulo', async () => {
    const p = app.pagina;
    await p.click('#op-cumulo');
    await p.waitForSelector('#contenuto h1:has-text("Cumulo mensile per zona")');
    assert.equal(await p.evaluate(() => location.hash), '#/cumulo');
    await vai(p, '#/');
  });

  test('6a. Esporta i dati: elenco delle pratiche in CSV (Excel italiano)', async () => {
    const p = app.pagina;
    await p.click('#op-esporta');
    await finestra(p).waitFor();
    assert.equal(await finestra(p).locator('input[name="esp"]').count(), 5);
    assert.equal(await finestra(p).locator('input[name="esp"]:checked').getAttribute('value'), 'pratiche');
    const file = await scarica(p, () => bottoneFinestra(p, 'Esporta').click());
    assert.match(file.nome, /^Pratiche_2026-10-16\.csv$/);
    const csv = leggiCsv(file.bytes);
    assert.equal(csv.bom, true, 'UTF-8 con BOM: Excel legge bene gli accenti');
    assert.equal(csv.intestazioni[0], 'Codice');
    assert.equal(csv.intestazioni.length, 33); // 27 di prima + sei importi pagati (contanti, bonifico, assegno × venditore e acquirente)
    assert.equal(csv.righe.length, 15);
    const col = (nome) => csv.intestazioni.indexOf(nome);
    const r11 = csv.righe.find((r) => r[0] === '2026/011');
    assert.equal(r11[col('Stato')], 'Conclusa');
    assert.equal(r11[col('Data rogito')], '09/10/2026');
    assert.equal(r11[col('Zona')], 'Centro');
    assert.equal(r11[col('Indirizzo')], 'Via Mazzini 9');
    assert.equal(r11[col('Prezzo di vendita')], '200000,00');
    assert.equal(r11[col('Totale compensi (imponibile)')], '8000,00');
    assert.equal(r11[col('Aliquota IVA %')], '22');
    assert.equal(r11[col('IVA')], '1760,00');
    assert.equal(r11[col('Totale con IVA')], '9760,00');
    assert.equal(r11[col('Collaboratori e quote')], 'Luca 100%');
    assert.equal(r11[col('Provvigioni calcolate')], '2800,00'); // 35% (scaglione raggiunto dal cumulo di ottobre: 14.000 €) su 8.000 €
    const r03 = csv.righe.find((r) => r[0] === '2026/003');
    assert.equal(r03[col('Collaboratori e quote')], 'Luca 50% / Giuseppe 50%');
    const r15 = csv.righe.find((r) => r[0] === '2026/015');
    assert.match(r15[col('Dati mancanti')], /rogito/i);
    const tot = csv.righe.reduce((s, r) => s + centesimi(r[col('Totale compensi (imponibile)')] || '0'), 0);
    assert.equal(tot, (87920 + 6200) * E, 'somma dei compensi di tutte le pratiche (anche in corso)');
    assert.equal(await finestra(p).count(), 0, 'la finestra si chiude dopo l\'esportazione');
    await attendiNotifica(p, /File “Pratiche_2026-10-16\.csv” salvato/);
  });

  test('6b. Esporta: provvigioni, incassi e liquidazioni', async () => {
    const p = app.pagina;
    const esporta = async (valore) => {
      await p.click('#op-esporta');
      await finestra(p).locator(`input[name="esp"][value="${valore}"]`).check();
      return scarica(p, () => bottoneFinestra(p, 'Esporta').click());
    };
    const prov = await esporta('provvigioni');
    assert.match(prov.nome, /^Provvigioni_/);
    const cp = leggiCsv(prov.bytes);
    assert.deepEqual(cp.intestazioni.slice(0, 4), ['Codice pratica', 'Data rogito', 'Zona', 'Collaboratore']);
    const colProv = cp.intestazioni.indexOf('Provvigione calcolata');
    const sommaProv = cp.righe.reduce((s, r) => s + centesimi(r[colProv] || '0'), 0);
    assert.equal(sommaProv, 28236 * E, 'le provvigioni esportate sommano a quelle della dashboard');
    const inc = leggiCsv((await esporta('incassi')).bytes);
    assert.equal(inc.righe.length, 4);
    assert.equal(inc.righe.reduce((s, r) => s + centesimi(r[3]), 0), 25376 * E);
    const liq = leggiCsv((await esporta('liquidazioni')).bytes);
    assert.equal(liq.righe.length, 5); // 1 + 2 + 2 righe
    assert.equal(liq.righe.reduce((s, r) => s + centesimi(r[3]), 0), 6565 * E);
  });

  test('6c. Esporta: la spunta "solo periodo e filtri" limita i dati', async () => {
    const p = app.pagina;
    await scegliPeriodo(p, 'Mese scorso');
    await p.click('#op-esporta');
    await finestra(p).locator('#esp-filtri').check();
    const csv = leggiCsv((await scarica(p, () => bottoneFinestra(p, 'Esporta').click())).bytes);
    assert.deepEqual(csv.righe.map((r) => r[0]).sort(), ['2026/009', '2026/015']);
    await azzeraFiltri(p);
  });

  test('6d. Esporta: archivio completo, un file SQLite che contiene tutti i dati', async () => {
    const p = app.pagina;
    await p.click('#op-esporta');
    await finestra(p).locator('input[name="esp"][value="completo"]').check();
    assert.equal(await finestra(p).locator('#esp-filtri').isVisible(), false, 'i filtri non hanno senso per l\'archivio completo');
    const file = await scarica(p, () => bottoneFinestra(p, 'Esporta').click());
    assert.match(file.nome, /^GestioneImmobiliare_esportazione_2026-10-16_\d{4}\.sqlite$/);
    assert.equal(Buffer.from(file.bytes.subarray(0, 15)).toString('latin1'), 'SQLite format 3');
    const db = await apriSqlite(file.bytes);
    assert.equal(db.valore('SELECT COUNT(*) FROM pratiche'), 15);
    assert.equal(db.valore('SELECT COUNT(*) FROM incassi'), 4);
    assert.equal(db.valore('SELECT COUNT(*) FROM liquidazioni'), 3);
    assert.equal(db.valore('PRAGMA application_id'), 0x47494d4d);
    assert.equal(db.valore('PRAGMA integrity_check'), 'ok');
    db.chiudi();
    baseline = path.join(cartella, 'baseline.sqlite');
    fs.writeFileSync(baseline, file.bytes);
    await attendiNotifica(p, /Archivio completo esportato/);
  });

  test('6e. Esporta si può annullare senza scaricare nulla', async () => {
    const p = app.pagina;
    await p.click('#op-esporta');
    let scaricato = false;
    p.once('download', () => { scaricato = true; });
    await bottoneFinestra(p, 'Annulla').click();
    await p.waitForTimeout(200);
    assert.equal(scaricato, false);
    assert.equal(await finestra(p).count(), 0);
  });

  test('7. Crea un backup: copia salvata, avviso "nessun backup" scompare, ultimo backup visibile', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const copie0 = await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).length);
    // l'archivio completo esportato prima conta già come copia di sicurezza (è un file che l'utente conserva)
    assert.match(rimuoviSpazi(await p.locator('#op-backup small').innerText()), /Ultimo: 16\/10\/2026/);
    await p.click('#op-backup');
    await attendiNotifica(p, /Backup creato \(\d/);
    const copie = await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).map((c) => ({ tipo: c.tipo, dimensione: c.dimensione })));
    assert.equal(copie.length, copie0 + 1);
    assert.equal(copie[0].tipo, 'manuale');
    assert.ok(copie[0].dimensione > 10000, 'il backup contiene l\'archivio completo');
    await p.waitForFunction(() => /Ultimo: 16\/10\/2026 \d\d:\d\d/.test(document.querySelector('#op-backup small')?.textContent ?? ''));
    await p.waitForFunction(() => !document.querySelector('#avvisi')?.textContent.includes('Nessun backup eseguito'));
  });

  test('3. Registra un incasso: controlli, importo residuo, salvataggio e aggiornamento dei numeri', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const incassati = async () => rimuoviSpazi(await p.locator('.kpi', { has: p.locator('.kpi-etichetta', { hasText: /^Totale compensi registrati$/ }) }).locator('.kpi-nota').innerText());
    assert.match(await incassati(), /incassati 25\.376 €/);
    await p.click('#op-incasso');
    const f = finestra(p);
    await f.waitFor();
    assert.match(await f.locator('h2').innerText(), /Registra un incasso/);
    assert.equal(await f.getByLabel('Data dell\'incasso').inputValue(), '16/10/2026');
    // senza scegliere nulla: errori chiari e la finestra resta aperta
    await bottoneFinestra(p, 'Registra incasso').click();
    await f.locator('.ha-errore').first().waitFor();
    assert.ok(await f.locator('.errore').first().innerText());
    assert.equal(await f.count(), 1);
    // importo non valido
    await f.getByLabel('Pratica').selectOption(String(await idPratica(p, '2026/011')));
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('abc');
    await bottoneFinestra(p, 'Registra incasso').click();
    assert.match(rimuoviSpazi(await f.innerText()), /Scrivi un importo valido/);
    // riepilogo in tempo reale: 8.000 + IVA 22% = 9.760 da incassare
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('1.000,00');
    const r = rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText());
    assert.match(r, /Totale dovuto \(compensi \+ IVA\) 9\.760,00 €/);
    assert.match(r, /Già incassato 0,00 €/);
    assert.match(r, /Residuo dopo questo incasso 8\.760,00 €/);
    // il pulsante "Usa l'importo residuo" compila l'importo
    await f.locator('button:has-text("Usa l\'importo residuo")').click();
    assert.equal(await f.getByLabel('Importo incassato (IVA inclusa)').inputValue(), '9.760,00');
    await f.getByLabel('Importo incassato (IVA inclusa)').fill('1000');
    await f.getByLabel('Pagato da').selectOption({ label: 'Acquirente' });
    await f.getByLabel('Metodo di pagamento').selectOption({ label: 'Bonifico' });
    await f.getByLabel('Note').fill('Acconto di prova');
    await bottoneFinestra(p, 'Registra incasso').click();
    await attendiNotifica(p, /Incasso di 1\.000,00 € registrato sulla pratica 2026\/011/);
    assert.equal(await f.count(), 0);
    const riga = (await sql(p, "SELECT i.* FROM incassi i JOIN pratiche p ON p.id = i.pratica_id WHERE p.codice = '2026/011'"))[0];
    assert.deepEqual([riga.importo_cent, riga.data, riga.pagante, riga.metodo, riga.note], [100000, '2026-10-16', 'Acquirente', 'Bonifico', 'Acconto di prova']);
    await p.waitForFunction(() => [...document.querySelectorAll('.kpi-nota')].some((n) => /incassati 26\.376\s€/.test(n.textContent)));
    assert.match(await incassati(), /incassati 26\.376 €/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 5);
  });

  test('3b. L\'incasso registrato compare nella scheda della pratica e nel riepilogo dovuto', async () => {
    const p = app.pagina;
    await vai(p, `#/pratiche/${await idPratica(p, '2026/011')}`);
    const t = rimuoviSpazi(await p.locator('#contenuto').innerText());
    assert.match(t, /1\.000,00 €/);
    assert.match(t, /Acconto di prova/);
    assert.match(t, /8\.760,00 €/); // ancora da incassare
    await vai(p, '#/');
  });

  test('4. Registra una liquidazione: elenco delle pratiche, distribuzione, conferma, salvataggio', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    await p.click('#op-liquidazione');
    const f = finestra(p);
    await f.waitFor();
    // senza collaboratore: spiegazione
    assert.match(rimuoviSpazi(await f.innerText()), /Scegli un collaboratore per vedere le provvigioni da liquidare/);
    await bottoneFinestra(p, 'Registra liquidazione').click();
    assert.match(rimuoviSpazi(await f.innerText()), /Scegli il collaboratore/);
    await f.getByLabel('Collaboratore').selectOption(String(await valoreSql(p, "SELECT id FROM collaboratori WHERE nome = 'Giuseppe'")));
    const righe = f.locator('tbody tr');
    assert.equal(await righe.count(), 6);
    const dati = await righe.evaluateAll((tr) => tr.map((r) => [...r.children].slice(1, 5).map((c) => c.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())));
    const per = Object.fromEntries(dati.map((d) => [d[0].match(/^\d{4}\/\d{3}/)[0], d.slice(1)]));
    assert.deepEqual(per['2026/003'], ['570,00 €', '0,00 €', '570,00 €']);
    assert.deepEqual(per['2026/005'], ['3.640,00 €', '1.000,00 €', '2.640,00 €']);
    assert.deepEqual(per['2026/008'], ['4.480,00 €', '0,00 €', '4.480,00 €']);
    assert.ok(!per['2026/002'], 'la 002 è già liquidata per intero');
    // tutte selezionate di partenza: totale = tutto il dovuto
    assert.match(rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText()), /Totale della liquidazione 11\.314,00 €/);
    await f.locator('button:has-text("Nessuna")').click();
    assert.match(rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText()), /Totale della liquidazione 0,00 €/);
    await bottoneFinestra(p, 'Registra liquidazione').click();
    assert.equal(await f.count(), 1, 'senza righe scelte non si registra');
    await attendiNotifica(p, /Seleziona almeno una pratica/);
    // distribuzione di 1.000 € dalle più vecchie: 003 (570) e poi 005 (430)
    await f.getByLabel('Oppure distribuisci un importo (dalle più vecchie)').fill('1000');
    await f.locator('button:has-text("Distribuisci")').click();
    const importi = await righe.evaluateAll((tr) => tr.map((r) => ({ codice: r.children[1].textContent.trim().match(/^\d{4}\/\d{3}/)[0], sel: r.querySelector('input[type=checkbox]').checked, importo: r.querySelector('input.input').value })));
    assert.deepEqual(importi.filter((x) => x.sel).map((x) => [x.codice, x.importo]), [['2026/003', '570,00'], ['2026/005', '430,00']]);
    assert.match(rimuoviSpazi(await f.locator('.riepilogo-calcolo').innerText()), /Totale della liquidazione 1\.000,00 €/);
    // si sceglie invece la sola 008 e si prova a pagare di più del dovuto: chiede conferma
    await f.locator('button:has-text("Nessuna")').click();
    const r008 = righe.filter({ hasText: '2026/008' });
    await r008.locator('input.input').fill('5.000,00');
    await bottoneFinestra(p, 'Registra liquidazione').click();
    await p.waitForSelector('dialog.modale[open] >> text=Importo superiore al dovuto');
    await p.locator('dialog.modale[open]').last().locator('button:has-text("Annulla")').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni'), 3, 'dopo Annulla nulla è stato registrato');
    await r008.locator('input.input').fill('4.480,00');
    await f.getByLabel('Metodo', { exact: true }).selectOption({ label: 'Bonifico' });
    await f.getByLabel('Note').fill('Saldo agosto');
    await bottoneFinestra(p, 'Registra liquidazione').click();
    await attendiNotifica(p, /Liquidazione di 4\.480,00 € registrata per Giuseppe/);
    assert.equal(await f.count(), 0);
    const l = (await sql(p, 'SELECT * FROM liquidazioni ORDER BY id DESC LIMIT 1'))[0];
    assert.deepEqual([l.data, l.metodo, l.note], ['2026-10-16', 'Bonifico', 'Saldo agosto']);
    const rr = await sql(p, 'SELECT r.importo_cent, p.codice FROM liquidazioni_righe r JOIN pratiche p ON p.id = r.pratica_id WHERE r.liquidazione_id = ?', [l.id]);
    assert.deepEqual(rr, [{ importo_cent: 448000, codice: '2026/008' }]);
    // i riquadri si sono aggiornati: da liquidare 21.671 − 4.480 = 17.191 €
    await p.waitForFunction(() => /Liquidate 11\.045\s€ su 28\.236\s€/.test(document.body.textContent));
    const dopo = await riquadri(p);
    assert.equal(dopo.daLiquidare, 17191 * E);
    assert.equal(dopo.maturate, prima.maturate);
  });

  test('8. Importa un backup: un file sbagliato viene rifiutato spiegando perché, senza toccare i dati', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    const falso = path.join(cartella, 'non-un-archivio.txt');
    fs.writeFileSync(falso, 'Questo non è un database.\n'.repeat(20));
    const pratiche0 = await valoreSql(p, 'SELECT COUNT(*) FROM pratiche');
    const [sceltaFile] = await Promise.all([p.waitForEvent('filechooser'), p.click('#op-importa')]);
    await sceltaFile.setFiles(falso);
    const f = finestra(p);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /Il file non può essere importato/);
    assert.match(rimuoviSpazi(await f.innerText()), /non-un-archivio\.txt/);
    assert.match(rimuoviSpazi(await f.innerText()), /non è un archivio di Gestione Immobiliare/);
    assert.match(rimuoviSpazi(await f.innerText()), /dati attuali non sono stati modificati/);
    await bottoneFinestra(p, 'Ho capito').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), pratiche0);
    // un database SQLite di un altro programma
    const altro = path.join(cartella, 'altro.sqlite');
    const { motore } = await import('../unit/helpers-db.mjs');
    const SQL = await motore();
    const d = new SQL.Database();
    d.run('CREATE TABLE x (a); INSERT INTO x VALUES (1); CREATE TABLE y (b); ');
    fs.writeFileSync(altro, Buffer.from(d.export()));
    const [scelta2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#op-importa')]);
    await scelta2.setFiles(altro);
    await f.waitFor();
    assert.match(rimuoviSpazi(await f.innerText()), /non appartiene a Gestione Immobiliare|non ha la struttura attesa/);
    await bottoneFinestra(p, 'Ho capito').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM pratiche'), pratiche0);
  });

  test('8b. Importa un backup valido: anteprima del contenuto, Annulla non cambia nulla, conferma sostituisce i dati', async () => {
    const p = app.pagina;
    await vai(p, '#/');
    assert.ok(baseline && fs.existsSync(baseline), 'serve il file esportato in precedenza');
    // prima si annulla
    let [sceltaFile] = await Promise.all([p.waitForEvent('filechooser'), p.click('#op-importa')]);
    await sceltaFile.setFiles(baseline);
    const f = finestra(p);
    await f.waitFor();
    const t = rimuoviSpazi(await f.innerText());
    assert.match(t, /Sostituire tutti i dati con questo backup\?/);
    assert.match(t, /baseline\.sqlite/);
    assert.match(t, /15 pratiche, 2 collaboratori, 3 zone, 4 incassi e 3 liquidazioni/);
    assert.match(t, /Pratiche dal 14\/01\/2026 al /);
    assert.match(t, /Prima dell'importazione viene salvata automaticamente una copia/);
    await bottoneFinestra(p, 'Annulla').click();
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 5, 'Annulla: i dati attuali restano');
    // poi si conferma
    const copie0 = await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).length);
    [sceltaFile] = await Promise.all([p.waitForEvent('filechooser'), p.click('#op-importa')]);
    await sceltaFile.setFiles(baseline);
    await f.waitFor();
    await bottoneFinestra(p, 'Sostituisci i dati').click();
    await attendiNotifica(p, /Importazione completata: 15 pratiche caricate/);
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM incassi'), 4, 'l\'incasso aggiunto dopo l\'esportazione non c\'è più');
    assert.equal(await valoreSql(p, 'SELECT COUNT(*) FROM liquidazioni'), 3);
    const copie = await p.evaluate(async () => (await window.__gi.app.driver.elencaCopie()).map((c) => c.tipo));
    assert.equal(copie.length, copie0 + 1);
    assert.ok(copie.includes('pre-importazione'), 'prima dell\'importazione è stata salvata una copia di sicurezza');
    // la dashboard è tornata ai valori di partenza, senza ricaricare
    await p.waitForFunction(() => /Liquidate 6\.565\s€ su 28\.236\s€/.test(document.body.textContent));
    assert.deepEqual(await riquadri(p), prima);
  });

  test('nessun errore in console e nessun "null" nelle pagine', async () => {
    assert.deepEqual(await testoSospetto(app.pagina), []);
    assert.deepEqual(app.errori, []);
  });
});
