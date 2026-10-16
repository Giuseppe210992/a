// Ricerca rapida (barra in alto): pratiche per codice, indirizzo, comune, zona, venditore, acquirente, note.
import { h, evidenzia, ritarda } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { modello } from '../core/app.js';
import { naviga } from '../core/router.js';
import { normalizza, dataIt } from '../core/format.js';
import { ETICHETTA_STATO } from '../data/repo/pratiche.js';

const CAMPI = [
  ['codice', 'Codice', (p) => p.codice],
  ['immobile_indirizzo', 'Immobile', (p) => p.immobile_indirizzo],
  ['immobile_comune', 'Comune', (p) => p.immobile_comune],
  ['venditore', 'Venditore', (p) => p.venditore],
  ['acquirente', 'Acquirente', (p) => p.acquirente],
  ['zona', 'Zona', (p) => p.zonaNome],
  ['immobile_tipo', 'Tipo', (p) => p.immobile_tipo],
  ['note', 'Note', (p) => p.note],
];

/** Cerca nelle pratiche. Ogni parola scritta deve comparire in almeno un campo. */
export function cercaPratiche(testo, limite = 8) {
  const termini = normalizza(testo).split(/\s+/).filter(Boolean);
  if (!termini.length) return { risultati: [], totale: 0, termini };
  const out = [];
  for (const p of modello().pratiche) {
    const valori = CAMPI.map(([chiave, etichetta, f]) => ({ chiave, etichetta, testo: f(p) ?? '', norm: normalizza(f(p) ?? '') }));
    const tutti = termini.every((t) => valori.some((v) => v.norm.includes(t)));
    if (!tutti) continue;
    const esatto = valori[0].norm === termini.join(' ') ? 1 : 0;
    const trovato = valori.find((v) => v.chiave !== 'codice' && v.chiave !== 'immobile_indirizzo' && termini.some((t) => v.norm.includes(t)));
    out.push({ p, peso: esatto, trovato });
  }
  out.sort((a, b) => b.peso - a.peso || (b.p.dataRif > a.p.dataRif ? 1 : b.p.dataRif < a.p.dataRif ? -1 : b.p.id - a.p.id));
  return { risultati: out.slice(0, limite), totale: out.length, termini };
}

