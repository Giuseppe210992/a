// Finestre di dialogo condivise: registra incasso, registra liquidazione, esporta dati,
// crea backup, importa backup. Usate dalla dashboard, dalle operazioni rapide e dalle schede.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto } from '../core/app.js';
import { naviga } from '../core/router.js';
import { oggi } from '../core/dates.js';
import { eur, dataIt, dataOra, dimensioneFile, leggiEuro, numDec } from '../core/format.js';
import { apriModale, conferma, ok as notificaOk, notifica, segnalaErrore, errore as notificaErrore } from '../core/ui.js';
import { campoSelezione, campoData, campoImporto, campoTesto, campoAreaTesto, mostraErrori } from './campi.js';
import { registraIncasso, registraLiquidazione, PAGANTI, METODI_PAGAMENTO } from '../data/repo/pratiche.js';
import { creaBackup, esportaArchivio, leggiFileDaImportare, applicaImportazione } from '../data/backup.js';
import { csvPratiche, csvProvvigioni, csvIncassi, csvLiquidazioni, codificaTesto, nomeFile } from '../data/esporta.js';
import { concluseNelContesto } from '../data/calc/aggregati.js';

const etichettaPratica = (p) => `${p.codice} — ${p.immobile_indirizzo}`;

// ------------------------------------------------------------------ incasso

