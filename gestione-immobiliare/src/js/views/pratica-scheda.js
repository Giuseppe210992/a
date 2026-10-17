// Scheda di una pratica: dati, compensi, incassi, ripartizione, provvigioni e passaggi del calcolo.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, impostazioni } from '../core/app.js';
import { naviga } from '../core/router.js';
import { eur, eurSegno, pct, pctSegno, dataIt, meseAnno, num } from '../core/format.js';
import { giorniTra } from '../core/dates.js';
import { apriModale, conferma, menuAzioni, ok as notificaOk, segnalaErrore } from '../core/ui.js';
import { campoData, campoImporto, campoSelezione, campoTesto, mostraErrori } from '../components/campi.js';
import { modificaIncasso, eliminaIncasso, PAGANTI, METODI_PAGAMENTO } from '../data/repo/pratiche.js';
import { opzioniCalcolo } from '../data/repo/impostazioni.js';
import { stimaPratica } from '../data/stima.js';
import { apriDialogoIncasso, apriDialogoLiquidazione } from '../components/dialoghi.js';
import { badgeStato } from './dashboard.js';
import { eliminaPraticaConConferma } from './archivio.js';

function modificaIncassoDialogo(inc) {
  const data = campoData({ etichetta: 'Data', valore: inc.data, obbligatorio: true });
  const importo = campoImporto({ etichetta: 'Importo (IVA inclusa)', centesimi: inc.importo_cent, obbligatorio: true });
  const pagante = campoSelezione({ etichetta: 'Pagato da', valore: inc.pagante ?? '', vuoto: 'Non indicato', opzioni: PAGANTI.map((x) => ({ valore: x, etichetta: x })) });
  const metodo = campoSelezione({ etichetta: 'Metodo', valore: inc.metodo ?? '', vuoto: 'Non indicato', opzioni: METODI_PAGAMENTO.map((x) => ({ valore: x, etichetta: x })) });
  const note = campoTesto({ etichetta: 'Note', valore: inc.note ?? '', maxlength: 300 });
  return apriModale({
    titolo: 'Modifica incasso', icona: 'pencil', larghezza: 560, invioConferma: true,
    contenuto: h('form', { onsubmit: (e) => e.preventDefault() }, h('div', { class: 'griglia-campi' },
      h('div', { class: 'c-6' }, data.el), h('div', { class: 'c-6' }, importo.el), h('div', { class: 'c-6' }, pagante.el), h('div', { class: 'c-6' }, metodo.el), h('div', { class: 'c-12' }, note.el))),
    azioni: [{ id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' }, { id: 'salva', etichetta: 'Salva', tipo: 'primario', onClick: async () => {
      if (!importo.valido()) { importo.errore('Scrivi un importo valido.'); return false; }
      try {
        await modificaIncasso(app.archivio, inc.id, { data: data.get(), importoCent: importo.get() ?? 0, pagante: pagante.get(), metodo: metodo.get(), note: note.get() });
        notificaOk('Incasso aggiornato.');
      } catch (e) {
        if (e.campi) { mostraErrori({ data, importoCent: importo }, e.campi); return false; }
        throw e;
      }
    } }],
  });
}

async function eliminaIncassoConferma(inc, p) {
  const sì = await conferma({
    titolo: 'Eliminare questo incasso?', messaggio: `Stai per eliminare l'incasso di ${eur(inc.importo_cent)} del ${dataIt(inc.data)} sulla pratica ${p.codice}.`,
    dettagli: ['Gli importi incassati e da incassare della pratica verranno ricalcolati.'], etichettaConferma: 'Elimina incasso', tipo: 'pericolo',
  });
  if (!sì) return;
  try { await eliminaIncasso(app.archivio, inc.id); notificaOk('Incasso eliminato.'); } catch (e) { segnalaErrore(e, 'Eliminazione incasso'); }
}

