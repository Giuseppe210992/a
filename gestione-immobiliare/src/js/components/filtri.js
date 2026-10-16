// Barra dei filtri (periodo, zona, collaboratore, vista mensile/annuale) e selettore del periodo.
// La barra sta fuori dalla schermata che si ridisegna: cosi' resta aperto il menu del periodo mentre i dati si aggiornano.
import { h } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto, impostaFiltri, azzeraFiltri, filtriAttivi } from '../core/app.js';
import { oggi, aggiungiMesi, inizioMese, fineMese, chiaveMese, aggiungiGiorni, parseISO } from '../core/dates.js';
import { nomiMesi, maiuscola, dataIt } from '../core/format.js';
import { apriPopover } from '../core/ui.js';
import { campoData } from './campi.js';

function anniDisponibili() {
  const corrente = +oggi().slice(0, 4);
  const m = modello();
  const primo = m.limiti.da ? +m.limiti.da.slice(0, 4) : corrente;
  const da = Math.min(primo, corrente - 3);
  const out = [];
  for (let a = corrente + 1; a >= da; a--) out.push(a);
  return out;
}

const select = (opzioni, valore, onChange, etichetta) => {
  const s = h('select', { class: 'select', 'aria-label': etichetta, onchange: (e) => onChange(e.target.value) },
    opzioni.map((o) => h('option', { value: String(o.valore) }, o.etichetta)));
  s.value = String(valore);
  return s;
};

/** Pannello per scegliere il periodo; si ridisegna da solo a ogni scelta. */
export function apriSelettorePeriodo(ancora) {
  const radice = h('div', { class: 'sel-periodo' });
  let pop = null;

  function disegna() {
    const p = app.filtri.periodo;
    const anni = anniDisponibili();
    const t = oggi();
    const set = (periodo) => { impostaFiltri({ periodo }); disegna(); pop?.riposiziona(); };
    const tipi = [['mese', 'Mese'], ['anno', 'Anno'], ['intervallo', 'Intervallo'], ['tutto', 'Tutto']];

    let pannello;
    if (p.tipo === 'mese') {
      pannello = h('div', { class: 'sel-riga' },
        select(nomiMesi.map((n, i) => ({ valore: i + 1, etichetta: maiuscola(n) })), p.mese, (v) => set({ tipo: 'mese', mese: +v }), 'Mese'),
        select(anni.map((a) => ({ valore: a, etichetta: String(a) })), p.anno, (v) => set({ tipo: 'mese', anno: +v }), 'Anno'),
      );
    } else if (p.tipo === 'anno') {
      pannello = h('div', { class: 'sel-riga' },
        select(anni.map((a) => ({ valore: a, etichetta: String(a) })), p.anno, (v) => set({ tipo: 'anno', anno: +v }), 'Anno'),
      );
    } else if (p.tipo === 'intervallo') {
      const da = campoData({ etichetta: 'Dal', valore: p.da || inizioMese(chiaveMese(t)) });
      const a = campoData({ etichetta: 'Al', valore: p.a || t });
      // Il periodo cambia solo con due date valide e nell'ordine giusto; altrimenti si spiega cosa non va.
      const applica = (conMessaggi) => {
        const d = da.get();
        const f = a.get();
        if (conMessaggi) {
          da.errore(da.input.value.trim() && !d ? 'Data non valida: scrivila come gg/mm/aaaa.' : null);
          a.errore(a.input.value.trim() && !f ? 'Data non valida: scrivila come gg/mm/aaaa.' : null);
        }
        if (!d || !f) { pop?.riposiziona(); return; }
        if (d > f) { a.errore('La data finale è precedente a quella iniziale.'); pop?.riposiziona(); return; }
        a.errore(null);
        impostaFiltri({ periodo: { tipo: 'intervallo', da: d, a: f } });
      };
      da.input.addEventListener('input', () => applica(false));
      a.input.addEventListener('input', () => applica(false));
      da.input.addEventListener('blur', () => applica(true));
      a.input.addEventListener('blur', () => applica(true));
      da.input.addEventListener('change', () => applica(true));
      a.input.addEventListener('change', () => applica(true));
      if (!p.da || !p.a) setTimeout(() => applica(false), 0);
      pannello = h('div', { class: 'sel-riga' }, da.el, a.el);
    } else {
      const lim = modello().limiti;
      pannello = h('p', { class: 'sottotesto' }, lim.da ? `Tutti i dati, dal ${dataIt(lim.da)} a oggi.` : 'Tutti i dati registrati.');
    }

    const scorciatoie = [
      ['Mese corrente', () => set({ tipo: 'mese', anno: +t.slice(0, 4), mese: +t.slice(5, 7) })],
      ['Mese scorso', () => { const k = aggiungiMesi(chiaveMese(t), -1); set({ tipo: 'mese', anno: +k.slice(0, 4), mese: +k.slice(5, 7) }); }],
      ['Anno corrente', () => set({ tipo: 'anno', anno: +t.slice(0, 4) })],
      ['Anno scorso', () => set({ tipo: 'anno', anno: +t.slice(0, 4) - 1 })],
      ['Ultimi 12 mesi', () => set({ tipo: 'intervallo', da: inizioMese(aggiungiMesi(chiaveMese(t), -11)), a: fineMese(chiaveMese(t)) < t ? fineMese(chiaveMese(t)) : t })],
    ];

    radice.replaceChildren(
      h('div', { class: 'segmenti', role: 'tablist', 'aria-label': 'Tipo di periodo' },
        tipi.map(([v, e]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.tipo === v), onclick: () => set({ tipo: v }) }, e))),
      h('div', { style: { margin: '14px 0 4px' } }, pannello),
      h('hr'),
      h('div', { class: 'sottotesto', style: { marginBottom: '6px' } }, 'Scorciatoie'),
      h('div', { class: 'sel-scorciatoie' }, scorciatoie.map(([e, fn]) => h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: fn }, e))),
    );
  }
  disegna();
  pop = apriPopover(ancora, radice, { larghezzaMin: 320 });
  // il primo controllo riceve il focus
  radice.querySelector('select, input, button')?.focus();
  return pop;
}

