// Ripartizione di una zona: come si divide ogni pratica della zona tra i collaboratori.
// Si imposta una volta per zona e poi si applica in automatico a ogni nuova pratica.
import { h } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello } from '../core/app.js';
import { pct } from '../core/format.js';
import { apriModale, ok as notificaOk } from '../core/ui.js';
import { campoPercentuale } from './campi.js';
import { salvaRipartizioneZona, leggiRipartizioneZona } from '../data/repo/anagrafiche.js';

/** Una ripartizione a parole: «Luca 60% · Giuseppe 40%». Accetta quote del database o del modello. */
export function ripartizioneAParole(quote, collaboratori) {
  const nomi = new Map(collaboratori.map((c) => [c.id, c.nome]));
  return quote.map((q) => `${nomi.get(q.collaboratore_id ?? q.collaboratoreId) ?? 'Collaboratore'} ${pct(q.percentuale)}`).join(' · ');
}

/**
 * Editor della ripartizione: una quota in % per ogni collaboratore (vuota = non partecipa). Il totale deve fare 100%;
 * tutto vuoto significa «nessuna ripartizione propria».
 */
export function editorRipartizione({ collaboratori, quote = [], onCambio = null }) {
  const totale = h('div', { class: 'sottotesto forte', 'aria-live': 'polite' });
  const errore = h('div', { class: 'errore', role: 'alert', style: { marginTop: '6px' } });
  const campi = collaboratori.map((c) => {
    const q = quote.find((x) => (x.collaboratore_id ?? x.collaboratoreId) === c.id);
    const campo = campoPercentuale({ etichetta: c.nome, valore: q ? q.percentuale : null, onInput: () => { aggiorna(); onCambio?.(); } });
    campo.input.setAttribute('aria-label', `Quota di ${c.nome}`);
    return { c, campo };
  });
  const valori = () => campi.map(({ c, campo }) => ({ collaboratore_id: c.id, percentuale: campo.get() })).filter((x) => x.percentuale !== null && x.percentuale > 0);
  const sommaBp = () => valori().reduce((s, x) => s + Math.round(x.percentuale * 100), 0);

  function aggiorna() {
    errore.replaceChildren();
    const v = valori();
    const t = sommaBp() / 100;
    totale.textContent = v.length ? `Totale quote: ${pct(t)}` : 'Nessuna ripartizione propria: si userà quella predefinita.';
    totale.style.color = v.length && Math.abs(t - 100) > 0.005 ? 'var(--crit-text)' : '';
  }
  function imposta(nuove) {
    for (const { c, campo } of campi) campo.set(nuove.find((x) => x.collaboratore_id === c.id)?.percentuale ?? null);
    aggiorna();
    onCambio?.();
  }
  const preset = (etichetta, fn) => h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: fn }, etichetta);
  const attivi = collaboratori.filter((c) => c.attivo !== false);
  const scorciatoie = [
    ...attivi.slice(0, 4).map((c) => preset(`Tutto a ${c.nome}`, () => imposta([{ collaboratore_id: c.id, percentuale: 100 }]))),
    ...(attivi.length >= 2 ? [preset('Parti uguali', () => {
      const n = attivi.length;
      const base = Math.floor(10000 / n) / 100;
      imposta(attivi.map((c, i) => ({ collaboratore_id: c.id, percentuale: i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base })));
    })] : []),
    preset('Nessuna (usa la predefinita)', () => imposta([])),
  ];
  const el = h('div', null,
    h('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } }, ...campi.map((x) => x.campo.el)),
    h('div', { class: 'riga-azioni', style: { marginTop: '10px' } }, ...scorciatoie),
    h('div', { style: { marginTop: '10px' } }, totale, errore));
  aggiorna();

  return {
    el,
    get: valori,
    /** Messaggio se la ripartizione non si può salvare, altrimenti null. */
    problema() {
      const v = valori();
      if (v.length && sommaBp() !== 10000) return `Le quote sommano ${pct(sommaBp() / 100)}: devono fare 100%.`;
      return null;
    },
    mostraErrore(testo) { errore.replaceChildren(icona('circle-alert', { dimensione: 15 }), h('span', null, testo)); },
    imposta,
    primoCampo: () => campi[0]?.campo.input,
  };
}

/** Finestra per cambiare la ripartizione di una zona. `dopo` viene chiamata a salvataggio avvenuto. */
export function apriDialogoRipartizione(zona, { dopo = null } = {}) {
  const quote = leggiRipartizioneZona(app.archivio, zona.id);
  const collaboratori = modello().collaboratori.filter((c) => c.attivo || quote.some((q) => q.collaboratore_id === c.id));
  const editor = editorRipartizione({ collaboratori, quote });
  const m = apriModale({
    titolo: `Ripartizione della zona ${zona.nome}`, icona: 'handshake', larghezza: 560, invioConferma: true,
    descrizione: 'Come si divide ogni pratica di questa zona tra i collaboratori. Si applica da sola a ogni nuova pratica: nel modulo non c\'è nulla da scegliere.',
    contenuto: h('form', { id: 'form-ripartizione-zona', onsubmit: (e) => e.preventDefault() }, editor.el),
    azioni: [
      { id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' },
      { id: 'salva', etichetta: 'Salva la ripartizione', tipo: 'primario', icona: 'check', onClick: async () => {
        const problema = editor.problema();
        if (problema) { editor.mostraErrore(problema); return false; }
        const nuove = editor.get();
        await salvaRipartizioneZona(app.archivio, zona.id, nuove);
        notificaOk(nuove.length ? `Ripartizione della zona “${zona.nome}” salvata. Vale per le nuove pratiche.` : `La zona “${zona.nome}” userà la ripartizione predefinita.`);
        if (dopo) dopo();
      } },
    ],
  });
  editor.primoCampo()?.focus();
  return m;
}
