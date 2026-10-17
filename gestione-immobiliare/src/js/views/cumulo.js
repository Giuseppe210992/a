// Cumulo mensile per zona: fatturato cumulato di ciascun collaboratore, scaglione e percentuale raggiunti.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto, impostazioni } from '../core/app.js';
import { chiaveMese, oggi, aggiungiMesi, mesiTra } from '../core/dates.js';
import { eur, eurInt, eurCompatto, pct, meseAnno, meseBreve, dataIt, maiuscola, nomiMesi } from '../core/format.js';
import { cumuloDelMese } from '../data/calc/aggregati.js';
import { leggiPref, scriviPref } from '../core/preferenze.js';

const ETICHETTA_METODO = { raggiunto: 'scaglione raggiunto (la percentuale vale su tutto il cumulo)', progressivo: 'progressivo (ogni percentuale vale solo sulla sua fascia)' };
const ETICHETTA_BASE = { collaboratore_zona: 'per collaboratore e zona', zona: 'per zona (somma dei collaboratori)', collaboratore: 'per collaboratore (somma delle zone)' };

function scalaScaglioni(cu) {
  const t = cu.tabella;
  if (!t.length) return h('div', { class: 'nota attenzione' }, icona('triangle-alert', { dimensione: 18 }), h('span', null, 'Gli scaglioni non sono impostati.'), h('a', { href: '#/impostazioni?sezione=scaglioni' }, 'Imposta gli scaglioni'));
  const ultima = t[t.length - 1].da;
  const max = Math.max(ultima * 1.35, cu.fatturatoCent * 1.1, (t[1] ? t[1].da : 100000) * 1.4);
  const pos = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  const fasce = t.map((s, i) => {
    const fine = t[i + 1] ? t[i + 1].da : max;
    return h('div', { class: `scala-fascia${cu.scaglioneIdx === i ? ' raggiunta' : ''}`, style: { left: `${pos(s.da)}%`, width: `${pos(fine) - pos(s.da)}%` } });
  });
  const tacche = t.map((s, i) => h('div', { class: `scala-tacca${i === 0 ? ' primo' : ''}`, style: { left: `${pos(s.da)}%` } },
    h('span', { class: 'soglia' }, i === 0 ? '0 €' : eurCompatto(s.da) + ' €'), h('span', { class: 'perc' }, pct(s.percentuale))));
  const fine = pos(Math.min(cu.fatturatoCent, max));
  return h('div', { class: 'scala', role: 'img', 'aria-label': `Cumulo ${eur(cu.fatturatoCent)}, scaglione ${cu.scaglioneIdx + 1} su ${t.length}` },
    h('div', { class: 'scala-traccia' }, ...fasce),
    h('div', { class: 'scala-riempi', style: { width: `${fine}%` } }),
    ...tacche,
    h('div', { class: `scala-valore${fine > 82 ? ' destra' : ''}`, style: { left: `${fine}%` } }, eurInt(cu.fatturatoCent)));
}

function rigaVuota(m, cu) {
  const col = cu.collaboratoreId != null ? m.collaboratori.find((c) => c.id === cu.collaboratoreId)?.colore : 0;
  const chi = cu.collaboratoreNome ?? 'Tutti i collaboratori';
  return h('div', { class: 'cumulo-riga cumulo-vuota', dataset: { chiave: cu.chiave } },
    h('div', { class: 'cumulo-testa' },
      h('div', { class: 'cumulo-chi' }, h('span', { class: `punto-col col-${col ?? 0}`, style: { width: '12px', height: '12px' } }), chi, h('span', { class: 'sottotesto', style: { fontWeight: 500 } }, 'nessun fatturato nel mese')),
      cu.prossimo ? h('span', { class: 'sottotesto' }, `1° scaglione ${pct(cu.percentuale)} · il ${cu.prossimo.indice + 1}° parte da ${eur(cu.prossimo.da)}`) : (cu.scaglione ? h('span', { class: 'sottotesto' }, `1° scaglione ${pct(cu.percentuale)}`) : h('span', { class: 'badge badge-warn' }, 'Scaglioni non impostati'))));
}

