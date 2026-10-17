// Impostazioni: collaboratori, zone, scaglioni e percentuali, metodo di calcolo, ripartizione predefinita, aliquote IVA, preferenze.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, ui, modello, impostazioni } from '../core/app.js';
import { leggiPref } from '../core/preferenze.js';
import { eur, pct, leggiEuro, numDec, dataOra, leggiPercentuale } from '../core/format.js';
import { apriModale, conferma, ok as notificaOk, errore as notificaErrore, segnalaErrore } from '../core/ui.js';
import { campoTesto, campoImporto, campoPercentuale, campoSelezione, casella, mostraErrori } from '../components/campi.js';
import { apriDialogoRipartizione, ripartizioneAParole } from '../components/ripartizione-zona.js';
import {
  elencoCollaboratori, creaCollaboratore, aggiornaCollaboratore, eliminaCollaboratore, usiCollaboratore,
  elencoZone, creaZona, aggiornaZona, eliminaZona, usiZona, leggiTabellaScaglioni, salvaTabellaScaglioni,
} from '../data/repo/anagrafiche.js';
import { scriviImpostazioni } from '../data/repo/impostazioni.js';
import { creaTabella, controllaTabella, descriviScaglioni, provvigioneSuCumulo } from '../data/calc/scaglioni.js';
import { VERSIONE_SCHEMA } from '../data/schema.js';
import { SCAGLIONI_INIZIALI } from '../data/inizializza.js';

const NOMI_COLORE = ['', 'Blu', 'Arancio', 'Turchese', 'Giallo', 'Rosa', 'Verde', 'Viola', 'Rosso'];
const SEZIONI = [
  ['collaboratori', 'Collaboratori', 'users'], ['zone', 'Zone', 'map-pin'], ['scaglioni', 'Scaglioni e percentuali', 'percent'],
  ['calcolo', 'Metodo di calcolo', 'sliders-horizontal'], ['ripartizione', 'Ripartizione predefinita', 'handshake'], ['iva', 'Aliquote IVA', 'receipt'],
  ['preferenze', 'Preferenze', 'settings'], ['info', 'Informazioni', 'info'],
];

// Ridisegna la sezione aperta (e rimette il cursore nel campo indicato). Serve dopo un'aggiunta fatta con il tasto Invio:
// il cursore è ancora nel campo, quindi il ridisegno automatico (che non toglie il cursore da chi sta scrivendo) non scatterebbe.
let ridisegnaSezione = () => {};

const scheda = (titolo, descrizione, ...contenuto) => h('section', { class: 'card sezione-modulo' }, h('h2', null, titolo), descrizione ? h('p', { class: 'descrizione' }, descrizione) : null, ...contenuto);

// Le soglie dette a parole, come le direbbe l'agenzia: «5% fino a 2.600,00 €, …, 20% oltre 13.000,00 €».
const aParole = (righe) => descriviScaglioni(creaTabella(righe)).map((f) => (f.a === null ? `${pct(f.percentuale)} oltre ${eur(f.da - 1)}` : `${pct(f.percentuale)} fino a ${eur(f.a)}`)).join(', ');

// ------------------------------------------------------------------ collaboratori e zone (stessa struttura)

/** Come si divide una pratica di una zona, a parole (per l'elenco delle zone). */
function testoRipartizioneZona(zonaId) {
  const m = modello();
  const propria = m.zone.find((z) => z.id === zonaId)?.ripartizione ?? [];
  if (propria.length) return ripartizioneAParole(propria, m.collaboratori);
  const predefinita = impostazioni()['ripartizione.predefinita'] || [];
  return predefinita.length ? `predefinita (${ripartizioneAParole(predefinita, m.collaboratori)})` : 'NON IMPOSTATA';
}