export function apriDialogoIncasso({ praticaId = null } = {}) {
  const m = modello();
  const candidate = m.pratiche.filter((p) => !p.annullata).sort((a, b) => (b.dataRif > a.dataRif ? 1 : b.dataRif < a.dataRif ? -1 : b.id - a.id));
  if (!candidate.length) {
    return apriModale({
      titolo: 'Registra un incasso', icona: 'info', tonoIcona: 'info',
      contenuto: h('p', null, 'Non c\'è ancora nessuna pratica a cui collegare l\'incasso. Inserisci prima una pratica.'),
      azioni: [{ id: 'annulla', etichetta: 'Chiudi', tipo: 'secondario' }, { id: 'vai', etichetta: 'Nuova pratica', tipo: 'primario', onClick: () => { naviga('#/nuova'); } }],
    });
  }
  const selPratica = campoSelezione({
    etichetta: 'Pratica', obbligatorio: true, vuoto: 'Scegli la pratica…', valore: praticaId ?? '',
    opzioni: candidate.map((p) => ({ valore: p.id, etichetta: `${etichettaPratica(p)}${p.daIncassareCent > 0 ? ` (da incassare ${eur(p.daIncassareCent)})` : ' (saldata)'}` })),
  });
  const data = campoData({ etichetta: 'Data dell\'incasso', valore: oggi(), obbligatorio: true });
  const importo = campoImporto({ etichetta: 'Importo incassato (IVA inclusa)', obbligatorio: true });
  const pagante = campoSelezione({ etichetta: 'Pagato da', vuoto: 'Non indicato', opzioni: PAGANTI.map((x) => ({ valore: x, etichetta: x })) });
  const metodo = campoSelezione({ etichetta: 'Metodo di pagamento', vuoto: 'Non indicato', opzioni: METODI_PAGAMENTO.map((x) => ({ valore: x, etichetta: x })) });
  const note = campoAreaTesto({ etichetta: 'Note', righe: 2, maxlength: 400 });
  const riepilogo = h('div', { class: 'riepilogo-calcolo', 'aria-live': 'polite' });
  const riempiResiduo = h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => {
    const p = m.perId.get(+selPratica.get());
    if (p) importo.set(p.daIncassareCent);
    aggiornaRiepilogo();
  } }, 'Usa l\'importo residuo');

  function aggiornaRiepilogo() {
    const p = m.perId.get(+selPratica.get());
    if (!p) { riepilogo.hidden = true; return; }
    riepilogo.hidden = false;
    const nuovo = importo.get() || 0;
    const residuoDopo = p.totaleLordoCent - p.incassatoCent - nuovo;
    monta(riepilogo,
      h('div', { class: 'riga' }, h('span', null, 'Totale dovuto (compensi + IVA)'), h('span', { class: 'valore' }, eur(p.totaleLordoCent))),
      h('div', { class: 'riga' }, h('span', null, 'Già incassato'), h('span', { class: 'valore' }, eur(p.incassatoCent))),
      h('div', { class: 'riga totale' }, h('span', null, nuovo > 0 ? 'Residuo dopo questo incasso' : 'Ancora da incassare'), h('span', { class: `valore ${residuoDopo < 0 ? 'negativo' : ''}` }, eur(nuovo > 0 ? residuoDopo : p.daIncassareCent))),
      residuoDopo < 0 ? h('div', { class: 'nota attenzione', style: { marginTop: '6px' } }, icona('triangle-alert', { dimensione: 18 }), h('span', null, `L'importo supera il dovuto di ${eur(-residuoDopo)}. Puoi registrarlo lo stesso (ad esempio un acconto per spese), ma verrà segnalato tra gli avvisi.`)) : null,
    );
  }
  selPratica.input.addEventListener('change', aggiornaRiepilogo);
  importo.input.addEventListener('input', aggiornaRiepilogo);
  if (praticaId) aggiornaRiepilogo(); else riepilogo.hidden = true;

  const campi = { praticaId: selPratica, data, importoCent: importo };
  const form = h('form', { onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'griglia-campi' },
      h('div', { class: 'c-12' }, selPratica.el),
      h('div', { class: 'c-6' }, data.el),
      h('div', { class: 'c-6' }, h('div', null, importo.el, h('div', { style: { marginTop: '6px' } }, riempiResiduo))),
      h('div', { class: 'c-6' }, pagante.el), h('div', { class: 'c-6' }, metodo.el),
      h('div', { class: 'c-12' }, riepilogo),
      h('div', { class: 'c-12' }, note.el)));
  const dlg = apriModale({
    titolo: 'Registra un incasso', descrizione: 'Il pagamento ricevuto dal cliente per i compensi di una pratica.', icona: 'banknote', tonoIcona: 'info', larghezza: 640,
    contenuto: form,
    azioni: [
      { id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' },
      { id: 'salva', etichetta: 'Registra incasso', tipo: 'primario', icona: 'check', onClick: async () => {
        if (!importo.valido()) { importo.errore('Scrivi un importo valido, ad esempio 1.500,00'); return false; }
        try {
          const id = await registraIncasso(app.archivio, {
            praticaId: selPratica.get() === '' ? null : +selPratica.get(), data: data.get(), importoCent: importo.get() ?? 0,
            pagante: pagante.get(), metodo: metodo.get(), note: note.get(),
          });
          const p = m.perId.get(+selPratica.get());
          notificaOk(`Incasso di ${eur(importo.get())} registrato${p ? ` sulla pratica ${p.codice}` : ''}.`, p ? { azione: { etichetta: 'Apri la pratica', onClick: () => naviga(`#/pratiche/${p.id}`) } } : {});
          void id;
        } catch (e) {
          if (e.campi) { mostraErrori(campi, e.campi); return false; }
          throw e;
        }
      } },
    ],
  });
  return dlg;
}

// ------------------------------------------------------------------ liquidazione

