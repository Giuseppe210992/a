// Provvigioni: chi prende quanto su ogni pratica. Una volta inserita la pratica le provvigioni sono già considerate
// pagate: niente liquidazioni da registrare.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto } from '../core/app.js';
import { naviga } from '../core/router.js';
import { eur, pct } from '../core/format.js';
import { ok as notificaOk } from '../core/ui.js';
import { concluseNelContesto, vociDi } from '../data/calc/aggregati.js';
import { csvProvvigioni, codificaTesto, nomeFile } from '../data/esporta.js';

export const provvigioni = {
  id: 'provvigioni', titolo: 'Provvigioni',
  filtri: { zona: true, collaboratore: true, granularita: false },
  monta(contenitore) {
    const contenuto = h('div', { id: 'pannello-prov' });

    function disegna() {
      const m = modello();
      const ctx = contesto();
      const nomi = new Map(m.collaboratori.map((c) => [c.id, c]));
      const voci = [];
      for (const p of concluseNelContesto(m, ctx)) for (const v of vociDi(p, ctx)) if (v.collaboratoreId != null) voci.push({ p, v });
      voci.sort((a, b) => (a.p.dataRif < b.p.dataRif ? 1 : a.p.dataRif > b.p.dataRif ? -1 : b.p.id - a.p.id));
      // totale per persona
      const perPersona = new Map();
      for (const { v } of voci) perPersona.set(v.collaboratoreId, (perPersona.get(v.collaboratoreId) || 0) + v.provvigioneCent);
      const totale = voci.reduce((s, { v }) => s + v.provvigioneCent, 0);
      const barra = h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between', marginBottom: '12px' } },
        h('span', { class: 'sottotesto' }, ctx.periodo.etichetta),
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => {
          const r = await app.driver.esportaFile(codificaTesto(csvProvvigioni(m, voci)), nomeFile('Provvigioni', 'csv'), 'text/csv;charset=utf-8');
          if (r && r.salvato !== false) notificaOk('Provvigioni esportate in CSV.');
        } }, icona('download', { dimensione: 15 }), 'Esporta in CSV'));
      if (!voci.length) { monta(contenuto, barra, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('hand-coins', { dimensione: 40 }), h('strong', null, 'Nessuna provvigione nel periodo'), h('p', null, 'Cambia periodo o inserisci una pratica.')))); return; }
      const riepilogo = h('div', { class: 'kpi-contenitore', style: { marginBottom: '16px' } }, h('div', { class: 'kpi-griglia', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
        ...m.collaboratori.filter((c) => perPersona.has(c.id)).map((c) => [c.id, perPersona.get(c.id)]).map(([id, cent]) => h('div', { class: 'kpi', dataset: { collab: id } }, h('span', { class: 'kpi-etichetta' }, nomi.get(id)?.nome ?? '?'), h('div', { class: 'kpi-valore' }, eur(cent)))),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-etichetta' }, 'Totale'), h('div', { class: 'kpi-valore' }, eur(totale)))));
      monta(contenuto, riepilogo, barra, h('div', { class: 'card' }, h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella', id: 'tabella-dettaglio' },
        h('caption', { class: 'solo-lettori' }, 'Provvigioni per pratica e collaboratore'),
        h('thead', null, h('tr', null, h('th', null, 'Pratica'), h('th', null, 'Chi'), h('th', { class: 'num' }, 'Quota'), h('th', { class: 'num' }, 'Compenso'), h('th', null, 'Percentuale'), h('th', { class: 'num' }, 'Provvigione'))),
        h('tbody', null, voci.map(({ p, v }) => h('tr', { class: 'cliccabile', onclick: (ev) => { if (!ev.target.closest('a')) naviga(`#/pratiche/${p.id}`); } },
          h('td', null, h('a', { href: `#/pratiche/${p.id}`, class: 'forte', style: { color: 'var(--text)' } }, p.codice), h('span', { class: 'sottotesto' }, `${p.descrizione} · ${p.dataEtichetta}`)),
          h('td', null, h('span', { class: 'chip-col' }, h('span', { class: `punto-col col-${nomi.get(v.collaboratoreId)?.colore ?? 0}` }), nomi.get(v.collaboratoreId)?.nome ?? '?')),
          h('td', { class: 'num' }, v.fissa ? '—' : pct(v.quotaPct)), h('td', { class: 'num' }, v.fissa ? '—' : eur(v.fatturatoCent)),
          h('td', null, v.fissa ? h('span', { class: 'badge badge-info' }, `${pct(v.percentualeFissa)} del compenso`) : v.scaglioneIdx >= 0 ? h('span', { class: 'badge badge-info' }, `${v.scaglioneIdx + 1}° · ${pct(Math.round(v.percentualeApplicata * 100) / 100)}`) : h('span', { class: 'sottotesto' }, '—')),
          h('td', { class: 'num forte' }, eur(v.provvigioneCent))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 5 }, `Totale (${voci.length} righe)`), h('td', { class: 'num' }, eur(totale))))))));
    }

    monta(contenitore,
      h('div', { class: 'pagina-testa' }, h('div', null, h('h1', null, 'Provvigioni'), h('p', null, 'Chi prende quanto su ogni pratica. Una volta inserita la pratica le provvigioni sono già pagate.'))),
      contenuto);
    disegna();
    return { aggiorna: disegna };
  },
};