function elencoAnagrafica({ tipo, etichettaSing, etichettaPlur, genere }) {
  const e = tipo === 'collaboratore';
  const nuovoNome = campoTesto({ id: `nuovo-${tipo}`, etichetta: `Nome ${genere === 'f' ? 'della' : 'del'} ${etichettaSing.toLowerCase()}`, maxlength: 60, placeholder: e ? 'Es. Marco' : 'Es. Centro storico' });
  const form = h('form', { class: 'riga-azioni', style: { alignItems: 'flex-end', marginBottom: '8px' }, onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      if (e) await creaCollaboratore(app.archivio, { nome: nuovoNome.get() }); else await creaZona(app.archivio, { nome: nuovoNome.get() });
      notificaOk(`${etichettaSing} “${nuovoNome.get()}” aggiunt${genere === 'f' ? 'a' : 'o'}.`);
      nuovoNome.set('');
      ridisegnaSezione(`#nuovo-${tipo}`);
    } catch (err) { if (err.campi) nuovoNome.errore(err.campi.nome); else segnalaErrore(err); }
  } }, h('div', { style: { flex: '1 1 260px' } }, nuovoNome.el), h('button', { type: 'submit', class: 'btn btn-primario', id: `aggiungi-${tipo}` }, icona('plus', { dimensione: 16 }), `Aggiungi ${etichettaSing.toLowerCase()}`));

  const m = modello();
  const righe = (e ? elencoCollaboratori(app.archivio) : elencoZone(app.archivio));
  const lista = righe.length ? righe.map((r) => {
    const usi = e ? usiCollaboratore(app.archivio, r.id) : usiZona(app.archivio, r.id);
    const attivo = e ? r.attivo : r.attiva;
    return h('div', { class: 'riga-elenco', dataset: { id: r.id, nome: r.nome } },
      h('div', { class: 'nome' }, h('span', { class: `punto-col col-${r.colore}`, style: { width: '14px', height: '14px' }, title: `Colore nei grafici: ${NOMI_COLORE[r.colore]}` }), h('div', null, r.nome,
        h('br'), h('small', null, e ? `${usi.pratiche} pratiche · ${usi.liquidazioni} liquidazioni${usi.zone ? ` · nella ripartizione di ${usi.zone === 1 ? '1 zona' : `${usi.zone} zone`}` : ''}` : `${usi.pratiche} pratiche${r.usa_scaglioni_propri ? ' · scaglioni propri' : ' · scaglioni predefiniti'} · ripartizione: ${testoRipartizioneZona(r.id)}`))),
      attivo ? h('span', { class: 'badge badge-ok' }, 'Attivo') : h('span', { class: 'badge' }, 'Non attivo'),
      h('div', { class: 'riga-azioni' },
        e ? null : h('button', { type: 'button', class: 'btn btn-secondario btn-sm', id: `ripartizione-zona-${r.id}`, onclick: () => apriDialogoRipartizione(r) }, icona('handshake', { dimensione: 15 }), 'Ripartizione'),
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => modificaAnagrafica(tipo, r, etichettaSing) }, icona('pencil', { dimensione: 15 }), 'Modifica'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { if (e) await aggiornaCollaboratore(app.archivio, r.id, { attivo: !r.attivo }); else await aggiornaZona(app.archivio, r.id, { attiva: !r.attiva }); notificaOk(`${r.nome}: ${attivo ? 'disattivat' : 'attivat'}${genere === 'f' ? 'a' : 'o'}.`); } catch (err) { segnalaErrore(err); }
        } }, attivo ? 'Disattiva' : 'Attiva'),
        h('button', { type: 'button', class: 'btn btn-pericolo-ghost btn-sm', onclick: () => eliminaAnagrafica(tipo, r, usi, etichettaSing, genere) }, icona('trash-2', { dimensione: 15 }), 'Elimina')));
  }) : [h('p', { class: 'sottotesto', style: { padding: '12px 0' } }, `Nessun${genere === 'f' ? 'a' : ''} ${etichettaSing.toLowerCase()} inserit${genere === 'f' ? 'a' : 'o'}.`)];
  void m;
  return scheda(etichettaPlur, e ? 'Le persone a cui si attribuiscono compensi e provvigioni. Disattiva chi non lavora più con te: resta nello storico ma non viene più proposto.' : 'Le zone di lavoro: servono per il cumulo mensile, per gli scaglioni e per le statistiche. Ogni pratica appartiene a una zona, e la zona decide come si divide la pratica tra i collaboratori (pulsante «Ripartizione»).', form, h('div', null, ...lista));
}

function modificaAnagrafica(tipo, r, etichettaSing) {
  const e = tipo === 'collaboratore';
  const nome = campoTesto({ etichetta: 'Nome', valore: r.nome, maxlength: 60, obbligatorio: true });
  const colore = campoSelezione({ etichetta: 'Colore nei grafici', valore: String(r.colore), opzioni: NOMI_COLORE.slice(1).map((n, i) => ({ valore: i + 1, etichetta: n })), aiuto: 'Ogni persona/zona mantiene lo stesso colore in tutti i grafici.' });
  const attivo = casella({ etichetta: e ? 'Collaboratore attivo' : 'Zona attiva', selezionata: !!(e ? r.attivo : r.attiva) });
  const propri = e ? null : casella({ etichetta: 'Usa scaglioni propri (diversi da quelli predefiniti)', selezionata: !!r.usa_scaglioni_propri });
  return apriModale({
    titolo: `Modifica ${etichettaSing.toLowerCase()}`, icona: 'pencil', larghezza: 480, invioConferma: true,
    contenuto: h('form', { onsubmit: (ev) => ev.preventDefault() }, h('div', { style: { display: 'grid', gap: '14px' } }, nome.el, colore.el, attivo.el, propri ? propri.el : null)),
    azioni: [{ id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' }, { id: 'salva', etichetta: 'Salva', tipo: 'primario', onClick: async () => {
      try {
        if (e) await aggiornaCollaboratore(app.archivio, r.id, { nome: nome.get(), colore: +colore.get(), attivo: attivo.get() });
        else await aggiornaZona(app.archivio, r.id, { nome: nome.get(), colore: +colore.get(), attiva: attivo.get(), usaScaglioniPropri: propri.get() });
        notificaOk('Modifiche salvate.');
      } catch (err) { if (err.campi) { mostraErrori({ nome }, err.campi); return false; } throw err; }
    } }],
  });
}