function rigaCumulo(m, cu) {
  if (cu.fatturatoCent === 0 && !cu.voci.length) return rigaVuota(m, cu);
  const praticheDelMese = [...new Set(cu.voci.map((v) => v.praticaId))].map((id) => m.perId.get(id)).filter(Boolean);
  const chi = cu.collaboratoreNome ?? (m.opzioni.baseCumulo === 'zona' ? 'Tutti i collaboratori' : 'Non assegnato');
  const col = cu.collaboratoreId != null ? m.collaboratori.find((c) => c.id === cu.collaboratoreId)?.colore : 0;
  return h('div', { class: 'cumulo-riga', dataset: { chiave: cu.chiave } },
    h('div', { class: 'cumulo-testa' },
      h('div', { class: 'cumulo-chi' }, h('span', { class: `punto-col col-${col ?? 0}`, style: { width: '12px', height: '12px' } }), chi),
      cu.scaglione ? h('span', { class: 'badge badge-info', style: { height: '28px', fontSize: '13.5px' } }, `${cu.scaglioneIdx + 1}° scaglione · ${pct(cu.percentuale)}`) : h('span', { class: 'badge badge-warn' }, 'Scaglioni non impostati')),
    h('div', { class: 'cumulo-numeri' },
      h('div', { class: 'n' }, h('span', null, 'Fatturato cumulato'), h('b', null, eur(cu.fatturatoCent))),
      h('div', { class: 'n' }, h('span', null, m.opzioni.metodo === 'progressivo' ? 'Percentuale media' : 'Percentuale raggiunta'), h('b', null, pct(Math.round(cu.percentuale * 100) / 100))),
      h('div', { class: 'n' }, h('span', null, 'Provvigione sul mese'), h('b', null, eur(cu.provvigioneCent))),
      h('div', { class: 'n' }, h('span', null, 'Prossimo scaglione'), h('b', null, cu.prossimo ? `${eur(cu.prossimo.mancanteCent)}` : cu.scaglione ? 'Raggiunto il massimo' : '—')),
    ),
    scalaScaglioni(cu),
    cu.prossimo ? h('p', { class: 'sottotesto' }, `Mancano ${eur(cu.prossimo.mancanteCent)} per passare al ${cu.prossimo.indice + 1}° scaglione (${pct(cu.prossimo.percentuale)}), che parte da ${eur(cu.prossimo.da)}.`) : (cu.scaglione ? h('p', { class: 'sottotesto' }, 'È stato raggiunto l\'ultimo scaglione.') : null),
    praticheDelMese.length ? h('details', null, h('summary', { style: { cursor: 'pointer', fontWeight: 650, fontSize: '13.5px' } }, `Pratiche che compongono il cumulo (${praticheDelMese.length})`),
      h('div', { class: 'tabella-wrap', style: { marginTop: '8px' } }, h('table', { class: 'tabella tabella-compatta' },
        h('thead', null, h('tr', null, h('th', null, 'Pratica'), h('th', null, 'Rogito'), h('th', null, 'Zona'), h('th', { class: 'num' }, 'Fatturato attribuito'), h('th', { class: 'num' }, 'Provvigione'))),
        h('tbody', null, cu.voci.map((v) => {
          const p = m.perId.get(v.praticaId);
          return h('tr', null, h('td', null, h('a', { href: `#/pratiche/${p.id}`, class: 'forte', style: { color: 'var(--text)' } }, p.codice), h('span', { class: 'sottotesto' }, p.descrizione)),
            h('td', { class: 'num' }, dataIt(p.dataRif)), h('td', null, p.zonaNome ?? '—'), h('td', { class: 'num' }, eur(v.fatturatoCent)), h('td', { class: 'num forte' }, eur(v.provvigioneCent)));
        }))))) : null);
}