export function apriDialogoLiquidazione({ collaboratoreId = null, praticaId = null } = {}) {
  const m = modello();
  const collab = m.collaboratori.filter((c) => c.attivo || c.daLiquidareCent !== 0);
  if (!collab.length) {
    return apriModale({ titolo: 'Registra una liquidazione', icona: 'info', contenuto: h('p', null, 'Non ci sono collaboratori. Aggiungili da Impostazioni.'), azioni: [{ id: 'ok', etichetta: 'Ok', tipo: 'primario' }] });
  }
  const selCollab = campoSelezione({
    etichetta: 'Collaboratore', obbligatorio: true, valore: collaboratoreId ?? (collab.length === 1 ? collab[0].id : ''), vuoto: 'Scegli il collaboratore…',
    opzioni: collab.map((c) => ({ valore: c.id, etichetta: `${c.nome}${c.daLiquidareCent > 0 ? ` (da liquidare ${eur(c.daLiquidareCent)})` : ''}` })),
  });
  const data = campoData({ etichetta: 'Data del pagamento', valore: oggi(), obbligatorio: true });
  const metodo = campoSelezione({ etichetta: 'Metodo', vuoto: 'Non indicato', opzioni: METODI_PAGAMENTO.map((x) => ({ valore: x, etichetta: x })) });
  const note = campoTesto({ etichetta: 'Note', maxlength: 300 });
  const area = h('div', { class: 'liq-righe' });
  const totale = h('strong', { class: 'num' }, eur(0));
  const dist = campoImporto({ etichetta: 'Oppure distribuisci un importo (dalle più vecchie)' });
  let righe = []; // { voce, p, check, importo }

  function disegnaRighe() {
    const cid = +selCollab.get();
    righe = [];
    area.replaceChildren();
    if (!cid) { area.append(h('p', { class: 'sottotesto' }, 'Scegli un collaboratore per vedere le provvigioni da liquidare.')); aggiornaTotale(); return; }
    const voci = m.pratiche
      .filter((p) => !p.annullata)
      .map((p) => ({ p, v: p.voci.find((x) => x.collaboratoreId === cid) }))
      .filter((x) => x.v)
      .sort((a, b) => (a.p.dataRif < b.p.dataRif ? -1 : a.p.dataRif > b.p.dataRif ? 1 : a.p.id - b.p.id));
    const da = voci.filter((x) => x.v.daLiquidareCent > 0);
    const anticipi = voci.filter((x) => x.v.daLiquidareCent <= 0 && x.p.inCorso);
    if (!da.length && !anticipi.length) {
      area.append(h('div', { class: 'nota ok' }, icona('circle-check', { dimensione: 18 }), h('span', null, 'Non c\'è nulla da liquidare a questo collaboratore.')));
      aggiornaTotale();
      return;
    }
    const costruisciRiga = ({ p, v }, anticipo) => {
      const check = h('input', { type: 'checkbox', 'aria-label': `Liquida ${p.codice}`, checked: !anticipo && (praticaId ? p.id === praticaId : true) });
      const campo = campoImporto({ centesimi: anticipo ? null : v.daLiquidareCent, placeholder: '0,00' });
      campo.input.setAttribute('aria-label', `Importo da liquidare per ${p.codice}`);
      check.addEventListener('change', () => { if (check.checked && campo.get() === null) campo.set(Math.max(0, v.daLiquidareCent)); aggiornaTotale(); });
      campo.input.addEventListener('input', () => { if (campo.get() > 0) check.checked = true; aggiornaTotale(); });
      righe.push({ v, p, check, campo });
      return h('tr', null,
        h('td', { class: 'centro' }, check),
        h('td', null, h('span', { class: 'forte' }, p.codice), h('span', { class: 'sottotesto' }, `${p.immobile_indirizzo} · ${dataIt(p.dataRif)}`)),
        h('td', { class: 'num' }, eur(v.maturataCent)),
        h('td', { class: 'num' }, eur(v.liquidataCent)),
        h('td', { class: 'num forte' }, anticipo ? h('span', { class: 'badge badge-corso' }, 'In corso') : eur(v.daLiquidareCent)),
        h('td', { style: { minWidth: '140px' } }, campo.el),
      );
    };
    const tab = h('div', { class: 'tabella-wrap', style: { maxHeight: '300px', overflow: 'auto' } },
      h('table', { class: 'tabella tabella-compatta' },
        h('thead', null, h('tr', null, h('th', { class: 'centro' }, ''), h('th', null, 'Pratica'), h('th', { class: 'num' }, 'Maturata'), h('th', { class: 'num' }, 'Già liquidata'), h('th', { class: 'num' }, 'Da liquidare'), h('th', null, 'Importo ora'))),
        h('tbody', null, da.map((x) => costruisciRiga(x, false)), anticipi.length ? h('tr', null, h('td', { colspan: 6, class: 'sottotesto', style: { background: 'var(--surface-2)' } }, 'Anticipi su pratiche ancora in corso (nessuna provvigione maturata)')) : null, anticipi.map((x) => costruisciRiga(x, true)))));
    area.append(tab);
    aggiornaTotale();
  }

  function aggiornaTotale() {
    const t = righe.filter((r) => r.check.checked).reduce((s, r) => s + (r.campo.get() || 0), 0);
    totale.textContent = eur(t);
  }

  function distribuisci() {
    let restante = dist.get();
    if (!restante || restante <= 0) { dist.errore('Scrivi l\'importo da distribuire.'); return; }
    dist.errore(null);
    for (const r of righe) { r.check.checked = false; r.campo.set(null); }
    for (const r of righe) {
      if (restante <= 0) break;
      if (r.v.daLiquidareCent <= 0) continue;
      const q = Math.min(restante, r.v.daLiquidareCent);
      r.check.checked = true; r.campo.set(q); restante -= q;
    }
    aggiornaTotale();
    if (restante > 0) notifica({ tipo: 'avviso', testo: `${eur(restante)} non sono stati assegnati: superano il totale da liquidare.` });
  }

  selCollab.input.addEventListener('change', disegnaRighe);
  const selTutte = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { for (const r of righe) { if (r.v.daLiquidareCent > 0) { r.check.checked = true; if (r.campo.get() === null) r.campo.set(r.v.daLiquidareCent); } } aggiornaTotale(); } }, 'Seleziona tutte');
  const selNessuna = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { for (const r of righe) r.check.checked = false; aggiornaTotale(); } }, 'Nessuna');

  const form = h('form', { onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'griglia-campi' },
      h('div', { class: 'c-6' }, selCollab.el), h('div', { class: 'c-6' }, data.el),
      h('div', { class: 'c-12' }, h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between', marginBottom: '8px' } }, h('span', { class: 'etichetta forte' }, 'Pratiche da liquidare'), h('span', { class: 'riga-azioni' }, selTutte, selNessuna)), area),
      h('div', { class: 'c-6' }, h('div', null, dist.el, h('div', { style: { marginTop: '6px' } }, h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: distribuisci }, 'Distribuisci')))),
      h('div', { class: 'c-6' }, metodo.el), h('div', { class: 'c-12' }, note.el),
      h('div', { class: 'c-12' }, h('div', { class: 'riepilogo-calcolo' }, h('div', { class: 'riga totale' }, h('span', null, 'Totale della liquidazione'), totale)))));
  disegnaRighe();

  return apriModale({
    titolo: 'Registra una liquidazione', descrizione: 'Il pagamento delle provvigioni a un collaboratore, pratica per pratica.', icona: 'hand-coins', tonoIcona: 'info', larghezza: 820,
    contenuto: form,
    azioni: [
      { id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' },
      { id: 'salva', etichetta: 'Registra liquidazione', tipo: 'primario', icona: 'check', onClick: async () => {
        const scelte = righe.filter((r) => r.check.checked && (r.campo.get() || 0) > 0).map((r) => ({ praticaId: r.p.id, importoCent: r.campo.get() }));
        if (!selCollab.get()) { selCollab.errore('Scegli il collaboratore.'); return false; }
        if (!scelte.length) { notificaErrore('Seleziona almeno una pratica e indica l\'importo da liquidare.'); return false; }
        const sopra = righe.filter((r) => r.check.checked && (r.campo.get() || 0) > Math.max(0, r.v.daLiquidareCent) && r.p.conclusa);
        if (sopra.length) {
          const ok = await conferma({
            titolo: 'Importo superiore al dovuto', tipo: 'primario', etichettaConferma: 'Registra comunque', icona: 'triangle-alert',
            messaggio: 'Per alcune pratiche stai liquidando più della provvigione ancora da pagare.',
            dettagli: sopra.map((r) => `${r.p.codice}: da liquidare ${eur(r.v.daLiquidareCent)}, inserito ${eur(r.campo.get())}`),
          });
          if (!ok) return false;
        }
        try {
          await registraLiquidazione(app.archivio, { collaboratoreId: +selCollab.get(), data: data.get(), metodo: metodo.get(), note: note.get(), righe: scelte });
          const nome = m.collaboratori.find((c) => c.id === +selCollab.get())?.nome;
          notificaOk(`Liquidazione di ${eur(scelte.reduce((s, x) => s + x.importoCent, 0))} registrata${nome ? ` per ${nome}` : ''}.`);
        } catch (e) {
          if (e.campi) { mostraErrori({ collaboratoreId: selCollab, data }, e.campi); if (e.campi.righe) notificaErrore(e.campi.righe); return false; }
          throw e;
        }
      } },
    ],
  });
}