async function eliminaAnagrafica(tipo, r, usi, etichettaSing, genere) {
  const e = tipo === 'collaboratore';
  const inUso = e ? (usi.pratiche || usi.liquidazioni || usi.zone) : usi.pratiche;
  if (inUso) {
    await apriModale({
      titolo: `${etichettaSing} in uso: non si può eliminare`, icona: 'triangle-alert', tonoIcona: 'attenzione',
      contenuto: h('div', null, h('p', null, e ? `${r.nome} compare in ${usi.pratiche} pratiche e ha ${usi.liquidazioni} liquidazioni registrate${usi.zone ? ` e fa parte della ripartizione di ${usi.zone} ${usi.zone === 1 ? 'zona' : 'zone'}` : ''}.` : `La zona “${r.nome}” è usata da ${usi.pratiche} pratiche.`), h('p', { style: { marginTop: '8px' } }, `Eliminarl${genere === 'f' ? 'a' : 'o'} farebbe perdere lo storico. Puoi disattivarl${genere === 'f' ? 'a' : 'o'}: non verrà più proposto${genere === 'f' ? 'a' : ''} ma i dati restano.`)),
      azioni: [{ id: 'chiudi', etichetta: 'Chiudi', tipo: 'secondario' }, ...((e ? r.attivo : r.attiva) ? [{ id: 'dis', etichetta: 'Disattiva', tipo: 'primario', onClick: async () => { if (e) await aggiornaCollaboratore(app.archivio, r.id, { attivo: false }); else await aggiornaZona(app.archivio, r.id, { attiva: false }); notificaOk(`${r.nome} disattivat${genere === 'f' ? 'a' : 'o'}.`); } }] : [])],
    }).risultato;
    return;
  }
  const sì = await conferma({ titolo: `Eliminare “${r.nome}”?`, messaggio: `Stai per eliminare definitivamente ${genere === 'f' ? 'la' : 'il'} ${etichettaSing.toLowerCase()} “${r.nome}”.`, dettagli: [`Non è usat${genere === 'f' ? 'a' : 'o'} da nessuna pratica.`], etichettaConferma: 'Elimina', tipo: 'pericolo' });
  if (!sì) return;
  try { if (e) await eliminaCollaboratore(app.archivio, r.id); else await eliminaZona(app.archivio, r.id); notificaOk(`${etichettaSing} eliminat${genere === 'f' ? 'a' : 'o'}.`); } catch (err) { segnalaErrore(err); }
}

// ------------------------------------------------------------------ scaglioni

