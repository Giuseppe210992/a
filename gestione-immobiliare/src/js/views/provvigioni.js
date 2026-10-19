// Provvigioni: il foglio del mese, come un foglio Excel ma già fatto. Una riga per pratica, una colonna per ogni persona,
// il totale in fondo. Una volta inserita la pratica le provvigioni sono già considerate pagate: niente liquidazioni.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello } from '../core/app.js';
import { chiaveMese, oggi, aggiungiMesi } from '../core/dates.js';
import { eur, pct, meseAnno, maiuscola, nomiMesi } from '../core/format.js';
import { ok as notificaOk } from '../core/ui.js';
import { naviga } from '../core/router.js';
import { csvProvvigioni, codificaTesto, nomeFile } from '../data/esporta.js';

export const provvigioni = {
  id: 'provvigioni', titolo: 'Provvigioni',
  filtri: { periodo: false, zona: false, collaboratore: false, granularita: false },
  monta(contenitore, params, query) {
    const oggiMese = chiaveMese(oggi());
    let mese = /^\d{4}-\d{2}$/.test(query.mese || '') ? query.mese : oggiMese;
    const corpo = h('div', { id: 'pannello-prov' });
    const selMese = h('select', { class: 'select', 'aria-label': 'Mese', style: { width: '150px', height: '38px' }, onchange: () => imposta(`${selAnno.value}-${selMese.value}`) },
      nomiMesi.map((n, i) => h('option', { value: String(i + 1).padStart(2, '0') }, maiuscola(n))));
    const selAnno = h('select', { class: 'select', 'aria-label': 'Anno', style: { width: '100px', height: '38px' }, onchange: () => imposta(`${selAnno.value}-${selMese.value}`) });
    const btnOggi = h('button', { type: 'button', class: 'btn btn-secondario', onclick: () => imposta(oggiMese) }, 'Mese corrente');
    function imposta(k) { mese = k; history.replaceState(null, '', `#/provvigioni?mese=${k}`); disegna(); }

    function disegna() {
      const m = modello();
      btnOggi.disabled = mese === oggiMese;
      const annoOggi = +oggiMese.slice(0, 4);
      const anni = new Set([annoOggi + 1, annoOggi, annoOggi - 1, annoOggi - 2, +mese.slice(0, 4)]);
      selAnno.replaceChildren(...[...anni].sort((x, y) => y - x).map((a) => h('option', { value: String(a) }, String(a))));
      selAnno.value = mese.slice(0, 4);
      selMese.value = mese.slice(5, 7);

      const pratiche = m.pratiche.filter((p) => p.conclusa && p.meseRif === mese).sort((a, b) => a.id - b.id);
      const voci = pratiche.flatMap((p) => p.voci.filter((v) => v.collaboratoreId != null).map((v) => ({ p, v })));
      // le persone che hanno qualcosa nel mese, nell'ordine dell'elenco dei collaboratori
      const persone = m.collaboratori.filter((c) => voci.some(({ v }) => v.collaboratoreId === c.id));
      const importo = (p, id) => p.voci.filter((v) => v.collaboratoreId === id).reduce((t, v) => t + v.provvigioneCent, 0);
      const totalePersona = (id) => pratiche.reduce((t, p) => t + importo(p, id), 0);
      const totale = voci.reduce((t, { v }) => t + v.provvigioneCent, 0);

      const barra = h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between', margin: '4px 0 12px' } },
        h('span', { class: 'sottotesto' }, `${pratiche.length} ${pratiche.length === 1 ? 'pratica' : 'pratiche'} a ${meseAnno(mese)}`),
        pratiche.length ? h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => {
          const r = await app.driver.esportaFile(codificaTesto(csvProvvigioni(m, voci)), nomeFile(`Provvigioni_${mese}`, 'csv'), 'text/csv;charset=utf-8');
          if (r && r.salvato !== false) notificaOk('Provvigioni esportate in CSV.');
        } }, icona('download', { dimensione: 15 }), 'Esporta in CSV') : null);

      if (!pratiche.length) {
        monta(corpo, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('hand-coins', { dimensione: 40 }), h('strong', null, `Nessuna pratica a ${meseAnno(mese)}`),
          h('p', null, 'Cambia mese oppure inserisci una pratica.'), h('a', { class: 'btn btn-primario', href: '#/nuova' }, icona('plus', { dimensione: 16 }), 'Nuova pratica'))));
        return;
      }

      const riepilogo = h('div', { class: 'kpi-contenitore', style: { marginBottom: '8px' } }, h('div', { class: 'kpi-griglia', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' } },
        ...persone.map((c) => h('div', { class: 'kpi', dataset: { collab: c.id } }, h('span', { class: 'kpi-etichetta' }, c.nome), h('div', { class: 'kpi-valore' }, eur(totalePersona(c.id))))),
        h('div', { class: 'kpi kpi-totale' }, h('span', { class: 'kpi-etichetta' }, 'Totale da pagare'), h('div', { class: 'kpi-valore' }, eur(totale)))));

      const percentuale = (p) => {
        const v = p.voci.find((x) => !x.fissa && x.collaboratoreId != null);
        return v ? pct(Math.round(v.percentualeApplicata * 100) / 100) : '—';
      };
      const tabella = h('div', { class: 'card' }, h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella tabella-foglio', id: 'foglio-mese' },
        h('caption', { class: 'solo-lettori' }, `Provvigioni di ${meseAnno(mese)}: una riga per pratica`),
        h('thead', null, h('tr', null, h('th', null, 'Pratica'), h('th', { class: 'num' }, 'Compenso'), h('th', { class: 'num' }, '%'),
          ...persone.map((c) => h('th', { class: 'num' }, c.nome)), h('th', { class: 'num' }, 'Totale provvigioni'))),
        h('tbody', null, pratiche.map((p) => h('tr', { class: 'cliccabile', onclick: (ev) => { if (!ev.target.closest('a')) naviga(`#/pratiche/${p.id}`); } },
          h('td', null, h('a', { href: `#/pratiche/${p.id}`, class: 'forte', style: { color: 'var(--text)' } }, p.codice), h('span', { class: 'sottotesto' }, p.descrizione)),
          h('td', { class: 'num' }, eur(p.compensoTotaleCent)), h('td', { class: 'num' }, percentuale(p)),
          ...persone.map((c) => { const x = importo(p, c.id); return h('td', { class: 'num' }, x ? eur(x) : '—'); }),
          h('td', { class: 'num forte' }, eur(p.voci.filter((v) => v.collaboratoreId != null).reduce((t, v) => t + v.provvigioneCent, 0)))))),
        h('tfoot', null, h('tr', null, h('td', null, 'Totale'), h('td', { class: 'num' }, eur(pratiche.reduce((t, p) => t + p.compensoTotaleCent, 0))), h('td', null, ''),
          ...persone.map((c) => h('td', { class: 'num' }, eur(totalePersona(c.id)))), h('td', { class: 'num' }, eur(totale)))))));
      monta(corpo, riepilogo, barra, tabella);
    }

    monta(contenitore,
      h('div', { class: 'pagina-testa' },
        h('div', null, h('h1', null, 'Provvigioni'), h('p', null, 'Il foglio del mese: chi prende quanto su ogni pratica. Le provvigioni sono già pagate appena inserisci la pratica.')),
        h('div', { class: 'pagina-azioni' },
          h('div', { class: 'mese-nav' },
            h('button', { type: 'button', class: 'btn btn-secondario btn-icona', 'aria-label': 'Mese precedente', id: 'mese-prec', onclick: () => imposta(aggiungiMesi(mese, -1)) }, icona('chevron-left', { dimensione: 18 })),
            selMese, selAnno,
            h('button', { type: 'button', class: 'btn btn-secondario btn-icona', 'aria-label': 'Mese successivo', id: 'mese-succ', onclick: () => imposta(aggiungiMesi(mese, 1)) }, icona('chevron-right', { dimensione: 18 }))),
          btnOggi)),
      corpo);
    disegna();
    return { aggiorna: disegna };
  },
};