function matriceAnnuale(m, anno, filtri, meseSel) {
  const mesi = Array.from({ length: 12 }, (_, i) => `${anno}-${String(i + 1).padStart(2, '0')}`);
  const struttura = cumuloDelMese(m, meseSel, filtri);
  const righe = struttura.flatMap((g) => g.righe.map((r) => ({ zonaId: r.zonaId, collabId: r.collaboratoreId, etichetta: [g.zonaNome !== 'Tutte le zone' ? (r.zonaNome ?? g.zonaNome) : null, r.collaboratoreNome].filter(Boolean).join(' · ') || 'Cumulo' })));
  const indice = new Map(m.cumuli.map((c) => [c.chiave, c]));
  const ntier = Math.max(1, m.tabellaPredefinita.length, ...[...m.tabellePerZona.values()].map((t) => t.length));
  const tinta = (idx, tot) => `t${Math.min(5, tot <= 5 ? idx + 1 : Math.round(1 + (idx / Math.max(1, tot - 1)) * 4))}`;
  return h('div', { class: 'tabella-wrap' }, h('table', { class: 'matrice', id: 'matrice-cumulo' },
    h('caption', { class: 'solo-lettori' }, `Fatturato cumulato mese per mese, ${anno}`),
    h('thead', null, h('tr', null, h('th', { class: 'riga', scope: 'col' }, ''), ...mesi.map((k) => h('th', { scope: 'col', class: k === meseSel ? 'attuale-th' : '' }, maiuscola(meseBreve(k).split(' ')[0]))))),
    h('tbody', null, righe.map((r) => h('tr', null, h('th', { class: 'riga', scope: 'row' }, r.etichetta),
      ...mesi.map((k) => {
        const c = indice.get(`${k}|z${r.zonaId ?? 0}|c${r.collabId ?? 0}`);
        if (!c || c.fatturatoCent <= 0) return h('td', { title: `${meseAnno(k)}: nessun fatturato` }, '—');
        const tot = c.tabella.length || ntier;
        return h('td', { class: `${tinta(Math.max(0, c.scaglioneIdx), tot)}${k === meseSel ? ' attuale' : ''}`, title: `${meseAnno(k)}: ${eur(c.fatturatoCent)} · ${c.scaglione ? `${c.scaglioneIdx + 1}° scaglione, ${pct(c.percentuale)}` : 'scaglioni non impostati'}` },
          h('b', null, eurCompatto(c.fatturatoCent)), h('small', null, c.scaglione ? `${c.scaglioneIdx + 1}° · ${pct(Math.round(c.percentuale * 10) / 10)}` : ''));
      }))))));
}