function sezioneScaglioni(query) {
  const m = modello();
  const zone = elencoZone(app.archivio);
  let target = query.tabella ?? 'pred'; // 'pred' o id zona
  const contenuto = h('div', null);
  const sel = campoSelezione({ etichetta: 'Tabella da modificare', valore: target, opzioni: [{ valore: 'pred', etichetta: 'Predefinita (per tutte le zone)' }, ...zone.map((z) => ({ valore: String(z.id), etichetta: `Zona ${z.nome}${z.usa_scaglioni_propri ? ' — scaglioni propri' : ' — usa i predefiniti'}` }))], onChange: (v) => { target = v; disegna(); } });

  function disegna() {
    const zonaId = target === 'pred' ? null : +target;
    const zona = zonaId == null ? null : zone.find((z) => z.id === zonaId);
    if (zona && !zona.usa_scaglioni_propri) {
      monta(contenuto, h('div', { class: 'nota' }, icona('info', { dimensione: 18 }), h('div', null, `La zona “${zona.nome}” usa gli scaglioni predefiniti.`, h('br'), 'Se per questa zona valgono soglie o percentuali diverse, attiva gli scaglioni propri: parte una copia di quelli predefiniti che potrai modificare.')),
        h('div', { style: { marginTop: '12px' } }, h('button', { type: 'button', class: 'btn btn-primario', onclick: async () => {
          try {
            await salvaTabellaScaglioni(app.archivio, zona.id, leggiTabellaScaglioni(app.archivio, null));
            await aggiornaZona(app.archivio, zona.id, { usaScaglioniPropri: true });
            notificaOk(`Scaglioni propri attivati per la zona “${zona.nome}”.`);
            location.hash = `#/impostazioni?sezione=scaglioni&tabella=${zona.id}`;
          } catch (e) { segnalaErrore(e); }
        } }, 'Usa scaglioni propri')));
      return;
    }
    const iniziali = leggiTabellaScaglioni(app.archivio, zonaId);
    let righe = iniziali.length ? iniziali.map((r) => ({ da: r.da_cent, pct: r.percentuale })) : [];
    const box = h('div', { class: 'tabella-scaglioni' });
    const anteprima = h('ul', { class: 'esempio-calcolo', 'aria-live': 'polite' });
    const errore = h('div', { class: 'campo' }, h('div', { class: 'errore', role: 'alert' }));
    const esempio = h('div', { class: 'esempio-calcolo' });
    const importoEsempio = campoImporto({ etichetta: 'Prova con un cumulo mensile di', centesimi: null, placeholder: '13.000,00' });
    const sporco = { v: false };

    function leggiRighe() {
      return righe.map((r) => ({ da_cent: r.da, percentuale: r.pct }));
    }
    function aggiornaAnteprima() {
      const tab = creaTabella(leggiRighe().filter((r) => Number.isFinite(r.da_cent) && Number.isFinite(r.percentuale)));
      anteprima.replaceChildren(...(tab.length ? descriviScaglioni(tab).map((f) => h('li', null, `${f.indice + 1}° scaglione: ${f.a === null ? `da ${eur(f.da)} in su` : `da ${eur(f.da)} a ${eur(f.a)}`} → ${pct(f.percentuale)}`)) : [h('li', null, 'Aggiungi almeno uno scaglione.')]));
      const cum = importoEsempio.get();
      const metodo = impostazioni()['calcolo.metodo'];
      if (tab.length && cum) {
        const a = provvigioneSuCumulo(tab, cum, 'raggiunto'), b = provvigioneSuCumulo(tab, cum, 'progressivo');
        esempio.replaceChildren(h('div', null, `Con ${eur(cum)} di cumulo mensile:`), h('div', null, `• scaglione raggiunto: ${eur(a)}${metodo === 'raggiunto' ? ' (metodo in uso)' : ''}`), h('div', null, `• progressivo: ${eur(b)}${metodo === 'progressivo' ? ' (metodo in uso)' : ''}`));
      } else esempio.replaceChildren(h('div', { class: 'sottotesto' }, 'Scrivi un importo per vedere la provvigione che ne deriva.'));
    }
    importoEsempio.input.addEventListener('input', aggiornaAnteprima);

    function disegnaRighe() {
      box.replaceChildren(h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella tabella-compatta', id: 'tabella-editor-scaglioni' },
        h('thead', null, h('tr', null, h('th', null, 'Scaglione'), h('th', null, 'Da (fatturato mensile)'), h('th', null, 'Percentuale di provvigione'), h('th', null, h('span', { class: 'solo-lettori' }, 'Elimina')))),
        h('tbody', null, righe.map((r, i) => {
          const da = campoImporto({ centesimi: r.da, placeholder: '0,00' });
          da.input.setAttribute('aria-label', `Soglia dello scaglione ${i + 1}`);
          if (i === 0) { da.input.readOnly = true; da.input.title = 'Il primo scaglione parte sempre da zero'; }
          da.input.addEventListener('input', () => { r.da = da.get(); sporco.v = true; aggiornaAnteprima(); });
          da.input.addEventListener('blur', () => { r.da = da.get(); aggiornaAnteprima(); });
          const p = campoPercentuale({ valore: r.pct });
          p.input.setAttribute('aria-label', `Percentuale dello scaglione ${i + 1}`);
          p.input.addEventListener('input', () => { r.pct = p.get(); sporco.v = true; aggiornaAnteprima(); });
          return h('tr', null, h('td', { class: 'forte' }, `${i + 1}°`), h('td', { style: { minWidth: '170px' } }, da.el), h('td', { style: { minWidth: '150px' } }, p.el),
            h('td', null, i === 0 && righe.length === 1 ? null : h('button', { type: 'button', class: 'btn btn-pericolo-ghost btn-sm btn-icona', 'aria-label': `Elimina lo scaglione ${i + 1}`, onclick: () => { righe.splice(i, 1); if (righe.length && i === 0) righe[0].da = 0; sporco.v = true; disegnaRighe(); } }, icona('trash-2', { dimensione: 15 }))));
        })))));
      aggiornaAnteprima();
    }
    disegnaRighe();

    const aggiungi = h('button', { type: 'button', class: 'btn btn-secondario btn-sm', id: 'aggiungi-scaglione', onclick: () => {
      const ultimo = righe[righe.length - 1];
      righe.push({ da: ultimo ? (ultimo.da ?? 0) + 1000000 : 0, pct: ultimo ? Math.min(100, (ultimo.pct ?? 0) + 5) : SCAGLIONI_INIZIALI[0].percentuale });
      sporco.v = true; disegnaRighe();
    } }, icona('plus', { dimensione: 15 }), 'Aggiungi scaglione');

    const salva = h('button', { type: 'button', class: 'btn btn-primario', id: 'salva-scaglioni', onclick: async () => {
      errore.querySelector('.errore').replaceChildren(); errore.classList.remove('ha-errore');
      if (righe.some((r) => r.da === null || r.da === undefined || r.pct === null || r.pct === undefined)) {
        errore.classList.add('ha-errore'); errore.querySelector('.errore').replaceChildren(icona('circle-alert', { dimensione: 15 }), h('span', null, 'Compila la soglia e la percentuale di ogni scaglione.')); return;
      }
      const problemi = righe.length ? controllaTabella(creaTabella(leggiRighe())) : [];
      if (problemi.length) { errore.classList.add('ha-errore'); errore.querySelector('.errore').replaceChildren(icona('circle-alert', { dimensione: 15 }), h('span', null, problemi[0])); return; }
      try {
        await salvaTabellaScaglioni(app.archivio, zonaId, leggiRighe());
        sporco.v = false;
        notificaOk(`Scaglioni ${zona ? `della zona “${zona.nome}”` : 'predefiniti'} salvati. Le provvigioni sono state ricalcolate.`);
      } catch (e) { segnalaErrore(e); }
    } }, icona('check', { dimensione: 16 }), 'Salva gli scaglioni');

    const extra = [];
    if (!zona) {
      extra.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'ripristina-scaglioni', onclick: async () => {
        const attuale = leggiTabellaScaglioni(app.archivio, null);
        if (JSON.stringify(attuale) === JSON.stringify(SCAGLIONI_INIZIALI) && !sporco.v) { notificaOk('Gli scaglioni sono già quelli dell\'agenzia.'); return; }
        const sì = await conferma({
          titolo: 'Ripristinare gli scaglioni dell\'agenzia?', tipo: 'pericolo', etichettaConferma: 'Ripristina',
          messaggio: `La tabella predefinita tornerà quella preimpostata: ${aParole(SCAGLIONI_INIZIALI)}.`,
          dettagli: ['Le modifiche fatte a questa tabella andranno perse e le provvigioni verranno ricalcolate.', 'Le tabelle proprie delle singole zone non cambiano.'],
        });
        if (!sì) return;
        try {
          await salvaTabellaScaglioni(app.archivio, null, SCAGLIONI_INIZIALI);
          sporco.v = false;
          notificaOk('Scaglioni dell\'agenzia ripristinati. Le provvigioni sono state ricalcolate.');
          disegna();
        } catch (e) { segnalaErrore(e); }
      } }, icona('rotate-ccw', { dimensione: 15 }), 'Ripristina gli scaglioni dell\'agenzia'));
    }
    if (zona) {
      extra.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
        const sì = await conferma({ titolo: 'Tornare agli scaglioni predefiniti?', messaggio: `La zona “${zona.nome}” userà di nuovo la tabella predefinita; gli scaglioni propri verranno eliminati.`, etichettaConferma: 'Usa i predefiniti', tipo: 'pericolo' });
        if (!sì) return;
        try { await salvaTabellaScaglioni(app.archivio, zona.id, []); await aggiornaZona(app.archivio, zona.id, { usaScaglioniPropri: false }); notificaOk('La zona usa di nuovo gli scaglioni predefiniti.'); location.hash = '#/impostazioni?sezione=scaglioni'; } catch (e) { segnalaErrore(e); }
      } }, 'Torna ai predefiniti'));
    }
    monta(contenuto,
      !zona && !iniziali.length ? h('div', { class: 'nota attenzione', id: 'scaglioni-vuoti', style: { marginBottom: '12px' } }, icona('triangle-alert', { dimensione: 18 }), h('span', null, 'Non ci sono scaglioni: le provvigioni risultano a zero. Scrivili a mano oppure ripristina quelli dell\'agenzia.')) : null,
      box, h('div', { class: 'riga-azioni', style: { margin: '12px 0' } }, aggiungi, ...extra), errore,
      h('div', { class: 'griglia-2', style: { marginTop: '8px' } },
        h('div', null, h('div', { class: 'sottotesto forte', style: { marginBottom: '6px' } }, 'Come vengono lette le soglie'), anteprima),
        h('div', null, importoEsempio.el, h('div', { style: { marginTop: '8px' } }, esempio))),
      h('div', { class: 'riga-azioni', style: { marginTop: '16px', justifyContent: 'flex-end' } }, salva));
  }
  disegna();
  void m;
  return scheda('Scaglioni e percentuali', 'Le soglie di fatturato mensile e la percentuale di provvigione che spetta a chi le raggiunge. Una soglia vale da quella cifra (inclusa) fino alla successiva (esclusa). Per questo «5% fino a 2.600 €» si scrive con un secondo scaglione che parte da 2.600,01 €: con 2.600,00 € precisi si è ancora al 5%.',
    zone.length ? sel.el : null, h('div', { style: { marginTop: zone.length ? '16px' : 0 } }, contenuto));
}