function passaggiCalcolo(m, p, v, nome) {
  if (v.fissa) {
    // chi prende una percentuale fissa: una percentuale del totale delle provvigioni dei collaboratori della pratica
    return [
      `Totale delle provvigioni dei collaboratori su questa pratica: ${eur(v.baseCent)}.`,
      `${nome} prende il ${pct(v.percentualeFissa)} di quel totale, in qualsiasi zona: ${eur(v.baseCent)} × ${pct(v.percentualeFissa)} = ${eur(v.provvigioneCent)} (arrotondato al centesimo).`,
    ];
  }
  const cu = m.cumuli.find((c) => c.chiave === v.cumuloChiave);
  const metodo = m.opzioni.metodo;
  const passi = [];
  passi.push(p.compensi.daPagamenti
    ? `Compenso della pratica: ${eur(p.compenso_venditore_cent)} dal venditore + ${eur(p.compenso_acquirente_cent)} dall'acquirente = ${eur(p.compensoTotaleCent)} (senza IVA: l'IVA è stata tolta da quanto hanno pagato).`
    : `Compenso della pratica: ${eur(p.compenso_venditore_cent)} dal venditore + ${eur(p.compenso_acquirente_cent)} dall'acquirente = ${eur(p.compensoTotaleCent)} (imponibile, IVA esclusa).`);
  passi.push(`Quota di ${nome}: ${pct(v.quotaPct)} → fatturato attribuito ${eur(v.fatturatoCent)}.`);
  if (!p.conclusa) return passi.concat(['La provvigione si calcola quando la pratica risulta conclusa.']);
  if (cu) {
    const chi = m.opzioni.baseCumulo === 'zona' ? `della zona ${cu.zonaNome ?? ''}` : m.opzioni.baseCumulo === 'collaboratore' ? `di ${cu.collaboratoreNome ?? nome} (tutte le zone)` : `di ${cu.collaboratoreNome ?? nome} nella zona ${cu.zonaNome ?? 'senza zona'}`;
    passi.push(`Cumulo di ${meseAnno(cu.mese)} ${chi}: ${eur(cu.fatturatoCent)} (${cu.praticheIds.length} ${cu.praticheIds.length === 1 ? 'pratica' : 'pratiche'}).`);
    if (!cu.tabellaConfigurata) {
      passi.push('Gli scaglioni non sono impostati: la percentuale applicata è 0%.');
    } else {
      const sc = cu.scaglione;
      passi.push(`Scaglione raggiunto: ${cu.scaglioneIdx + 1}° (da ${eur(sc.da)}${sc.a !== null ? ` a ${eur(sc.a)}` : ' in su'}) → ${pct(sc.percentuale)}.`);
      passi.push(metodo === 'progressivo'
        ? `Metodo progressivo: ogni percentuale vale solo sulla parte di cumulo del suo scaglione; a questa pratica spettano ${eur(v.provvigioneCent)}.`
        : `Metodo “scaglione raggiunto”: ${pct(cu.percentuale)} su tutto il cumulo; ${eur(v.fatturatoCent)} × ${pct(cu.percentuale)} = ${eur(v.provvigioneCent)}.`);
    }
  }
  passi.push(m.opzioni.maturazione === 'incasso'
    ? `Maturata all'incasso: in proporzione a quanto il cliente ha pagato (${pct(Math.round(p.frazioneIncassata * 10000) / 100)}) → ${eur(v.maturataCent)}.`
    : `Maturata alla conclusione della pratica: ${eur(v.maturataCent)}.`);
  passi.push(`Liquidata finora: ${eur(v.liquidataCent)} → ancora da liquidare ${eur(v.daLiquidareCent)}.`);
  return passi;
}

