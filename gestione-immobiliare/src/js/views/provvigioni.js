// Provvigioni e liquidazioni: quote, importi maturati, pagati e ancora da liquidare; elenco di liquidazioni e incassi.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto } from '../core/app.js';
import { naviga } from '../core/router.js';
import { eur, eurInt, pct, dataIt, num } from '../core/format.js';
import { apriModale, conferma, ok as notificaOk, segnalaErrore } from '../core/ui.js';
import { campoData, campoSelezione, campoTesto, mostraErrori } from '../components/campi.js';
import { modificaLiquidazione, eliminaLiquidazione, eliminaIncasso, METODI_PAGAMENTO } from '../data/repo/pratiche.js';
import { perCollaboratore, concluseNelContesto, vociDi } from '../data/calc/aggregati.js';
import { csvProvvigioni, csvLiquidazioni, csvIncassi, codificaTesto, nomeFile } from '../data/esporta.js';
import { apriDialogoIncasso, apriDialogoLiquidazione } from '../components/dialoghi.js';

const TABS = [['riepilogo', 'Riepilogo'], ['dettaglio', 'Dettaglio per pratica'], ['liquidazioni', 'Liquidazioni'], ['incassi', 'Incassi']];
const nelPeriodoData = (iso, ctx) => iso >= ctx.periodo.da && iso <= ctx.periodo.a;

function badgePagamento(v, p) {
  if (!p.conclusa) return h('span', { class: 'badge badge-corso' }, 'Anticipo');
  if (v.maturataCent <= 0) return h('span', { class: 'badge' }, 'Nulla da pagare');
  if (v.daLiquidareCent <= 0 && v.liquidataCent > v.maturataCent) return h('span', { class: 'badge badge-warn' }, 'Oltre il dovuto');
  if (v.daLiquidareCent <= 0) return h('span', { class: 'badge badge-ok' }, icona('check', { dimensione: 13 }), 'Liquidata');
  if (v.liquidataCent > 0) return h('span', { class: 'badge badge-warn' }, 'Parziale');
  return h('span', { class: 'badge badge-serio' }, 'Da liquidare');
}

function modificaLiquidazioneDialogo(l) {
  const data = campoData({ etichetta: 'Data del pagamento', valore: l.data, obbligatorio: true });
  const metodo = campoSelezione({ etichetta: 'Metodo', valore: l.metodo ?? '', vuoto: 'Non indicato', opzioni: METODI_PAGAMENTO.map((x) => ({ valore: x, etichetta: x })) });
  const note = campoTesto({ etichetta: 'Note', valore: l.note ?? '', maxlength: 300 });
  return apriModale({
    titolo: `Modifica la liquidazione a ${l.collaboratoreNome}`, descrizione: 'Gli importi per pratica non si modificano: per cambiarli elimina la liquidazione e registrala di nuovo.', invioConferma: true, icona: 'pencil', larghezza: 520,
    contenuto: h('form', { onsubmit: (e) => e.preventDefault() }, h('div', { class: 'griglia-campi' }, h('div', { class: 'c-6' }, data.el), h('div', { class: 'c-6' }, metodo.el), h('div', { class: 'c-12' }, note.el))),
    azioni: [{ id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' }, { id: 'salva', etichetta: 'Salva', tipo: 'primario', onClick: async () => {
      try { await modificaLiquidazione(app.archivio, l.id, { data: data.get(), metodo: metodo.get(), note: note.get() }); notificaOk('Liquidazione aggiornata.'); } catch (e) {
        if (e.campi) { mostraErrori({ data }, e.campi); return false; }
        throw e;
      }
    } }],
  });
}

async function eliminaLiquidazioneConferma(l) {
  const sì = await conferma({
    titolo: 'Eliminare questa liquidazione?', messaggio: `Stai per eliminare il pagamento di ${eur(l.totaleCent)} a ${l.collaboratoreNome} del ${dataIt(l.data)}.`,
    dettagli: [`${l.righe.length} ${l.righe.length === 1 ? 'pratica tornerà' : 'pratiche torneranno'} “da liquidare” per questi importi.`, 'L\'operazione non si può annullare.'],
    etichettaConferma: 'Elimina liquidazione', tipo: 'pericolo',
  });
  if (!sì) return;
  try { await eliminaLiquidazione(app.archivio, l.id); notificaOk('Liquidazione eliminata.'); } catch (e) { segnalaErrore(e, 'Eliminazione liquidazione'); }
}