// ------------------------------------------------------------------ metodo di calcolo

function sezioneCalcolo() {
  const imp = impostazioni();
  const m = modello();
  const gruppo = (nome, chiave, titolo, descrizione, opzioni) => {
    const corrente = imp[chiave];
    return h('fieldset', { style: { border: 0, padding: 0, margin: '0 0 22px' } },
      h('legend', { class: 'sezione-titolo', style: { padding: 0, marginBottom: '8px' } }, titolo),
      descrizione ? h('p', { class: 'sottotesto', style: { margin: '-2px 0 10px', maxWidth: '75ch' } }, descrizione) : null,
      h('div', { style: { display: 'grid', gap: '10px' } }, opzioni.map(([valore, etichetta, testo]) => h('label', { class: 'opzione-radio' },
        h('input', { type: 'radio', name: nome, value: valore, checked: corrente === valore, onchange: async () => {
          try { await scriviImpostazioni(app.archivio, { [chiave]: valore }); notificaOk('Impostazione salvata: tutte le provvigioni sono state ricalcolate.'); } catch (e) { segnalaErrore(e); }
        } }), h('div', null, h('b', null, etichetta), h('span', null, testo))))));
  };
  const tab = m.tabellaPredefinita;
  let esempio = null;
  if (tab.length > 1) {
    const cum = Math.round((tab[1].da * 1.3) / 100) * 100;
    const r = provvigioneSuCumulo(tab, cum, 'raggiunto'), p = provvigioneSuCumulo(tab, cum, 'progressivo');
    esempio = h('div', { class: 'esempio-calcolo', style: { marginTop: '4px' } }, h('div', { class: 'forte' }, `Esempio con i tuoi scaglioni: cumulo mensile di ${eur(cum)}`),
      h('div', null, `• Scaglione raggiunto → ${eur(r)} (la percentuale dello scaglione si applica a tutto il cumulo)`), h('div', null, `• Progressivo → ${eur(p)} (ogni percentuale solo sulla propria fascia)`));
  }
  return scheda('Metodo di calcolo', 'Come si trasformano il fatturato e gli scaglioni in provvigioni. Cambiando queste scelte tutti i numeri del programma vengono ricalcolati subito, anche per le pratiche passate.',
    gruppo('metodo', 'calcolo.metodo', 'Come si applicano le percentuali degli scaglioni', 'È la scelta che incide di più sugli importi: verifica con il tuo accordo di collaborazione.', [
      ['raggiunto', 'Scaglione raggiunto', 'Raggiunta una soglia, la percentuale di quello scaglione si applica a tutto il fatturato del mese (anche alla parte sotto la soglia).'],
      ['progressivo', 'Progressivo (a fasce)', 'Ogni percentuale si applica soltanto alla parte di fatturato che cade nel suo scaglione, come le aliquote a scaglioni delle imposte.'],
    ]), esempio,
    h('div', { style: { height: '18px' } }),
    gruppo('base', 'calcolo.baseCumulo', 'Su cosa si calcola il cumulo mensile', 'Decide quali compensi si sommano per stabilire lo scaglione raggiunto.', [
      ['collaboratore_zona', 'Per collaboratore e per zona', 'Ogni collaboratore ha un cumulo separato in ciascuna zona.'],
      ['zona', 'Per zona', 'Il fatturato di tutti i collaboratori della zona si somma: lo scaglione è lo stesso per tutti.'],
      ['collaboratore', 'Per collaboratore (tutte le zone)', 'Ogni collaboratore ha un solo cumulo mensile, qualunque sia la zona (si usano gli scaglioni predefiniti).'],
    ]),
    gruppo('maturazione', 'calcolo.maturazione', 'Quando la provvigione risulta maturata', 'Maturata = dovuta al collaboratore. Da liquidare = maturata meno quanto già pagato.', [
      ['conclusione', 'Alla conclusione della pratica', 'La provvigione matura per intero quando la pratica è conclusa (rogito), anche se il cliente non ha ancora pagato.'],
      ['incasso', 'In proporzione agli incassi', 'La provvigione matura man mano che il cliente paga i compensi (IVA compresa).'],
    ]));
}