export const scheda = {
  id: 'scheda', titolo: 'Scheda pratica',
  monta(contenitore, params) {
    const m = modello();
    const p = m.perId.get(+params.id);
    if (!p) {
      monta(contenitore, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('circle-x', { dimensione: 44 }), h('strong', null, 'Pratica non trovata'), h('p', null, 'La pratica che cerchi non esiste più (forse è stata eliminata).'), h('a', { class: 'btn btn-primario', href: '#/pratiche' }, 'Vai all\'archivio'))));
      return {};
    }
    document.title = `${p.codice} · Gestione Immobiliare`;
    const nomeDi = (id) => m.collaboratori.find((c) => c.id === id)?.nome ?? 'Non assegnato';
    const incassi = m.incassi.filter((i) => i.pratica_id === p.id);
    const righeLiq = m.liquidazioni.flatMap((l) => l.righe.filter((r) => r.pratica_id === p.id).map((r) => ({ l, r })));

    const btnAltro = h('button', { type: 'button', class: 'btn btn-secondario btn-icona', 'aria-label': 'Altre azioni' }, icona('ellipsis', { dimensione: 20 }));
    const menu = menuAzioni(btnAltro, [
      { etichetta: 'Elimina la pratica…', icona: 'trash-2', pericolo: true, onClick: () => eliminaPraticaConConferma(p, { dopo: () => naviga('#/pratiche') }) },
    ]);

    const testa = h('div', { class: 'scheda-testa' },
      h('div', null,
        h('a', { href: '#/pratiche', class: 'sottotesto', style: { display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '6px' } }, icona('chevron-left', { dimensione: 15 }), 'Archivio pratiche'),
        h('h1', null, p.descrizione, badgeStato(p.stato)),
        h('p', { class: 'sotto' }, `Pratica ${p.codice}${p.immobile_comune ? ` · ${p.immobile_comune}` : ''}${p.immobile_tipo ? ` · ${p.immobile_tipo}` : ''}${p.zonaNome ? ` · Zona ${p.zonaNome}` : ''}`)),
      h('div', { class: 'pagina-azioni' },
        h('a', { class: 'btn btn-primario', href: `#/pratiche/${p.id}/modifica`, id: 'btn-modifica' }, icona('pencil', { dimensione: 16 }), 'Modifica'),
        h('button', { type: 'button', class: 'btn btn-secondario', id: 'btn-incasso', onclick: () => apriDialogoIncasso({ praticaId: p.id }) }, icona('banknote', { dimensione: 16 }), 'Registra incasso'),
        p.voci.some((v) => v.collaboratoreId != null) ? h('button', { type: 'button', class: 'btn btn-secondario', id: 'btn-liquida', onclick: () => apriDialogoLiquidazione({ praticaId: p.id, collaboratoreId: p.voci.find((v) => v.collaboratoreId != null && v.daLiquidareCent > 0)?.collaboratoreId ?? null }) }, icona('hand-coins', { dimensione: 16 }), 'Liquida provvigioni') : null,
        menu));

    const avvisoMancanti = p.incompleta ? h('div', { class: 'nota attenzione', style: { marginBottom: '16px' } }, icona('triangle-alert', { dimensione: 20 }),
      h('div', null, h('strong', null, 'Dati da completare: '), p.mancanti.map((x) => x.testo).join(' · '), ' ', h('a', { href: `#/pratiche/${p.id}/modifica` }, 'Completa i dati'))) : null;

    // ---- immobile e parti
    const variaz = p.prezzo_acquisto_cent && p.prezzo_vendita_cent ? p.prezzo_vendita_cent - p.prezzo_acquisto_cent : null;
    const stessaData = !!p.data_rogito && p.data_rogito === p.data_pratica;
    const cardDati = h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Immobile e parti'),
      h('dl', { class: 'elenco-dati', style: { marginTop: '12px' } },
        p.immobile_indirizzo ? h('dt', null, 'Indirizzo') : null,
        p.immobile_indirizzo ? h('dd', null, `${p.immobile_indirizzo}${p.immobile_comune ? `, ${p.immobile_comune}` : ''}`) : null,
        h('dt', null, 'Tipo'), h('dd', null, p.immobile_tipo ?? '—'),
        h('dt', null, 'Zona'), h('dd', null, p.zonaNome ?? 'Da indicare'),
        h('dt', null, 'Prezzo di vendita'), h('dd', { class: 'num' }, p.prezzo_vendita_cent ? eur(p.prezzo_vendita_cent) : '—'),
        h('dt', null, 'Prezzo di acquisto'), h('dd', { class: 'num' }, p.prezzo_acquisto_cent ? eur(p.prezzo_acquisto_cent) : '—'),
        variaz !== null ? h('dt', null, 'Differenza') : null,
        variaz !== null ? h('dd', { class: `num ${variaz >= 0 ? 'positivo' : 'negativo'}` }, `${eurSegno(variaz)} (${pctSegno((variaz / p.prezzo_acquisto_cent) * 100)})`) : null,
        h('dt', null, 'Venditore'), h('dd', null, p.venditore ?? '—'),
        h('dt', null, 'Acquirente'), h('dd', null, p.acquirente ?? '—'),
        ...(p.meseProposta
          ? [h('dt', null, 'Mese della proposta'), h('dd', null, meseAnno(p.meseProposta)), h('dt', null, 'Inserita il'), h('dd', null, dataIt(p.data_pratica))]
          : stessaData
          ? [h('dt', null, 'Data'), h('dd', null, dataIt(p.data_rogito))]
          : [h('dt', null, 'Apertura'), h('dd', null, dataIt(p.data_pratica)),
            h('dt', null, 'Rogito'), h('dd', null, p.data_rogito ? dataIt(p.data_rogito) : '—')]),
        !p.meseProposta && !stessaData && p.data_rogito && p.data_pratica && p.data_rogito >= p.data_pratica ? h('dt', null, 'Tempo di lavorazione') : null,
        !p.meseProposta && !stessaData && p.data_rogito && p.data_pratica && p.data_rogito >= p.data_pratica ? h('dd', null, `${num(giorniTra(p.data_pratica, p.data_rogito))} giorni`) : null,
      ),
      p.note ? h('div', { style: { marginTop: '14px' } }, h('div', { class: 'sottotesto forte' }, 'Note'), h('p', { style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, p.note)) : null);

    // ---- compensi e incassi
    const incassoPct = p.totaleLordoCent > 0 ? Math.min(100, (p.incassatoCent / p.totaleLordoCent) * 100) : 0;
    const cardCompensi = h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Compensi e incassi'),
      p.compensi.daPagamenti ? h('div', { class: 'tabella-wrap', style: { marginTop: '12px' } }, h('table', { class: 'tabella tabella-compatta', id: 'tabella-pagamenti' },
        h('caption', { class: 'solo-lettori' }, 'Pagamenti ricevuti alla conclusione'),
        h('thead', null, h('tr', null, h('th', null, 'Pagato da'), h('th', null, 'Come'), h('th', { class: 'num' }, 'Importo'), h('th', null, 'IVA'))),
        h('tbody', null, m.pagamenti.filter((x) => x.praticaId === p.id).map((x) => h('tr', null,
          h('td', null, x.parte), h('td', null, x.modalita), h('td', { class: 'num forte' }, eur(x.importo_cent)),
          h('td', { class: 'sottotesto' }, 'compresa')))))) : null,
      h('div', { class: 'riepilogo-calcolo', style: { marginTop: '12px' } },
        h('div', { class: 'riga' }, h('span', null, p.compensi.daPagamenti ? 'Dal venditore (senza IVA)' : 'Dal venditore'), h('span', { class: 'valore' }, eur(p.compenso_venditore_cent))),
        h('div', { class: 'riga' }, h('span', null, p.compensi.daPagamenti ? 'Dall\'acquirente (senza IVA)' : 'Dall\'acquirente'), h('span', { class: 'valore' }, eur(p.compenso_acquirente_cent))),
        h('div', { class: 'riga' }, h('span', null, p.compensi.daPagamenti ? 'Totale compenso senza IVA' : 'Totale imponibile'), h('span', { class: 'valore' }, eur(p.compensoTotaleCent))),
        h('div', { class: 'riga' }, h('span', null, p.compensi.daPagamenti ? `IVA ${String(p.aliquota_iva).replace('.', ',')}% compresa in quanto pagato` : `IVA ${String(p.aliquota_iva).replace('.', ',')}%`), h('span', { class: 'valore' }, eur(p.ivaCent))),
        h('div', { class: 'riga totale' }, h('span', null, p.compensi.daPagamenti ? 'Totale pagato dalle parti' : 'Totale con IVA'), h('span', { class: 'valore' }, eur(p.totaleLordoCent)))),
      h('div', { style: { margin: '14px 0 6px' } },
        h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between' } }, h('span', { class: 'forte' }, `Incassato ${eur(p.incassatoCent)}`), h('span', { class: p.daIncassareCent > 0 ? 'attenuato' : 'positivo' }, p.daIncassareCent > 0 ? `Da incassare ${eur(p.daIncassareCent)}` : (p.totaleLordoCent > 0 ? 'Saldata' : ''))),
        p.totaleLordoCent > 0 ? h('div', { class: 'meter', style: { marginTop: '8px' }, role: 'img', 'aria-label': `Incassato il ${Math.round(incassoPct)}%` }, h('i', { style: { width: `${incassoPct}%` } })) : null),
      incassi.length ? h('div', { class: 'tabella-wrap', style: { marginTop: '8px' } }, h('table', { class: 'tabella tabella-compatta' },
        h('caption', { class: 'solo-lettori' }, 'Incassi della pratica'),
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', { class: 'num' }, 'Importo'), h('th', null, 'Dettagli'), h('th', null, h('span', { class: 'solo-lettori' }, 'Azioni')))),
        h('tbody', null, incassi.slice().sort((a, b) => (a.data < b.data ? -1 : 1)).map((i) => h('tr', null,
          h('td', { class: 'num' }, dataIt(i.data)), h('td', { class: 'num forte' }, eur(i.importo_cent)),
          h('td', { class: 'sottotesto' }, [i.pagante, i.metodo, i.note].filter(Boolean).join(' · ') || '—'),
          h('td', { class: 'num' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icona', 'aria-label': `Modifica l'incasso del ${dataIt(i.data)}`, onclick: () => modificaIncassoDialogo(i) }, icona('pencil', { dimensione: 15 })),
            h('button', { type: 'button', class: 'btn btn-pericolo-ghost btn-sm btn-icona', 'aria-label': `Elimina l'incasso del ${dataIt(i.data)}`, onclick: () => eliminaIncassoConferma(i, p) }, icona('trash-2', { dimensione: 15 }))))))))
        : h('p', { class: 'sottotesto', style: { marginTop: '8px' } }, 'Nessun incasso registrato.'));

    // ---- ripartizione e provvigioni
    let stimaBox = null;
    let vociMostrate = p.voci;
    let etichettaStima = null;
    if (!p.conclusa && !p.annullata && p.voci.some((v) => v.collaboratoreId != null)) {
      try {
        const s = stimaPratica(app.archivio, { ...p, id: p.id }, p.voci.filter((v) => v.collaboratoreId != null).map((v) => ({ collaboratore_id: v.collaboratoreId, percentuale: v.quotaPct })), opzioniCalcolo(impostazioni()));
        vociMostrate = s.pratica.voci;
        etichettaStima = `Stima: se la pratica si concludesse a ${meseAnno(s.mese)}`;
      } catch (e) { console.error(e); }
    }
    const conSegnoQuote = vociMostrate.length > 0;
    const cardRip = h('section', { class: 'card sezione-modulo intera', style: { padding: 0 } },
      h('div', { style: { padding: '20px 20px 0' } }, h('h2', { style: { fontSize: '16px', fontWeight: 700 } }, 'Ripartizione e provvigioni'),
        etichettaStima ? h('p', { class: 'sottotesto', style: { marginTop: '4px' } }, etichettaStima) : null),
      conSegnoQuote ? h('div', { class: 'tabella-wrap', style: { marginTop: '8px' } }, h('table', { class: 'tabella', id: 'tabella-provvigioni' },
        h('caption', { class: 'solo-lettori' }, 'Ripartizione tra collaboratori e provvigioni'),
        h('thead', null, h('tr', null, h('th', null, 'Collaboratore'), h('th', { class: 'num' }, 'Quota'), h('th', { class: 'num' }, 'Fatturato'), h('th', null, 'Scaglione'), h('th', { class: 'num' }, 'Provvigione'), h('th', { class: 'num' }, 'Maturata'), h('th', { class: 'num' }, 'Liquidata'), h('th', { class: 'num' }, 'Da liquidare'))),
        h('tbody', null, vociMostrate.map((v) => {
          const c = m.collaboratori.find((x) => x.id === v.collaboratoreId);
          return h('tr', null,
            h('td', { class: 'forte' }, c ? h('span', { class: 'chip-col' }, h('span', { class: `punto-col col-${c.colore}` }), c.nome) : h('span', { class: 'badge badge-warn' }, 'Non assegnata')),
            h('td', { class: 'num' }, v.fissa ? '—' : pct(v.quotaPct)), h('td', { class: 'num' }, v.fissa ? '—' : eur(v.fatturatoCent)),
            h('td', null, v.fissa ? h('span', { class: 'badge badge-info' }, `${pct(v.percentualeFissa)} del totale`) : v.scaglioneIdx >= 0 ? h('span', { class: 'badge badge-info' }, `${v.scaglioneIdx + 1}° · ${pct(Math.round(v.percentualeApplicata * 100) / 100)}`) : h('span', { class: 'sottotesto' }, p.conclusa ? 'non configurato' : '—')),
            h('td', { class: 'num' }, eur(v.provvigioneCent)), h('td', { class: 'num' }, eur(v.maturataCent)), h('td', { class: 'num' }, eur(v.liquidataCent)),
            h('td', { class: `num forte ${v.daLiquidareCent < 0 ? 'negativo' : ''}` }, eur(v.daLiquidareCent)));
        }))))
        : h('p', { class: 'sottotesto', style: { padding: '12px 20px 20px' } }, 'Nessuna ripartizione indicata. Apri “Modifica” per assegnare la pratica ai collaboratori.'));

    const dettaglioCalcolo = p.voci.some((v) => v.collaboratoreId != null) ? h('details', { class: 'card sezione-modulo intera', id: 'come-calcolato' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700, fontSize: '15px' } }, 'Come è stata calcolata la provvigione'),
      h('div', { style: { display: 'grid', gap: '18px', marginTop: '14px' } }, p.voci.filter((v) => v.collaboratoreId != null).map((v) => h('div', null,
        h('div', { class: 'forte', style: { marginBottom: '6px' } }, nomeDi(v.collaboratoreId)),
        h('ol', { class: 'passaggi-calcolo' }, passaggiCalcolo(m, p, v, nomeDi(v.collaboratoreId)).map((t, i) => h('li', { 'data-n': String(i + 1) }, t))))))) : null;

    const cardLiq = h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Liquidazioni collegate'),
      righeLiq.length ? h('div', { class: 'tabella-wrap', style: { marginTop: '8px' } }, h('table', { class: 'tabella tabella-compatta' },
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Collaboratore'), h('th', { class: 'num' }, 'Importo'), h('th', null, 'Metodo'))),
        h('tbody', null, righeLiq.map(({ l, r }) => h('tr', null, h('td', { class: 'num' }, dataIt(l.data)), h('td', null, l.collaboratoreNome), h('td', { class: 'num forte' }, eur(r.importo_cent)), h('td', { class: 'sottotesto' }, l.metodo ?? '—'))))))
        : h('p', { class: 'sottotesto', style: { marginTop: '8px' } }, 'Nessuna liquidazione registrata su questa pratica.'),
      h('p', { style: { marginTop: '10px' } }, h('a', { href: '#/provvigioni?tab=liquidazioni' }, 'Tutte le liquidazioni →')));

    monta(contenitore, testa, avvisoMancanti,
      h('div', { class: 'scheda-griglia' }, cardDati, cardCompensi, h('div', { class: 'intera' }, cardRip), dettaglioCalcolo, cardLiq));
    return {};
  },
};
