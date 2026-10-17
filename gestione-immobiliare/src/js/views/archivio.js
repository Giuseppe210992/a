// Archivio pratiche: ricerca, filtri, ordinamento, apertura, modifica ed eliminazione (con conferma).
import { h, monta, ritarda, evidenzia } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello } from '../core/app.js';
import { naviga } from '../core/router.js';
import { eur, eurInt, dataIt, normalizza, pct } from '../core/format.js';
import { apriModale, conferma, menuAzioni, ok as notificaOk, segnalaErrore } from '../core/ui.js';
import { ETICHETTA_STATO, dettaglioEliminazionePratica, eliminaPratica, salvaPratica } from '../data/repo/pratiche.js';
import { CAMPI_PAGAMENTO } from '../data/calc/compensi.js';
import { csvPratiche, codificaTesto, nomeFile } from '../data/esporta.js';
import { apriDialogoIncasso } from '../components/dialoghi.js';
import { badgeStato } from './dashboard.js';

const PER_PAGINA = 25;
const COLONNE = [
  { id: 'codice', titolo: 'Codice', ordina: (p) => p.codice },
  { id: 'data', titolo: 'Data', ordina: (p) => p.dataRif },
  { id: 'immobile', titolo: 'Pratica', ordina: (p) => normalizza(p.descrizione) },
  { id: 'zona', titolo: 'Zona', ordina: (p) => normalizza(p.zonaNome || 'zzz') },
  { id: 'stato', titolo: 'Stato', ordina: (p) => p.stato },
  { id: 'collaboratori', titolo: 'Collaboratori', senzaOrdine: true },
  { id: 'prezzo', titolo: 'Prezzo vendita', num: true, classe: 'col-prezzo', ordina: (p) => p.prezzo_vendita_cent ?? -1 },
  { id: 'compensi', titolo: 'Compensi', num: true, ordina: (p) => p.compensoTotaleCent },
  { id: 'incassato', titolo: 'Incassato', num: true, ordina: (p) => p.incassatoCent },
];

export function eliminaPraticaConConferma(p, { dopo = null } = {}) {
  const det = dettaglioEliminazionePratica(app.archivio, p.id);
  if (det.liquidazioni > 0) {
    return apriModale({
      titolo: 'Questa pratica non si può eliminare', icona: 'triangle-alert', tonoIcona: 'attenzione',
      contenuto: h('div', null,
        h('p', null, `La pratica ${p.codice} ha ${det.liquidazioni === 1 ? 'una liquidazione registrata' : `${det.liquidazioni} liquidazioni registrate`}: eliminarla altererebbe i pagamenti già fatti ai collaboratori.`),
        h('p', { style: { marginTop: '8px' } }, 'Puoi segnarla come “Annullata”: non conterà più nei totali ma resterà nell\'archivio.')),
      azioni: [
        { id: 'chiudi', etichetta: 'Chiudi', tipo: 'secondario' },
        ...(p.stato !== 'annullata' ? [{ id: 'annulla', etichetta: 'Segna come annullata', tipo: 'primario', onClick: async () => {
          // si riscrive la pratica identica, cambiando solo lo stato (compresi gli importi pagati e il loro modo)
          const dati = Object.fromEntries(['id', 'codice', 'data_pratica', 'data_rogito', 'zona_id', 'immobile_indirizzo', 'immobile_comune', 'immobile_tipo', 'prezzo_vendita_cent', 'prezzo_acquisto_cent', 'venditore', 'acquirente',
            'compensi_da_pagamenti', 'mese_proposta', ...CAMPI_PAGAMENTO, 'compenso_venditore_cent', 'compenso_acquirente_cent', 'aliquota_iva', 'note'].map((c) => [c, p[c]]));
          await salvaPratica(app.archivio, { ...dati, stato: 'annullata' },
            p.voci.filter((v) => v.collaboratoreId != null && !v.fissa).map((v) => ({ collaboratore_id: v.collaboratoreId, percentuale: v.quotaPct })));
          notificaOk(`Pratica ${p.codice} segnata come annullata.`);
          if (dopo) dopo('annullata');
        } }] : []),
      ],
    }).risultato;
  }
  const dettagli = [`${p.descrizione}${p.immobile_comune ? `, ${p.immobile_comune}` : ''} · ${ETICHETTA_STATO[p.stato]}`];
  if (det.incassi) dettagli.push(`Verranno eliminati anche ${det.incassi} ${det.incassi === 1 ? 'incasso registrato' : 'incassi registrati'} (${eur(det.incassatoCent)}).`);
  if (det.quote) dettagli.push('Verrà eliminata anche la ripartizione tra collaboratori.');
  dettagli.push('L\'operazione non si può annullare: se non sei sicuro, crea prima un backup.');
  return conferma({ titolo: `Eliminare la pratica ${p.codice}?`, messaggio: 'Stai per eliminare definitivamente questa pratica.', dettagli, etichettaConferma: 'Elimina la pratica', tipo: 'pericolo' }).then(async (sì) => {
    if (!sì) return false;
    try {
      await eliminaPratica(app.archivio, p.id);
      notificaOk(`Pratica ${p.codice} eliminata.`);
      if (dopo) dopo('eliminata');
      return true;
    } catch (e) {
      segnalaErrore(e, 'Eliminazione pratica');
      return false;
    }
  });
}