// ------------------------------------------------------------------ ripartizione predefinita

function sezioneRipartizione() {
  const m = modello();
  const attivi = m.collaboratori.filter((c) => c.attivo);
  let righe = (impostazioni()['ripartizione.predefinita'] || []).map((r) => ({ id: r.collaboratoreId, pct: r.percentuale }));
  const box = h('div', { class: 'quote-righe' });
  const totale = h('div', { class: 'forte sottotesto' });
  function disegna() {
    box.replaceChildren(...righe.map((r, i) => {
      const usati = new Set(righe.filter((_, j) => j !== i).map((x) => x.id));
      const sel = campoSelezione({ etichetta: i === 0 ? 'Collaboratore' : null, valore: r.id ?? '', vuoto: 'Scegli…', opzioni: attivi.filter((c) => !usati.has(c.id)).map((c) => ({ valore: c.id, etichetta: c.nome })), onChange: (v) => { r.id = v === '' ? null : +v; disegna(); box.querySelector(`select[aria-label="Collaboratore ${i + 1}"]`)?.focus(); } }); // le altre righe devono vedere subito chi si è liberato
      sel.input.setAttribute('aria-label', `Collaboratore ${i + 1}`);
      const p = campoPercentuale({ etichetta: i === 0 ? 'Quota' : null, valore: r.pct ?? null, onInput: (v) => { r.pct = v ?? 0; aggTot(); } });
      p.input.setAttribute('aria-label', `Quota ${i + 1}`);
      return h('div', { class: 'quota-riga' }, sel.el, p.el, h('button', { type: 'button', class: 'btn btn-ghost btn-icona', 'aria-label': `Togli il collaboratore ${i + 1}`, onclick: () => { righe.splice(i, 1); disegna(); } }, icona('x', { dimensione: 18 })));
    }));
    aggTot();
  }
  function aggTot() {
    const t = righe.reduce((s, r) => s + (Number(r.pct) || 0), 0);
    totale.textContent = righe.length ? `Totale quote: ${pct(Math.round(t * 100) / 100)}` : 'Nessuna ripartizione predefinita: le zone senza una ripartizione propria restano senza assegnazione.';
    totale.style.color = righe.length && Math.abs(t - 100) > 0.005 ? 'var(--crit-text)' : '';
  }
  disegna();
  return scheda('Ripartizione predefinita', 'Come si dividono le pratiche tra i collaboratori nelle zone che non hanno una ripartizione propria (quella di ogni zona si imposta da Zone → Ripartizione). Si applica da sola a ogni nuova pratica.',
    box, h('div', { style: { marginTop: '12px', display: 'grid', gap: '10px' } }, totale,
      h('div', { class: 'riga-azioni' },
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => { const rest = attivi.filter((c) => !righe.some((r) => r.id === c.id)); if (!rest.length) { notificaErrore('Hai già aggiunto tutti i collaboratori attivi.'); return; } righe.push({ id: rest[0].id, pct: Math.max(0, Math.round((100 - righe.reduce((s, r) => s + (Number(r.pct) || 0), 0)) * 100) / 100) }); disegna(); } }, icona('plus', { dimensione: 15 }), 'Aggiungi collaboratore'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { righe = []; disegna(); } }, 'Nessuna ripartizione predefinita'))),
    h('div', { class: 'riga-azioni', style: { marginTop: '16px', justifyContent: 'flex-end' } }, h('button', { type: 'button', class: 'btn btn-primario', id: 'salva-ripartizione', onclick: async () => {
      if (righe.some((r) => !r.id)) { notificaErrore('C\'è una riga senza collaboratore.'); return; }
      const t = Math.round(righe.reduce((s, r) => s + (Number(r.pct) || 0), 0) * 100) / 100;
      if (righe.length && Math.abs(t - 100) > 0.005) { notificaErrore(`Le quote sommano ${pct(t)}: devono fare 100%.`); return; }
      try { await scriviImpostazioni(app.archivio, { 'ripartizione.predefinita': righe.map((r) => ({ collaboratoreId: r.id, percentuale: Number(r.pct) })) }); notificaOk('Ripartizione predefinita salvata.'); } catch (e) { segnalaErrore(e); }
    } }, icona('check', { dimensione: 16 }), 'Salva')));
}