export function creaRicerca() {
  const input = h('input', {
    type: 'search', id: 'ricerca-rapida', class: 'input', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Cerca pratiche, clienti o immobili…', 'aria-label': 'Ricerca rapida di pratiche, clienti o immobili',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'ricerca-risultati', 'aria-autocomplete': 'list',
  });
  const lista = h('div', { class: 'risultati-ricerca', id: 'ricerca-risultati', role: 'listbox', hidden: true });
  const el = h('div', { class: 'ricerca', role: 'search' },
    icona('search', { dimensione: 18, classe: 'lente' }), input, h('kbd', { 'aria-hidden': 'true' }, '/'), lista);

  let voci = [];
  let sel = -1;
  let testoCorrente = '';
  let totaleTrovate = 0; // quante pratiche corrispondono (anche oltre le prime mostrate)
  let disegnaRitardato = { annulla() {} };

  const chiudi = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; };
  const apri = () => { lista.hidden = false; input.setAttribute('aria-expanded', 'true'); };

  function evidenziaSelezione() {
    [...lista.querySelectorAll('.ris-voce')].forEach((b, i) => b.setAttribute('aria-selected', String(i === sel)));
    const b = lista.querySelectorAll('.ris-voce')[sel];
    if (b) b.scrollIntoView({ block: 'nearest' });
  }

  // Dopo aver scelto un risultato la barra torna vuota e pronta per la ricerca successiva.
  function concludi() {
    disegnaRitardato.annulla();
    input.value = '';
    chiudi();
    input.blur();
  }

  function vaiAPratica(p) {
    concludi();
    naviga(`#/pratiche/${p.id}`);
  }

  function vaiArchivio(q) {
    concludi();
    naviga(`#/pratiche?q=${encodeURIComponent(q)}`);
  }

  function disegna() {
    const q = input.value.trim();
    testoCorrente = q;
    lista.replaceChildren();
    voci = [];
    totaleTrovate = 0;
    let intestazione = null;
    let elenco;
    let totale;
    let termini = [];
    if (!q) {
      const recenti = modello().pratiche.slice().sort((a, b) => (b.aggiornato_il > a.aggiornato_il ? 1 : -1)).slice(0, 5);
      elenco = recenti.map((p) => ({ p, trovato: null }));
      totale = recenti.length;
      intestazione = recenti.length ? 'Pratiche recenti' : null;
    } else {
      const r = cercaPratiche(q);
      elenco = r.risultati;
      totale = r.totale;
      termini = r.termini;
      intestazione = totale ? `${totale} ${totale === 1 ? 'pratica trovata' : 'pratiche trovate'}` : null;
    }
    totaleTrovate = totale;
    if (!elenco.length) {
      lista.append(h('div', { class: 'ris-piede', style: { border: 0, margin: 0 } }, q ? `Nessun risultato per “${q}”. Prova con il codice, una via, il nome di un cliente o una zona.` : 'Non ci sono ancora pratiche. Premi “+ Nuova pratica” per inserire la prima.'));
      apri();
      return;
    }
    if (intestazione) lista.append(h('div', { class: 'ris-piede', style: { border: 0, margin: '0 0 2px', padding: '6px 10px' } }, intestazione));
    elenco.forEach(({ p, trovato }) => {
      const sotto = [p.immobile_comune, p.zonaNome, ETICHETTA_STATO[p.stato], dataIt(p.dataRif)].filter(Boolean).join(' · ');
      const b = h('button', { type: 'button', class: 'ris-voce', role: 'option', 'aria-selected': 'false', onclick: () => vaiAPratica(p) },
        icona('file-plus', { dimensione: 18 }),
        h('span', { class: 'ris-testo' },
          h('span', { class: 'ris-principale' }, ...evidenzia(`${p.codice} — ${p.immobile_indirizzo}`, termini)),
          h('span', { class: 'ris-secondario' }, sotto),
          trovato ? h('span', { class: 'ris-secondario' }, `${trovato.etichetta}: `, ...evidenzia(trovato.testo, termini)) : null,
        ),
      );
      voci.push({ b, p });
      lista.append(b);
    });
    if (q && totale > elenco.length) {
      lista.append(h('div', { class: 'ris-piede' }, `Mostrati ${elenco.length} su ${totale}. Premi Invio per vederli tutti nell'archivio.`));
    } else if (q) {
      lista.append(h('div', { class: 'ris-piede' }, 'Invio apre la prima pratica · Maiusc+Invio la cerca nell\'archivio.'));
    }
    apri();
  }

  disegnaRitardato = ritarda(disegna, 90);
  input.addEventListener('input', disegnaRitardato);
  input.addEventListener('focus', () => { disegna(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (lista.hidden) disegna(); sel = Math.min(sel + 1, voci.length - 1); evidenziaSelezione(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(sel - 1, 0); evidenziaSelezione(); }
    else if (ev.key === 'Escape') { disegnaRitardato.annulla(); if (!lista.hidden) { ev.preventDefault(); chiudi(); } else input.blur(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      disegnaRitardato.annulla();
      if (input.value.trim() !== testoCorrente) disegna();
      if (ev.shiftKey && input.value.trim()) { vaiArchivio(input.value.trim()); return; }
      if (sel >= 0 && voci[sel]) vaiAPratica(voci[sel].p);
      // come promette il suggerimento sotto l'elenco: se tutti i risultati sono visibili Invio apre il primo, altrimenti li mostra tutti nell'archivio
      else if (voci.length && input.value.trim() && totaleTrovate <= voci.length) vaiAPratica(voci[0].p);
      else if (input.value.trim()) vaiArchivio(input.value.trim());
    }
  });
  document.addEventListener('mousedown', (ev) => { if (!el.contains(ev.target)) chiudi(); });

  function metti(testo) { input.focus(); input.value = testo ?? ''; disegna(); }
  return { el, input, chiudi, metti, aggiorna: () => { if (!lista.hidden) disegna(); } };
}