function leggiQuery(query) {
  return {
    q: query.q ?? '', stato: query.stato ?? '', zona: query.zona ?? '', collab: query.collab ?? '', anno: query.anno ?? '',
    da: query.da ?? '', a: query.a ?? '', incomplete: query.incomplete === '1',
    ord: query.ord ?? 'data', dir: query.dir ?? 'desc', pag: Math.max(1, parseInt(query.pag ?? '1', 10) || 1),
  };
}

function aQuery(s) {
  const p = new URLSearchParams();
  for (const k of ['q', 'stato', 'zona', 'collab', 'anno', 'da', 'a']) if (s[k]) p.set(k, s[k]);
  if (s.incomplete) p.set('incomplete', '1');
  if (s.ord !== 'data') p.set('ord', s.ord);
  if (s.dir !== 'desc') p.set('dir', s.dir);
  if (s.pag > 1) p.set('pag', String(s.pag));
  const qs = p.toString();
  return `#/pratiche${qs ? `?${qs}` : ''}`;
}

export function filtraPratiche(m, s) {
  const termini = normalizza(s.q).split(/\s+/).filter(Boolean);
  return m.pratiche.filter((p) => {
    if (s.stato && p.stato !== s.stato) return false;
    if (s.zona && String(p.zona_id) !== s.zona) return false;
    if (s.collab && !p.voci.some((v) => String(v.collaboratoreId) === s.collab)) return false;
    if (s.anno && !(p.dataRif || '').startsWith(s.anno)) return false;
    if (s.da && (!p.dataRif || p.dataRif < s.da)) return false;
    if (s.a && (!p.dataRif || p.dataRif > s.a)) return false;
    if (s.incomplete && !p.incompleta) return false;
    if (termini.length) {
      const testo = normalizza([p.codice, p.descrizione, p.immobile_indirizzo, p.immobile_comune, p.immobile_tipo, p.venditore, p.acquirente, p.zonaNome, p.note, ETICHETTA_STATO[p.stato]].join(' '));
      if (!termini.every((t) => testo.includes(t))) return false;
    }
    return true;
  });
}