// ------------------------------------------------------------------ aliquote IVA

function sezioneIva() {
  const imp = impostazioni();
  const aliquote = [...(imp['iva.aliquote'] || [])].sort((a, b) => b - a);
  const nuova = campoPercentuale({ id: 'nuova-iva', etichetta: 'Nuova aliquota', placeholder: 'es. 5' });
  const predef = campoSelezione({ etichetta: 'Aliquota proposta per le nuove pratiche', valore: String(imp['iva.predefinita']), opzioni: aliquote.map((a) => ({ valore: String(a), etichetta: `${String(a).replace('.', ',')}%` })), onChange: async (v) => {
    try { await scriviImpostazioni(app.archivio, { 'iva.predefinita': Number(v) }); notificaOk('Aliquota predefinita salvata.'); } catch (e) { segnalaErrore(e); }
  } });
  return scheda('Aliquote IVA', 'Le aliquote disponibili nel modulo della pratica. L\'IVA si calcola sui compensi; gli scaglioni e le provvigioni usano sempre l\'importo senza IVA.',
    h('div', { class: 'riga-azioni', style: { marginBottom: '16px' } }, ...aliquote.map((a) => h('span', { class: 'chip-col', style: { height: '32px', fontSize: '14px' } }, `${String(a).replace('.', ',')}%`,
      h('button', { type: 'button', class: 'btn btn-ghost btn-icona', style: { width: '22px', height: '22px', marginLeft: '2px' }, 'aria-label': `Rimuovi l'aliquota ${a}%`, disabled: aliquote.length <= 1 ? true : null, onclick: async () => {
        const rimaste = aliquote.filter((x) => x !== a);
        try { await scriviImpostazioni(app.archivio, { 'iva.aliquote': rimaste, 'iva.predefinita': rimaste.includes(imp['iva.predefinita']) ? imp['iva.predefinita'] : rimaste[0] }); notificaOk(`Aliquota ${a}% rimossa dall'elenco (le pratiche già inserite non cambiano).`); } catch (e) { segnalaErrore(e); }
      } }, icona('x', { dimensione: 12 }))))),
    h('div', { class: 'griglia-campi' }, h('div', { class: 'c-4' }, h('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      const v = nuova.get();
      if (v === null || v < 0 || v > 100) { nuova.errore('Scrivi un\'aliquota tra 0 e 100.'); return; }
      if (aliquote.includes(v)) { nuova.errore('Questa aliquota è già nell\'elenco.'); return; }
      try { await scriviImpostazioni(app.archivio, { 'iva.aliquote': [...aliquote, v] }); notificaOk(`Aliquota ${String(v).replace('.', ',')}% aggiunta.`); nuova.set(null); ridisegnaSezione('#nuova-iva'); } catch (e) { segnalaErrore(e); }
    } }, nuova.el, h('button', { type: 'submit', class: 'btn btn-secondario btn-sm', style: { marginTop: '8px' }, id: 'aggiungi-iva' }, icona('plus', { dimensione: 15 }), 'Aggiungi'))), h('div', { class: 'c-6' }, predef.el)));
}

// ------------------------------------------------------------------ preferenze

function sezionePreferenze(ridisegna) {
  const imp = impostazioni();
  const tema = leggiPref('tema', 'auto');
  const nome = campoTesto({ etichetta: 'Nome dell\'agenzia (facoltativo)', valore: imp['agenzia.nome'] ?? '', maxlength: 80, aiuto: 'Compare nelle esportazioni.' });
  const giorniBackup = campoTesto({ etichetta: 'Avvisami se l\'ultimo backup è più vecchio di (giorni)', tipo: 'number', valore: String(imp['avvisi.giorniBackup']) });
  const sogliaScaglione = campoTesto({ etichetta: 'Segnala lo scaglione vicino quando manca meno del (% della soglia)', tipo: 'number', valore: String(imp['avvisi.sogliaScaglionePct']) });
  const maxAuto = campoTesto({ etichetta: 'Copie automatiche da conservare', tipo: 'number', valore: String(imp['backup.massimoAutomatici']) });
  const auto = casella({ etichetta: 'Crea una copia di sicurezza automatica ogni giorno (se ci sono dati)', selezionata: !!imp['backup.automatico'] });
  for (const c of [giorniBackup, sogliaScaglione, maxAuto]) { c.input.min = '1'; c.input.max = '365'; }
  return h('div', { style: { display: 'grid', gap: '16px' } },
    scheda('Aspetto', 'Questa preferenza vale solo per questo computer.',
      h('div', { class: 'segmenti', role: 'group', 'aria-label': 'Tema' }, [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([v, e]) => h('button', { type: 'button', 'aria-pressed': String(tema === v), onclick: () => { ui.applicaTema(v); notificaOk(`Tema: ${e.toLowerCase()}.`); ridisegna(); } }, e)))),
    scheda('Agenzia, avvisi e backup', null,
      h('div', { class: 'griglia-campi' },
        h('div', { class: 'c-12' }, nome.el), h('div', { class: 'c-6' }, giorniBackup.el), h('div', { class: 'c-6' }, sogliaScaglione.el),
        h('div', { class: 'c-12' }, auto.el), h('div', { class: 'c-6' }, maxAuto.el)),
      h('div', { class: 'riga-azioni', style: { marginTop: '16px', justifyContent: 'flex-end' } }, h('button', { type: 'button', class: 'btn btn-primario', id: 'salva-preferenze', onclick: async () => {
        const num = (c, min, max, etichetta) => { const v = Number(c.get()); if (!Number.isInteger(v) || v < min || v > max) { c.errore(`${etichetta}: scrivi un numero intero tra ${min} e ${max}.`); return null; } return v; };
        const a = num(giorniBackup, 1, 365, 'Giorni'), b = num(sogliaScaglione, 1, 100, 'Percentuale'), c = num(maxAuto, 1, 365, 'Copie');
        if (a === null || b === null || c === null) return;
        try { await scriviImpostazioni(app.archivio, { 'agenzia.nome': nome.get(), 'avvisi.giorniBackup': a, 'avvisi.sogliaScaglionePct': b, 'backup.massimoAutomatici': c, 'backup.automatico': auto.get() }); notificaOk('Preferenze salvate.'); } catch (e) { segnalaErrore(e); }
      } }, icona('check', { dimensione: 16 }), 'Salva le preferenze'))));
}