async function eliminaIncassoDaElenco(i) {
  const sì = await conferma({
    titolo: 'Eliminare questo incasso?', messaggio: `Stai per eliminare l'incasso di ${eur(i.importo_cent)} del ${dataIt(i.data)}${i.pratica ? ` sulla pratica ${i.pratica.codice}` : ''}.`,
    dettagli: ['Gli importi incassati e da incassare verranno ricalcolati.', 'L\'operazione non si può annullare.'], etichettaConferma: 'Elimina incasso', tipo: 'pericolo',
  });
  if (!sì) return;
  try { await eliminaIncasso(app.archivio, i.id); notificaOk('Incasso eliminato.'); } catch (e) { segnalaErrore(e, 'Eliminazione incasso'); }
}

export const provvigioni = {
  id: 'provvigioni', titolo: 'Provvigioni e liquidazioni',
  filtri: { zona: true, collaboratore: true, granularita: false },
  monta(contenitore, params, query) {
    let tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'riepilogo';
    let soloDaLiquidare = query.solo === 'da-liquidare';
    const contenuto = h('div', { class: 'tab-contenuto' });
    const linguette = h('div', { class: 'linguette', role: 'tablist', 'aria-label': 'Sezioni' });
    const intestazioneAzioni = h('div', { class: 'pagina-azioni' });

    const aggiornaUrl = () => history.replaceState(null, '', `#/provvigioni${tab !== 'riepilogo' ? `?tab=${tab}${soloDaLiquidare ? '&solo=da-liquidare' : ''}` : ''}`);

    function disegnaLinguette() {
      const m = modello();
      const ctx = contesto();
      const conteggi = {
        liquidazioni: m.liquidazioni.filter((l) => nelPeriodoData(l.data, ctx) && (ctx.collaboratoreId == null || l.collaboratore_id === ctx.collaboratoreId)).length,
        incassi: m.incassi.filter((i) => nelPeriodoData(i.data, ctx)).length + (m.pagamenti || []).filter((x) => nelPeriodoData(x.data, ctx)).length,
      };
      linguette.replaceChildren(...TABS.map(([k, e]) => h('button', {
        type: 'button', role: 'tab', id: `tab-${k}`, 'aria-selected': String(tab === k), 'aria-controls': 'pannello-prov',
        onclick: () => { tab = k; aggiornaUrl(); disegna(); },
      }, e, conteggi[k] !== undefined ? h('span', { class: 'conteggio' }, String(conteggi[k])) : null)));
    }

    function riepilogoTab(m, ctx) {
      const righe = perCollaboratore(m, ctx);
      const totale = righe.reduce((a, r) => ({ fatt: a.fatt + r.fatturatoCent, mat: a.mat + r.maturateCent, liq: a.liq + r.liquidateCent, dal: a.dal + r.daLiquidareCent }), { fatt: 0, mat: 0, liq: 0, dal: 0 });
      if (!righe.length) return h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('users', { dimensione: 40 }), h('strong', null, 'Nessun collaboratore'), h('p', null, 'Aggiungi i collaboratori da Impostazioni per calcolare le provvigioni.'), h('a', { class: 'btn btn-primario', href: '#/impostazioni?sezione=collaboratori' }, 'Vai alle impostazioni')));
      const blocchi = righe.map((r) => {
        const mc = m.collaboratori.find((c) => c.id === r.id);
        const quota = r.maturateCent > 0 ? Math.max(0, Math.min(100, (r.liquidateCent / r.maturateCent) * 100)) : 0;
        return h('article', { class: 'card card-corpo carta-collab', dataset: { collab: r.id } },
          h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between' } },
            h('h3', { style: { fontSize: '17px', fontWeight: 720, display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { class: `punto-col col-${r.colore}`, style: { width: '12px', height: '12px' } }), r.nome),
            h('span', { class: 'sottotesto' }, `${num(r.pratiche)} ${r.pratiche === 1 ? 'pratica' : 'pratiche'} nel periodo`)),
          h('div', { class: 'cumulo-numeri', style: { marginTop: '14px' } },
            h('div', { class: 'n' }, h('span', null, 'Fatturato attribuito'), h('b', null, eur(r.fatturatoCent))),
            h('div', { class: 'n' }, h('span', null, 'Provvigioni maturate'), h('b', null, eur(r.maturateCent))),
            h('div', { class: 'n' }, h('span', null, 'Già liquidate'), h('b', null, eur(r.liquidateCent))),
            h('div', { class: 'n' }, h('span', null, 'Ancora da liquidare'), h('b', { style: { color: r.daLiquidareCent > 0 ? 'var(--serious-text)' : r.daLiquidareCent < 0 ? 'var(--crit-text)' : 'var(--ok-text)' } }, eur(r.daLiquidareCent)))),
          r.maturateCent > 0 ? h('div', { class: 'meter', style: { marginTop: '14px' }, role: 'img', 'aria-label': `Liquidato il ${Math.round(quota)}%` }, h('i', { style: { width: `${quota}%` } })) : null,
          r.daLiquidareCent < 0 ? h('p', { class: 'sottotesto', style: { marginTop: '8px', color: 'var(--crit-text)' } }, 'Residuo negativo: sono stati liquidati importi superiori ai maturati (anticipi o pratiche modificate).') : null,
          mc && mc.daLiquidareCent !== r.daLiquidareCent ? h('p', { class: 'sottotesto', style: { marginTop: '8px' } }, `In totale, su tutto lo storico, restano da liquidare ${eur(mc.daLiquidareCent)}.`) : null,
          h('div', { class: 'riga-azioni', style: { marginTop: '14px' } },
            h('button', { type: 'button', class: 'btn btn-primario btn-sm', onclick: () => apriDialogoLiquidazione({ collaboratoreId: r.id }) }, icona('hand-coins', { dimensione: 16 }), 'Registra liquidazione'),
            h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => { tab = 'dettaglio'; aggiornaUrl(); disegna(); } }, 'Vedi il dettaglio')));
      });
      return h('div', null,
        h('div', { class: 'kpi-contenitore', style: { marginBottom: '16px' } }, h('div', { class: 'kpi-griglia', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-etichetta' }, 'Fatturato attribuito'), h('div', { class: 'kpi-valore' }, eurInt(totale.fatt)), h('div', { class: 'kpi-nota' }, ctx.periodo.etichetta)),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-etichetta' }, 'Provvigioni maturate'), h('div', { class: 'kpi-valore' }, eurInt(totale.mat))),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-etichetta' }, 'Già liquidate'), h('div', { class: 'kpi-valore' }, eurInt(totale.liq))),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-etichetta' }, 'Ancora da liquidare'), h('div', { class: 'kpi-valore' }, eurInt(totale.dal))))),
        h('h2', { class: 'solo-lettori' }, 'Riepilogo per collaboratore'),
        h('div', { class: 'griglia-2' }, ...blocchi));
    }

    function vociSelezionate(m, ctx) {
      const concl = concluseNelContesto(m, ctx);
      const anticipi = m.pratiche.filter((p) => p.inCorso && (ctx.zonaId == null || p.zona_id === ctx.zonaId) && p.voci.some((v) => v.liquidataCent > 0 && (ctx.collaboratoreId == null || v.collaboratoreId === ctx.collaboratoreId)));
      const out = [];
      for (const p of [...concl, ...anticipi]) for (const v of vociDi(p, ctx)) if (v.collaboratoreId != null) out.push({ p, v });
      return out.sort((a, b) => (a.p.dataRif < b.p.dataRif ? 1 : a.p.dataRif > b.p.dataRif ? -1 : b.p.id - a.p.id));
    }

    function dettaglioTab(m, ctx) {
      let voci = vociSelezionate(m, ctx);
      const tutte = voci.length;
      if (soloDaLiquidare) voci = voci.filter(({ v }) => v.daLiquidareCent > 0);
      const nomi = new Map(m.collaboratori.map((c) => [c.id, c]));
      const chk = h('input', { type: 'checkbox', id: 'solo-dal', checked: soloDaLiquidare, onchange: (e) => { soloDaLiquidare = e.target.checked; aggiornaUrl(); disegna(); } });
      const barra = h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between', marginBottom: '12px' } },
        h('label', { class: 'check', for: 'solo-dal' }, chk, 'Solo quelle ancora da liquidare'),
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => {
          const r = await app.driver.esportaFile(codificaTesto(csvProvvigioni(m, voci)), nomeFile('Provvigioni', 'csv'), 'text/csv;charset=utf-8');
          if (r && r.salvato !== false) notificaOk('Provvigioni esportate in CSV.');
        } }, icona('download', { dimensione: 15 }), 'Esporta in CSV'));
      if (!voci.length) return h('div', null, barra, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('hand-coins', { dimensione: 40 }), h('strong', null, tutte ? 'Nulla da liquidare' : 'Nessuna provvigione nel periodo'), h('p', null, tutte ? 'Tutte le provvigioni del periodo risultano liquidate.' : 'Cambia periodo o filtri, oppure inserisci e concludi delle pratiche.'))));
      const tot = voci.reduce((a, { v }) => ({ f: a.f + v.fatturatoCent, p: a.p + v.provvigioneCent, m: a.m + v.maturataCent, l: a.l + v.liquidataCent, d: a.d + v.daLiquidareCent }), { f: 0, p: 0, m: 0, l: 0, d: 0 });
      return h('div', null, barra, h('div', { class: 'card' }, h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella', id: 'tabella-dettaglio' },
        h('caption', { class: 'solo-lettori' }, 'Provvigioni per pratica e collaboratore'),
        h('thead', null, h('tr', null, h('th', null, 'Pratica'), h('th', null, 'Collaboratore'), h('th', { class: 'num' }, 'Quota'), h('th', { class: 'num' }, 'Fatturato'), h('th', null, 'Scaglione'), h('th', { class: 'num' }, 'Provvigione'), h('th', { class: 'num' }, 'Liquidata'), h('th', { class: 'num' }, 'Da liquidare'), h('th', null, 'Stato'))),
        h('tbody', null, voci.map(({ p, v }) => h('tr', { class: 'cliccabile', onclick: (ev) => { if (!ev.target.closest('a')) naviga(`#/pratiche/${p.id}`); } },
          h('td', null, h('a', { href: `#/pratiche/${p.id}`, class: 'forte', style: { color: 'var(--text)' } }, p.codice), h('span', { class: 'sottotesto' }, `${p.descrizione} · ${p.dataEtichetta}`)),
          h('td', null, h('span', { class: 'chip-col' }, h('span', { class: `punto-col col-${nomi.get(v.collaboratoreId)?.colore ?? 0}` }), nomi.get(v.collaboratoreId)?.nome ?? '?')),
          h('td', { class: 'num' }, pct(v.quotaPct)), h('td', { class: 'num' }, eur(v.fatturatoCent)),
          h('td', null, v.scaglioneIdx >= 0 && p.conclusa ? h('span', { class: 'badge badge-info' }, `${v.scaglioneIdx + 1}° · ${pct(Math.round(v.percentualeApplicata * 100) / 100)}`) : h('span', { class: 'sottotesto' }, '—')),
          h('td', { class: 'num' }, eur(v.provvigioneCent)), h('td', { class: 'num' }, eur(v.liquidataCent)),
          h('td', { class: `num forte ${v.daLiquidareCent < 0 ? 'negativo' : ''}` }, eur(v.daLiquidareCent)), h('td', null, badgePagamento(v, p))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, `Totale (${voci.length} righe)`), h('td', { class: 'num' }, eur(tot.f)), h('td'), h('td', { class: 'num' }, eur(tot.p)), h('td', { class: 'num' }, eur(tot.l)), h('td', { class: 'num' }, eur(tot.d)), h('td')))))));
    }

    function liquidazioniTab(m, ctx) {
      const elenco = m.liquidazioni.filter((l) => nelPeriodoData(l.data, ctx) && (ctx.collaboratoreId == null || l.collaboratore_id === ctx.collaboratoreId)).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.id - a.id));
      const barra = h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between', marginBottom: '12px' } },
        h('span', { class: 'sottotesto' }, `${elenco.length} ${elenco.length === 1 ? 'liquidazione' : 'liquidazioni'} · ${eur(elenco.reduce((s, l) => s + l.totaleCent, 0))} nel periodo`),
        h('span', { class: 'riga-azioni' },
          h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => { const r = await app.driver.esportaFile(codificaTesto(csvLiquidazioni(m)), nomeFile('Liquidazioni', 'csv'), 'text/csv;charset=utf-8'); if (r && r.salvato !== false) notificaOk('Liquidazioni esportate in CSV.'); } }, icona('download', { dimensione: 15 }), 'Esporta in CSV'),
          h('button', { type: 'button', class: 'btn btn-primario btn-sm', id: 'btn-nuova-liq', onclick: () => apriDialogoLiquidazione() }, icona('plus', { dimensione: 16 }), 'Registra liquidazione')));
      if (!elenco.length) return h('div', null, barra, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('hand-coins', { dimensione: 40 }), h('strong', null, 'Nessuna liquidazione nel periodo'), h('p', null, 'Quando paghi le provvigioni a un collaboratore registrale qui: la dashboard si aggiorna da sola.'))));
      return h('div', null, barra, h('div', { class: 'card' }, h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella', id: 'tabella-liquidazioni' },
        h('caption', { class: 'solo-lettori' }, 'Liquidazioni registrate'),
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Collaboratore'), h('th', null, 'Pratiche'), h('th', { class: 'num' }, 'Importo'), h('th', null, 'Metodo e note'), h('th', null, h('span', { class: 'solo-lettori' }, 'Azioni')))),
        h('tbody', null, elenco.map((l) => h('tr', null,
          h('td', { class: 'num' }, dataIt(l.data)), h('td', { class: 'forte' }, l.collaboratoreNome),
          h('td', null, h('details', null, h('summary', { style: { cursor: 'pointer' } }, `${l.righe.length} ${l.righe.length === 1 ? 'pratica' : 'pratiche'}`),
            h('ul', { style: { marginTop: '6px', display: 'grid', gap: '2px' } }, l.righe.map((r) => h('li', { class: 'sottotesto' }, h('a', { href: `#/pratiche/${r.pratica_id}` }, r.pratica?.codice ?? '?'), ` — ${eur(r.importo_cent)}`))))),
          h('td', { class: 'num forte' }, eur(l.totaleCent)), h('td', { class: 'sottotesto' }, [l.metodo, l.note].filter(Boolean).join(' · ') || '—'),
          h('td', { class: 'num' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icona', 'aria-label': `Modifica la liquidazione del ${dataIt(l.data)}`, onclick: () => modificaLiquidazioneDialogo(l) }, icona('pencil', { dimensione: 15 })),
            h('button', { type: 'button', class: 'btn btn-pericolo-ghost btn-sm btn-icona', 'aria-label': `Elimina la liquidazione del ${dataIt(l.data)}`, onclick: () => eliminaLiquidazioneConferma(l) }, icona('trash-2', { dimensione: 15 }))))))))));
    }

    function incassiTab(m, ctx) {
      // incassi registrati + pagamenti fatti dalle parti alla conclusione (questi si cambiano dal modulo della pratica)
      const daConclusione = (m.pagamenti || []).map((x) => ({ id: null, daConclusione: true, data: x.data, pratica: x.pratica, pratica_id: x.praticaId, importo_cent: x.importo_cent, pagante: x.parte, metodo: x.modalita, note: x.conIva ? 'Pagato alla conclusione (IVA compresa)' : 'Pagato alla conclusione (già senza IVA)' }));
      const elenco = [...m.incassi, ...daConclusione].filter((i) => nelPeriodoData(i.data, ctx) && i.pratica && (ctx.zonaId == null || i.pratica.zona_id === ctx.zonaId) && (ctx.collaboratoreId == null || i.pratica.voci.some((v) => v.collaboratoreId === ctx.collaboratoreId)))
        .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.id ?? 0) - (a.id ?? 0)));
      const barra = h('div', { class: 'riga-azioni', style: { justifyContent: 'space-between', marginBottom: '12px' } },
        h('span', { class: 'sottotesto' }, `${elenco.length} ${elenco.length === 1 ? 'incasso' : 'incassi'} · ${eur(elenco.reduce((s, i) => s + i.importo_cent, 0))} nel periodo ${elenco.some((i) => i.daConclusione) ? '(IVA inclusa)' : '(IVA inclusa)'}`),
        h('span', { class: 'riga-azioni' },
          h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => { const r = await app.driver.esportaFile(codificaTesto(csvIncassi(m)), nomeFile('Incassi', 'csv'), 'text/csv;charset=utf-8'); if (r && r.salvato !== false) notificaOk('Incassi esportati in CSV.'); } }, icona('download', { dimensione: 15 }), 'Esporta in CSV'),
          h('button', { type: 'button', class: 'btn btn-primario btn-sm', id: 'btn-nuovo-incasso', onclick: () => apriDialogoIncasso() }, icona('plus', { dimensione: 16 }), 'Registra incasso')));
      if (!elenco.length) return h('div', null, barra, h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('banknote', { dimensione: 40 }), h('strong', null, 'Nessun incasso nel periodo'), h('p', null, 'Registra qui i pagamenti ricevuti dai clienti per i compensi.'))));
      return h('div', null, barra, h('div', { class: 'card' }, h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella', id: 'tabella-incassi' },
        h('caption', { class: 'solo-lettori' }, 'Incassi registrati'),
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Pratica'), h('th', { class: 'num' }, 'Importo'), h('th', null, 'Pagante e metodo'), h('th', null, h('span', { class: 'solo-lettori' }, 'Azioni')))),
        h('tbody', null, elenco.map((i) => h('tr', null,
          h('td', { class: 'num' }, dataIt(i.data)),
          h('td', null, h('a', { href: `#/pratiche/${i.pratica_id}`, class: 'forte', style: { color: 'var(--text)' } }, i.pratica.codice), h('span', { class: 'sottotesto' }, i.pratica.descrizione)),
          h('td', { class: 'num forte' }, eur(i.importo_cent)), h('td', { class: 'sottotesto' }, [i.pagante, i.metodo, i.note].filter(Boolean).join(' · ') || '—'),
          h('td', { class: 'num' }, i.daConclusione
            ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/pratiche/${i.pratica_id}/modifica`, 'aria-label': `Modifica la pratica ${i.pratica.codice} per cambiare i pagamenti` }, icona('pencil', { dimensione: 15 }), 'Pratica')
            : h('button', { type: 'button', class: 'btn btn-pericolo-ghost btn-sm btn-icona', 'aria-label': `Elimina l'incasso del ${dataIt(i.data)}`, onclick: () => eliminaIncassoDaElenco(i) }, icona('trash-2', { dimensione: 15 }))))))))));
    }

    function disegna() {
      const m = modello();
      const ctx = contesto();
      disegnaLinguette();
      intestazioneAzioni.replaceChildren(
        h('button', { type: 'button', class: 'btn btn-secondario', id: 'btn-incasso-prov', onclick: () => apriDialogoIncasso() }, icona('banknote', { dimensione: 16 }), 'Registra incasso'),
        h('button', { type: 'button', class: 'btn btn-primario', id: 'btn-liquidazione-prov', onclick: () => apriDialogoLiquidazione() }, icona('hand-coins', { dimensione: 16 }), 'Registra liquidazione'));
      const f = { riepilogo: riepilogoTab, dettaglio: dettaglioTab, liquidazioni: liquidazioniTab, incassi: incassiTab }[tab];
      monta(contenuto, f(m, ctx));
    }

    monta(contenitore,
      h('div', { class: 'pagina-testa' },
        h('div', null, h('h1', null, 'Provvigioni e liquidazioni'), h('p', null, 'Quote, importi maturati, pagati e ancora da liquidare. I numeri seguono il periodo, la zona e il collaboratore scelti sopra.')),
        intestazioneAzioni),
      linguette,
      h('div', { id: 'pannello-prov', role: 'tabpanel' }, contenuto));
    disegna();
    if (query.registra === 'liquidazione') { setTimeout(() => apriDialogoLiquidazione(), 50); history.replaceState(null, '', '#/provvigioni'); }
    return { aggiorna: disegna };
  },
};
