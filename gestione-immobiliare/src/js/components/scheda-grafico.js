// Scheda che contiene un grafico: titolo, cifre chiave, vista tabella equivalente e stato vuoto.
import { h } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { tabellaDaSpec, statoVuotoGrafico } from '../charts/base.js';

/**
 * montaFn: funzione dei grafici (montaColonne, montaBarre, ...) che riceve il contenitore.
 * Restituisce { el, aggiorna({ spec, cifre, nota, vuoto, tabella, extra }) }
 */
export function creaSchedaGrafico({ id, titolo, sottotitolo = null, largo = false, montaFn, conTotali = false }) {
  const host = h('div', { class: 'grafico-host' });
  const tabella = h('div', { class: 'grafico-tab', hidden: true });
  const vuoto = h('div', { hidden: true });
  const cifre = h('div', { class: 'grafico-cifre' });
  const nota = h('div', { class: 'grafico-nota' });
  const extra = h('div', { class: 'grafico-extra' });
  const sotto = h('div', { class: 'grafico-sotto' });
  const sottotitoloEl = h('p', null, sottotitolo);
  let inTabella = false;
  const btnTab = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false', title: 'Mostra i dati in forma di tabella', onclick: () => {
    inTabella = !inTabella;
    applica();
  } }, icona('table-2', { dimensione: 16 }), h('span', { class: 'etichetta-tab' }, 'Tabella'));
  const ctrl = montaFn(host);
  let ultimo = null;

  const el = h('article', { class: `card grafico-card${largo ? ' largo' : ''}`, id: id ? `grafico-${id}` : null, 'aria-label': titolo },
    h('div', { class: 'grafico-testa' }, h('div', null, h('h3', null, titolo), sottotitoloEl), btnTab),
    cifre,
    h('div', { class: 'grafico-corpo' }, extra, host, vuoto, tabella, sotto),
    nota);

  function applica() {
    const haDati = ultimo && !ultimo.vuoto;
    host.hidden = inTabella || !haDati;
    vuoto.hidden = inTabella || haDati;
    tabella.hidden = !inTabella || !haDati;
    btnTab.setAttribute('aria-pressed', String(inTabella));
    btnTab.querySelector('.etichetta-tab').textContent = inTabella ? 'Grafico' : 'Tabella';
    btnTab.disabled = !haDati;
    if (!inTabella && haDati) ctrl.ridisegna();
  }

  function aggiorna(dati) {
    ultimo = dati;
    sottotitoloEl.textContent = dati.sottotitolo ?? sottotitolo ?? '';
    cifre.replaceChildren(...(dati.cifre || []).map((c) => h('div', { class: 'cifra' }, h('span', null, c.etichetta), h('b', null, c.valore))));
    cifre.hidden = !(dati.cifre && dati.cifre.length);
    nota.textContent = dati.nota || '';
    nota.hidden = !dati.nota;
    extra.replaceChildren(...(dati.extra ? [dati.extra] : []));
    extra.hidden = !dati.extra;
    sotto.replaceChildren(...(dati.sotto ? [dati.sotto] : []));
    sotto.hidden = !dati.sotto;
    vuoto.replaceChildren(statoVuotoGrafico(dati.vuoto || 'Nessun dato nel periodo.'));
    if (!dati.vuoto) {
      ctrl.aggiorna(dati.spec);
      tabella.replaceChildren(dati.tabella ? dati.tabella() : tabellaDaSpec(dati.spec, { totale: conTotali }));
    }
    applica();
  }
  return { el, aggiorna, distruggi: () => ctrl.distruggi() };
}