// ------------------------------------------------------------------ esportazione

export function apriDialogoEsporta() {
  const m = modello();
  const ctx = contesto();
  const opzioni = [
    { id: 'pratiche', titolo: 'Elenco delle pratiche', testo: 'Una riga per pratica con importi, ripartizione e provvigioni (file CSV per Excel).', ext: 'csv' },
    { id: 'provvigioni', titolo: 'Provvigioni per pratica e collaboratore', testo: 'Fatturato, percentuale applicata, maturato, liquidato e residuo (CSV).', ext: 'csv' },
    { id: 'incassi', titolo: 'Incassi', testo: 'Tutti i pagamenti ricevuti dai clienti (CSV).', ext: 'csv' },
    { id: 'liquidazioni', titolo: 'Liquidazioni', testo: 'Tutti i pagamenti ai collaboratori (CSV).', ext: 'csv' },
    { id: 'completo', titolo: 'Archivio completo (file di backup)', testo: 'Tutti i dati in un solo file, per spostarli su un altro computer o conservarli.', ext: 'sqlite' },
  ];
  let scelta = 'pratiche';
  const soloFiltri = h('input', { type: 'checkbox', id: 'esp-filtri', checked: false });
  const lista = h('div', { class: 'azioni-griglia', style: { gridTemplateColumns: '1fr' }, role: 'radiogroup', 'aria-label': 'Cosa esportare' },
    opzioni.map((o) => {
      const r = h('input', { type: 'radio', name: 'esp', value: o.id, checked: o.id === scelta, onchange: () => { scelta = o.id; filtriBox.hidden = !(o.id === 'pratiche' || o.id === 'provvigioni'); } });
      return h('label', { class: 'opzione-radio' }, r, h('div', null, h('b', null, o.titolo), h('span', null, o.testo)));
    }));
  const filtriBox = h('label', { class: 'check', style: { marginTop: '12px' } }, soloFiltri, `Solo i dati del periodo e dei filtri attuali (${ctx.periodo.etichetta})`);
  return apriModale({
    titolo: 'Esporta i dati', descrizione: 'Scegli cosa salvare in un file.', icona: 'download', tonoIcona: 'info', larghezza: 600,
    contenuto: h('div', null, lista, filtriBox),
    azioni: [
      { id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' },
      { id: 'esporta', etichetta: 'Esporta', tipo: 'primario', icona: 'download', onClick: async () => {
        const modelloOra = modello();
        const filtra = soloFiltri.checked;
        const pratichePer = filtra ? concluseNelContesto(modelloOra, ctx) : modelloOra.pratiche;
        let bytes; let nome; let mime = 'text/csv;charset=utf-8';
        if (scelta === 'pratiche') { bytes = codificaTesto(csvPratiche(modelloOra, pratichePer)); nome = nomeFile('Pratiche', 'csv'); }
        else if (scelta === 'provvigioni') {
          const voci = pratichePer.filter((p) => !p.annullata).flatMap((p) => p.voci.filter((v) => ctx.collaboratoreId == null || !filtra || v.collaboratoreId === ctx.collaboratoreId).map((v) => ({ p, v })));
          bytes = codificaTesto(csvProvvigioni(modelloOra, voci)); nome = nomeFile('Provvigioni', 'csv');
        } else if (scelta === 'incassi') { bytes = codificaTesto(csvIncassi(modelloOra)); nome = nomeFile('Incassi', 'csv'); }
        else if (scelta === 'liquidazioni') { bytes = codificaTesto(csvLiquidazioni(modelloOra)); nome = nomeFile('Liquidazioni', 'csv'); }
        else {
          const r = await esportaArchivio(app);
          if (r.annullato) return false;
          notificaOk(`Archivio completo esportato (${dimensioneFile(r.dimensione)}).`);
          return undefined;
        }
        const r = await app.driver.esportaFile(bytes, nome, mime);
        if (r && r.annullato) return false;
        notificaOk(`File “${nome}” salvato${r?.percorso && r.percorso !== nome ? ` in ${r.percorso}` : ''}.`);
        return undefined;
      } },
    ],
  });
}

// ------------------------------------------------------------------ backup e importazione

export async function eseguiBackupRapido() {
  try {
    const meta = await creaBackup(app, 'manuale');
    notificaOk(`Backup creato (${dimensioneFile(meta.dimensione)}).`, { azione: { etichetta: 'Vedi l\'archivio storico', onClick: () => naviga('#/backup') } });
    return meta;
  } catch (e) {
    segnalaErrore(e, 'Creazione del backup');
    return null;
  }
}

export async function eseguiImportazione() {
  let letto;
  try {
    letto = await leggiFileDaImportare(app);
  } catch (e) {
    segnalaErrore(e, 'Lettura del file');
    return false;
  }
  if (!letto) return false;
  if (!letto.esito.valido) {
    await apriModale({
      titolo: 'Il file non può essere importato', icona: 'circle-x', tonoIcona: 'pericolo',
      contenuto: h('div', null, h('p', null, h('strong', null, letto.nome)), h('p', { style: { marginTop: '8px' } }, letto.esito.motivo), h('p', { class: 'sottotesto', style: { marginTop: '8px' } }, 'I tuoi dati attuali non sono stati modificati.')),
      azioni: [{ id: 'ok', etichetta: 'Ho capito', tipo: 'primario' }],
    }).risultato;
    return false;
  }
  const r = letto.esito.riepilogo;
  const sì = await conferma({
    titolo: 'Sostituire tutti i dati con questo backup?',
    messaggio: `Stai per importare “${letto.nome}”. I dati attuali verranno sostituiti da quelli del file.`,
    dettagli: [
      `Il file contiene ${r.pratiche} pratiche, ${r.collaboratori} collaboratori, ${r.zone} zone, ${r.incassi} incassi e ${r.liquidazioni} liquidazioni.`,
      r.primaData ? `Pratiche dal ${dataIt(r.primaData)} al ${dataIt(r.ultimaData)}.` : 'Non contiene pratiche.',
      'Prima dell\'importazione viene salvata automaticamente una copia dei dati attuali: potrai tornare indietro dall\'archivio storico.',
    ],
    etichettaConferma: 'Sostituisci i dati', etichettaAnnulla: 'Annulla', tipo: 'pericolo',
  });
  if (!sì) return false;
  try {
    await applicaImportazione(app, letto.bytes);
    notificaOk(`Importazione completata: ${r.pratiche} pratiche caricate.`, { azione: { etichetta: 'Vai alla dashboard', onClick: () => naviga('#/') } });
    return true;
  } catch (e) {
    segnalaErrore(e, 'Importazione');
    return false;
  }
}
export { numDec, leggiEuro, dataOra };