/** Barra dei filtri: restituisce { el, aggiorna(), imposta(opzioni) }. */
export function creaBarraFiltri() {
  const btnPeriodo = h('button', { type: 'button', class: 'btn btn-secondario btn-sm periodo-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => apriSelettorePeriodo(btnPeriodo) });
  const testoPeriodo = h('span', { class: 'periodo-testo' });
  btnPeriodo.append(icona('calendar', { dimensione: 16 }), testoPeriodo, icona('chevron-down', { dimensione: 15 }));

  const selZona = h('select', { class: 'select', id: 'filtro-zona', onchange: (e) => impostaFiltri({ zonaId: e.target.value === '' ? null : +e.target.value }) });
  const selCollab = h('select', { class: 'select', id: 'filtro-collab', onchange: (e) => impostaFiltri({ collaboratoreId: e.target.value === '' ? null : +e.target.value }) });
  const btnAzzera = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => azzeraFiltri() }, icona('rotate-ccw', { dimensione: 15 }), 'Azzera filtri');
  const segMensile = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => impostaFiltri({ granularita: 'mensile' }) }, 'Mensile');
  const segAnnuale = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => impostaFiltri({ granularita: 'annuale' }) }, 'Annuale');

  const boxPeriodo = h('div', { class: 'filtro' }, h('span', { class: 'filtro-etichetta' }, 'Periodo'), btnPeriodo);
  const boxZona = h('div', { class: 'filtro' }, h('label', { class: 'filtro-etichetta', for: 'filtro-zona' }, 'Zona'), selZona);
  const boxCollab = h('div', { class: 'filtro' }, h('label', { class: 'filtro-etichetta', for: 'filtro-collab' }, 'Collaboratore'), selCollab);
  const boxGran = h('div', { class: 'filtro filtro-gran' }, h('span', { class: 'filtro-etichetta' }, 'Grafici'), h('div', { class: 'segmenti', role: 'group', 'aria-label': 'Vista dei grafici' }, segMensile, segAnnuale));

  const testoToggle = h('span', { class: 'periodo-testo' });
  const btnToggle = h('button', { type: 'button', class: 'btn btn-secondario btn-sm filtri-toggle', 'aria-expanded': 'false', onclick: () => {
    const apri = !el.classList.contains('aperta');
    el.classList.toggle('aperta', apri);
    btnToggle.setAttribute('aria-expanded', String(apri));
  } }, icona('funnel', { dimensione: 16 }), h('span', null, 'Filtri:'), testoToggle, icona('chevron-down', { dimensione: 15 }));
  const el = h('div', { class: 'striscia-filtri no-stampa', role: 'group', 'aria-label': 'Filtri', hidden: true },
    btnToggle, boxPeriodo, boxZona, boxCollab, btnAzzera, h('span', { class: 'filtri-spazio' }), boxGran);

  let firma = '';
  function aggiornaEtichette() {
    testoPeriodo.textContent = contesto().periodo.etichetta;
    const c = contesto();
    const extra = [c.zonaId != null ? 'zona' : null, c.collaboratoreId != null ? 'collaboratore' : null].filter(Boolean);
    testoToggle.textContent = `${c.periodo.etichetta}${extra.length ? ` · ${extra.join(' e ')}` : ''}`;
  }

  function aggiorna() {
    const m = modello();
    const c = contesto();
    aggiornaEtichette();
    const f2 = `${m.zone.map((z) => `${z.id}:${z.nome}:${z.attiva}`).join('|')}#${m.collaboratori.map((x) => `${x.id}:${x.nome}:${x.attivo}`).join('|')}`;
    if (f2 !== firma) {
      firma = f2;
      selZona.replaceChildren(h('option', { value: '' }, 'Tutte le zone'),
        ...m.zone.map((z) => h('option', { value: String(z.id) }, z.attiva ? z.nome : `${z.nome} (non attiva)`)));
      selCollab.replaceChildren(h('option', { value: '' }, 'Tutti i collaboratori'),
        ...m.collaboratori.map((x) => h('option', { value: String(x.id) }, x.attivo ? x.nome : `${x.nome} (non attivo)`)));
    }
    selZona.value = c.zonaId == null ? '' : String(c.zonaId);
    selCollab.value = c.collaboratoreId == null ? '' : String(c.collaboratoreId);
    const g = app.filtri.granularita;
    segMensile.setAttribute('aria-pressed', String(g === 'mensile'));
    segAnnuale.setAttribute('aria-pressed', String(g === 'annuale'));
    btnAzzera.hidden = !filtriAttivi();
  }

  /** opzioni: false (nascondi tutta la barra) oppure { zona, collaboratore, granularita } */
  function imposta(opzioni) {
    if (!opzioni) { el.hidden = true; return; }
    el.hidden = false;
    boxZona.hidden = opzioni.zona === false;
    boxCollab.hidden = opzioni.collaboratore === false;
    boxGran.hidden = !opzioni.granularita;
    boxPeriodo.hidden = opzioni.periodo === false;
  }

  return { el, aggiorna, imposta, btnPeriodo };
}