// ------------------------------------------------------------------ informazioni

function sezioneInfo() {
  const corpo = h('div', null, h('p', { class: 'sottotesto' }, 'Caricamento…'));
  app.driver.info().then((info) => {
    monta(corpo, h('dl', { class: 'elenco-dati' },
      h('dt', null, 'Programma'), h('dd', null, `Gestione Immobiliare ${app.versione}`),
      h('dt', null, 'Modalità'), h('dd', null, app.hostProgramma ? (info.portatile ? 'Programma Windows portatile (dati in un file accanto al programma, sulla chiavetta)' : 'Programma Windows (dati in un file sul computer)') : 'Browser (dati nella memoria del browser)'),
      h('dt', null, 'Dove sono i dati'), h('dd', null, info.tipo === 'file' ? (info.percorsoDati ?? 'file sul computer') : 'IndexedDB del browser'),
      info.tipo === 'file' ? h('dt', null, 'Cartella dei backup') : null, info.tipo === 'file' ? h('dd', null, info.percorsoBackup ?? '') : null,
      h('dt', null, 'Versione dell\'archivio'), h('dd', null, `Schema ${VERSIONE_SCHEMA}`),
      h('dt', null, 'Connessione a Internet'), h('dd', null, 'Non necessaria: tutto funziona offline'),
      h('dt', null, 'Ultimo salvataggio'), h('dd', null, app.archivio.ultimoSalvataggio ? dataOra(app.archivio.ultimoSalvataggio) : 'Nessuna modifica in questa sessione')));
  }).catch(() => {});
  return scheda('Informazioni', null, corpo,
    h('h3', { class: 'sezione-titolo', style: { marginTop: '24px' } }, 'Scorciatoie da tastiera'),
    h('dl', { class: 'elenco-dati' }, h('dt', null, h('kbd', null, '/'), ' oppure ', h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'K')), h('dd', null, 'Vai alla ricerca rapida'), h('dt', null, h('kbd', null, 'Esc')), h('dd', null, 'Chiudi finestre, menu e ricerca'), h('dt', null, '← →  nei grafici'), h('dd', null, 'Scorri i valori di un grafico selezionato')));
}

export const impostazioniVista = {
  id: 'impostazioni', titolo: 'Impostazioni',
  monta(contenitore, params, query) {
    let sezione = SEZIONI.some(([k]) => k === query.sezione) ? query.sezione : 'collaboratori';
    const corpo = h('div', { class: 'imp-corpo' });
    const menu = h('nav', { class: 'menu-imp', 'aria-label': 'Sezioni delle impostazioni' });
    let q = { ...query };

    function disegna() {
      menu.replaceChildren(...SEZIONI.map(([k, e, ico]) => h('button', { type: 'button', 'aria-current': String(k === sezione), id: `imp-${k}`, onclick: () => { sezione = k; q = {}; history.replaceState(null, '', `#/impostazioni?sezione=${k}`); disegna(); } }, icona(ico, { dimensione: 18 }), e)));
      const f = {
        collaboratori: () => elencoAnagrafica({ tipo: 'collaboratore', etichettaSing: 'Collaboratore', etichettaPlur: 'Collaboratori', genere: 'm' }),
        zone: () => elencoAnagrafica({ tipo: 'zona', etichettaSing: 'Zona', etichettaPlur: 'Zone', genere: 'f' }),
        scaglioni: () => sezioneScaglioni(q), calcolo: sezioneCalcolo, ripartizione: sezioneRipartizione, iva: sezioneIva, preferenze: () => sezionePreferenze(disegna), info: sezioneInfo,
      }[sezione];
      monta(corpo, f());
    }
    monta(contenitore,
      h('div', { class: 'pagina-testa' }, h('div', null, h('h1', null, 'Impostazioni'), h('p', null, 'Collaboratori, zone, scaglioni, ripartizioni, aliquote e preferenze del programma.'))),
      h('div', { class: 'layout-imp' }, menu, corpo));
    disegna();
    ridisegnaSezione = (selettoreFocus = null) => { disegna(); if (selettoreFocus) corpo.querySelector(selettoreFocus)?.focus(); };
    // Le schermate con campi in modifica non si ridisegnano da sole mentre si scrive.
    return {
      aggiorna() { if (!document.activeElement || !corpo.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') disegna(); },
      distruggi() { ridisegnaSezione = () => {}; },
    };
  },
};
export { numDec, leggiEuro, leggiPercentuale };