export const archivio = {
  id: 'pratiche', titolo: 'Archivio pratiche',
  monta(contenitore, params, query) {
    let s = leggiQuery(query);
    const m0 = modello();
    const anniPresenti = [...new Set(m0.pratiche.map((p) => (p.dataRif || '').slice(0, 4)).filter(Boolean))].sort().reverse();

    const campoQ = h('input', { type: 'search', class: 'input', id: 'arch-q', placeholder: 'Cerca per codice, zona, cliente, note…', value: s.q, 'aria-label': 'Cerca nell\'archivio', autocomplete: 'off' });
    const sel = (id, etichetta, opzioni, valore) => {
      const el = h('select', { class: 'select', id, 'aria-label': etichetta }, opzioni.map(([v, e]) => h('option', { value: v }, e)));
      el.value = valore;
      return el;
    };
    const selStato = sel('arch-stato', 'Stato', [['', 'Tutti gli stati'], ['in_corso', 'In corso'], ['conclusa', 'Concluse'], ['annullata', 'Annullate']], s.stato);
    const selZona = sel('arch-zona', 'Zona', [['', 'Tutte le zone'], ...m0.zone.map((z) => [String(z.id), z.nome])], s.zona);
    const selColl = sel('arch-collab', 'Collaboratore', [['', 'Tutti i collaboratori'], ...m0.collaboratori.map((c) => [String(c.id), c.nome])], s.collab);
    const selAnno = sel('arch-anno', 'Anno', [['', 'Tutti gli anni'], ...anniPresenti.map((a) => [a, a])], s.anno);
    const chkInc = h('input', { type: 'checkbox', id: 'arch-inc', checked: s.incomplete });
    const corpo = h('div', { class: 'archivio-corpo' });
    const conteggio = h('p', null);

    const aggiornaUrl = () => history.replaceState(null, '', aQuery(s));
    const applica = (parziale, { reset = true } = {}) => {
      s = { ...s, ...parziale };
      if (reset) s.pag = 1;
      aggiornaUrl();
      disegna();
    };
    const ritardo = ritarda(() => applica({ q: campoQ.value.trim() }), 220);
    campoQ.addEventListener('input', ritardo);
    campoQ.addEventListener('keydown', (e) => { if (e.key === 'Escape') { campoQ.value = ''; ritardo.annulla(); applica({ q: '' }); } });
    selStato.addEventListener('change', () => applica({ stato: selStato.value }));
    selZona.addEventListener('change', () => applica({ zona: selZona.value }));
    selColl.addEventListener('change', () => applica({ collab: selColl.value }));
    selAnno.addEventListener('change', () => applica({ anno: selAnno.value }));
    chkInc.addEventListener('change', () => applica({ incomplete: chkInc.checked }));

    const chipPeriodo = h('div', { class: 'riga-azioni' });

    function disegna() {
      const m = modello();
      const tutte = filtraPratiche(m, s);
      const col = COLONNE.find((c) => c.id === s.ord) || COLONNE[1];
      const ordinate = tutte.slice().sort((a, b) => {
        const va = col.ordina(a), vb = col.ordina(b);
        const c = va < vb ? -1 : va > vb ? 1 : 0;
        return (s.dir === 'asc' ? c : -c) || b.id - a.id;
      });
      const pagine = Math.max(1, Math.ceil(ordinate.length / PER_PAGINA));
      if (s.pag > pagine) s.pag = pagine;
      const pagina = ordinate.slice((s.pag - 1) * PER_PAGINA, s.pag * PER_PAGINA);
      const termini = normalizza(s.q).split(/\s+/).filter(Boolean);
      conteggio.textContent = m.pratiche.length === 0 ? 'Nessuna pratica inserita' : `${ordinate.length} ${ordinate.length === 1 ? 'pratica' : 'pratiche'}${ordinate.length !== m.pratiche.length ? ` su ${m.pratiche.length}` : ''}`;

      chipPeriodo.replaceChildren();
      if (s.da || s.a) chipPeriodo.append(h('span', { class: 'chip-col' }, icona('calendar', { dimensione: 14 }), `Periodo: ${s.da ? dataIt(s.da) : '…'} – ${s.a ? dataIt(s.a) : '…'}`,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icona', 'aria-label': 'Togli il filtro per periodo', style: { width: '22px', height: '22px', marginLeft: '2px' }, onclick: () => applica({ da: '', a: '' }) }, icona('x', { dimensione: 13 }))));

      if (!m.pratiche.length) {
        monta(corpo, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('archive', { dimensione: 44 }), h('strong', null, 'L\'archivio è vuoto'), h('p', null, 'Ogni compravendita che inserisci compare qui e puoi cercarla, modificarla ed esportarla.'), h('a', { class: 'btn btn-primario', href: '#/nuova' }, icona('plus', { dimensione: 16 }), 'Inserisci la prima pratica'))));
        return;
      }
      if (!ordinate.length) {
        monta(corpo, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('search', { dimensione: 44 }), h('strong', null, 'Nessuna pratica corrisponde'), h('p', null, 'Prova a cambiare o togliere qualche filtro.'), h('button', { type: 'button', class: 'btn btn-secondario', onclick: () => { campoQ.value = ''; selStato.value = selZona.value = selColl.value = selAnno.value = ''; chkInc.checked = false; applica({ q: '', stato: '', zona: '', collab: '', anno: '', da: '', a: '', incomplete: false }); } }, 'Azzera i filtri'))));
        return;
      }

      const testa = h('tr', null, ...COLONNE.map((c) => {
        const attiva = s.ord === c.id;
        const th = h('th', { class: `${c.num ? 'num' : ''} ${c.senzaOrdine ? '' : 'ordinabile'} ${c.classe ?? ''}`, scope: 'col', 'aria-sort': attiva ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
          c.senzaOrdine ? c.titolo : h('button', { type: 'button', class: 'th-btn', onclick: () => applica({ ord: c.id, dir: attiva && s.dir === 'desc' ? 'asc' : (attiva ? 'desc' : (c.id === 'data' || c.num ? 'desc' : 'asc')) }) }, c.titolo, h('span', { class: 'freccia', 'aria-hidden': 'true' }, attiva ? (s.dir === 'asc' ? '▲' : '▼') : '')));
        return th;
      }), h('th', { class: 'centro' }, h('span', { class: 'solo-lettori' }, 'Azioni')));

      const righe = pagina.map((p) => {
        const vai = () => naviga(`#/pratiche/${p.id}`);
        const btnMenu = h('button', { type: 'button', class: 'btn btn-ghost btn-icona btn-sm', 'aria-label': `Azioni per la pratica ${p.codice}` }, icona('ellipsis', { dimensione: 18 }));
        const menu = menuAzioni(btnMenu, [
          { etichetta: 'Apri la scheda', icona: 'eye', onClick: vai },
          { etichetta: 'Modifica', icona: 'pencil', onClick: () => naviga(`#/pratiche/${p.id}/modifica`) },
          { etichetta: 'Registra un incasso', icona: 'banknote', onClick: () => apriDialogoIncasso({ praticaId: p.id }) },
          '-',
          { etichetta: 'Elimina…', icona: 'trash-2', pericolo: true, onClick: () => eliminaPraticaConConferma(p) },
        ]);
        const incassoPct = p.totaleLordoCent > 0 ? Math.min(100, (p.incassatoCent / p.totaleLordoCent) * 100) : 0;
        return h('tr', { class: 'cliccabile', dataset: { id: p.id }, onclick: (ev) => { if (!ev.target.closest('a, button, .popover')) vai(); } },
          h('td', { class: 'forte' }, h('a', { href: `#/pratiche/${p.id}`, style: { color: 'var(--text)' } }, ...evidenzia(p.codice, termini)), p.incompleta ? h('span', { class: 'badge badge-warn', style: { marginLeft: '8px' }, title: p.mancanti.map((x) => x.testo).join(' · ') }, icona('triangle-alert', { dimensione: 13 }), 'Dati') : null),
          h('td', { class: 'num' }, p.dataEtichetta),
          h('td', { class: 'immobile' }, h('span', { class: 'forte' }, ...evidenzia(p.descrizione, termini)), h('span', { class: 'sottotesto' }, ...evidenzia([p.immobile_comune, p.immobile_tipo].filter(Boolean).join(' · '), termini), p.prezzo_vendita_cent ? h('span', { class: 'prezzo-inline' }, ` · ${eurInt(p.prezzo_vendita_cent)}`) : null),
            (p.venditore || p.acquirente) ? h('span', { class: 'sottotesto' }, ...evidenzia([p.venditore && `Ven. ${p.venditore}`, p.acquirente && `Acq. ${p.acquirente}`].filter(Boolean).join(' · '), termini)) : null),
          h('td', null, p.zonaNome ?? h('span', { class: 'badge badge-warn' }, 'Da indicare')),
          h('td', null, badgeStato(p.stato)),
          h('td', null, h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, p.voci.filter((v) => v.collaboratoreId != null && !v.fissa).map((v) => {
            const c = m.collaboratori.find((x) => x.id === v.collaboratoreId);
            return h('span', { class: 'chip-col', title: `${c?.nome} ${pct(v.quotaPct)}` }, h('span', { class: `punto-col col-${c?.colore ?? 0}` }), c?.nome ?? '?', v.quotaPct < 100 ? h('span', { class: 'sottotesto' }, ` ${pct(v.quotaPct)}`) : null);
          }), p.voci.every((v) => v.collaboratoreId == null || v.fissa) ? h('span', { class: 'sottotesto' }, '—') : null)),
          h('td', { class: 'num col-prezzo' }, p.prezzo_vendita_cent ? eur(p.prezzo_vendita_cent) : '—'),
          h('td', { class: 'num forte' }, eur(p.compensoTotaleCent)),
          h('td', { class: 'num' }, eur(p.incassatoCent), p.totaleLordoCent > 0 ? h('span', { class: 'sottotesto' }, `${Math.round(incassoPct)}% di ${eurInt(p.totaleLordoCent)}`) : null),
          h('td', { class: 'centro' }, menu));
      });

      const tab = h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella archivio', id: 'tabella-archivio' }, h('caption', { class: 'solo-lettori' }, 'Elenco delle pratiche'), h('thead', null, testa), h('tbody', null, righe)));
      const paginazione = pagine > 1 ? h('div', { class: 'paginazione' },
        h('span', null, `Pratiche ${(s.pag - 1) * PER_PAGINA + 1}–${Math.min(s.pag * PER_PAGINA, ordinate.length)} di ${ordinate.length}`),
        h('div', { class: 'gruppo' },
          h('button', { type: 'button', class: 'btn btn-secondario btn-sm', disabled: s.pag <= 1, onclick: () => applica({ pag: s.pag - 1 }, { reset: false }) }, icona('chevron-left', { dimensione: 16 }), 'Precedente'),
          h('span', null, `Pagina ${s.pag} di ${pagine}`),
          h('button', { type: 'button', class: 'btn btn-secondario btn-sm', disabled: s.pag >= pagine, onclick: () => applica({ pag: s.pag + 1 }, { reset: false }) }, 'Successiva', icona('chevron-right', { dimensione: 16 })))) : null;
      monta(corpo, h('div', { class: 'card' }, tab, paginazione));
    }

    const esporta = h('button', { type: 'button', class: 'btn btn-secondario', onclick: async () => {
      const m = modello();
      const elenco = filtraPratiche(m, s);
      if (!elenco.length) { notificaOk('Non ci sono pratiche da esportare con questi filtri.'); return; }
      const r = await app.driver.esportaFile(codificaTesto(csvPratiche(m, elenco)), nomeFile('Pratiche', 'csv'), 'text/csv;charset=utf-8');
      if (r && r.salvato !== false) notificaOk(`${elenco.length} pratiche esportate in CSV.`);
    } }, icona('download', { dimensione: 16 }), 'Esporta l\'elenco');

    monta(contenitore,
      h('div', { class: 'pagina-testa' },
        h('div', null, h('h1', null, 'Archivio pratiche'), conteggio),
        h('div', { class: 'pagina-azioni' }, esporta, h('a', { class: 'btn btn-primario', href: '#/nuova' }, icona('plus', { dimensione: 18 }), 'Nuova pratica'))),
      h('div', { class: 'card card-corpo', style: { marginBottom: '16px' } },
        h('div', { class: 'griglia-campi' },
          h('div', { class: 'c-12' }, h('div', { class: 'ricerca', style: { maxWidth: 'none' } }, icona('search', { dimensione: 18, classe: 'lente' }), campoQ)),
          h('div', { class: 'c-3 mezzo' }, selStato), h('div', { class: 'c-3 mezzo' }, selZona), h('div', { class: 'c-3 mezzo' }, selColl), h('div', { class: 'c-3 mezzo' }, selAnno),
          h('div', { class: 'c-12' }, h('div', { class: 'riga-azioni' }, h('label', { class: 'check', for: 'arch-inc' }, chkInc, 'Solo pratiche con dati mancanti'), chipPeriodo)))),
      corpo);
    disegna();
    return { aggiorna: disegna };
  },
};