export const cumulo = {
  id: 'cumulo', titolo: 'Cumulo mensile per zona',
  filtri: { periodo: false, zona: true, collaboratore: true, granularita: false },
  monta(contenitore, params, query) {
    const oggiMese = chiaveMese(oggi());
    let mese = /^\d{4}-\d{2}$/.test(query.mese || '') ? query.mese : (leggiPref('cumuloMese', null) || oggiMese);
    const corpo = h('div', null);
    const etichetta = h('span', { id: 'cumulo-mese' });
    const selMese = h('select', { class: 'select', 'aria-label': 'Mese', style: { width: '150px', height: '38px' }, onchange: () => imposta(`${selAnno.value}-${selMese.value}`) },
      nomiMesi.map((n, i) => h('option', { value: String(i + 1).padStart(2, '0') }, maiuscola(n))));
    const selAnno = h('select', { class: 'select', 'aria-label': 'Anno', style: { width: '100px', height: '38px' }, onchange: () => imposta(`${selAnno.value}-${selMese.value}`) });
    const vai = (delta) => imposta(aggiungiMesi(mese, delta));
    function imposta(k) { mese = k; scriviPref('cumuloMese', k); history.replaceState(null, '', `#/cumulo?mese=${k}`); disegna(); }
    const btnOggi = h('button', { type: 'button', class: 'btn btn-secondario', onclick: () => imposta(oggiMese) }, 'Mese corrente');

    function disegna() {
      const m = modello();
      const ctx = contesto();
      etichetta.textContent = maiuscola(meseAnno(mese));
      btnOggi.disabled = mese === oggiMese;
      const annoOggi = +oggiMese.slice(0, 4);
      const anniMenu = [];
      for (let a = annoOggi + 1; a >= Math.min(annoOggi - 6, +mese.slice(0, 4)); a--) anniMenu.push(a);
      if (!anniMenu.includes(+mese.slice(0, 4))) anniMenu.push(+mese.slice(0, 4));
      selAnno.replaceChildren(...anniMenu.sort((x, y) => y - x).map((a) => h('option', { value: String(a) }, String(a))));
      selAnno.value = mese.slice(0, 4);
      selMese.value = mese.slice(5, 7);
      const gruppi = cumuloDelMese(m, mese, { zonaId: ctx.zonaId, collaboratoreId: ctx.collaboratoreId });
      const info = h('div', { class: 'nota', style: { marginBottom: '16px' } }, icona('info', { dimensione: 18 }),
        h('span', null, 'Il cumulo somma i compensi (imponibile) delle pratiche concluse nel mese, ', h('b', null, ETICHETTA_BASE[m.opzioni.baseCumulo]), '. Metodo: ', h('b', null, ETICHETTA_METODO[m.opzioni.metodo]), '. ', h('a', { href: '#/impostazioni?sezione=calcolo' }, 'Cambia nelle impostazioni')));
      let blocchi;
      if (!gruppi.length || gruppi.every((g) => !g.righe.length)) {
        blocchi = [h('div', { class: 'card' }, h('div', { class: 'vuoto' }, icona('layers', { dimensione: 40 }), h('strong', null, 'Nessuna zona o collaboratore da mostrare'),
          h('p', null, m.zone.length ? 'Cambia i filtri di zona e collaboratore.' : 'Aggiungi le zone da Impostazioni: il cumulo viene calcolato per ciascuna.'), h('a', { class: 'btn btn-primario', href: '#/impostazioni?sezione=zone' }, 'Vai alle impostazioni')))];
      } else {
        blocchi = gruppi.map((g) => {
          const totF = g.righe.reduce((s, r) => s + r.fatturatoCent, 0);
          const totP = g.righe.reduce((s, r) => s + r.provvigioneCent, 0);
          return h('section', { class: 'card zona-card', dataset: { zona: g.zonaId ?? 0 }, 'aria-label': `Zona ${g.zonaNome}` },
            h('div', { class: 'card-testa', style: { paddingBottom: '12px' } },
              h('div', null, h('h2', null, g.zonaNome), h('p', null, `${g.righe.length} ${g.righe.length === 1 ? 'riga' : 'righe'} · fatturato ${eur(totF)} · provvigioni ${eur(totP)}`))),
            ...g.righe.map((r) => rigaCumulo(m, r)));
        });
      }
      const anno = +mese.slice(0, 4);
      const matrice = h('section', { class: 'card card-corpo', style: { marginTop: '20px' }, 'aria-labelledby': 'matrice-titolo' },
        h('h2', { id: 'matrice-titolo', style: { fontSize: '16px', fontWeight: 700 } }, `Andamento del ${anno}, mese per mese`),
        h('p', { class: 'sottotesto', style: { margin: '2px 0 12px' } }, 'Il colore indica lo scaglione raggiunto in ciascun mese; sotto la cifra del cumulo compaiono scaglione e percentuale.'),
        matriceAnnuale(m, anno, { zonaId: ctx.zonaId, collaboratoreId: ctx.collaboratoreId }, mese),
        h('div', { class: 'legenda-tinte' }, h('span', null, 'Scaglione:'), ...[1, 2, 3, 4, 5].map((n) => h('span', null, h('span', { class: `q`, style: { background: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#1c5cab'][n - 1] } }), n === 5 ? '5° o più' : `${n}°`))));
      monta(corpo, info, ...blocchi, matrice);
    }

    monta(contenitore,
      h('div', { class: 'pagina-testa' },
        h('div', null, h('h1', null, 'Cumulo mensile per zona'), h('p', null, 'Il fatturato cumulato di ogni collaboratore, lo scaglione raggiunto e quanto manca al successivo.')),
        h('div', { class: 'pagina-azioni' },
          h('div', { class: 'mese-nav' },
            h('button', { type: 'button', class: 'btn btn-secondario btn-icona', 'aria-label': 'Mese precedente', id: 'mese-prec', onclick: () => vai(-1) }, icona('chevron-left', { dimensione: 18 })),
            selMese, selAnno,
            h('button', { type: 'button', class: 'btn btn-secondario btn-icona', 'aria-label': 'Mese successivo', id: 'mese-succ', onclick: () => vai(1) }, icona('chevron-right', { dimensione: 18 })),
            h('span', { class: 'solo-lettori', 'aria-live': 'polite' }, etichetta)),
          btnOggi)),
      corpo);
    disegna();
    return { aggiorna: disegna };
  },
};
export { mesiTra };
