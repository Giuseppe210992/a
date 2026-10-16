// Disegna l'elenco degli avvisi (scheda della dashboard e menu della campanella).
import { h } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { naviga } from '../core/router.js';
import { ok as notificaOk, segnalaErrore } from '../core/ui.js';
import { avvisiNascosti } from './avvisi.js';

const ETICHETTA_LIVELLO = { critico: 'Urgente', avviso: 'Da controllare', info: 'Informazione' };
const ICONA_LIVELLO = { critico: 'circle-x', avviso: 'triangle-alert', info: 'info' };

export function disegnaAvvisi(lista, { compatto = false, alNascondi = null, dopoAzione = null } = {}) {
  const visibili = lista.filter((a) => !avvisiNascosti.ha(a));
  if (!visibili.length) {
    return h('div', { class: 'vuoto', style: { padding: compatto ? '20px 12px' : '28px 16px' } },
      icona('circle-check', { dimensione: 36 }),
      h('strong', null, 'Tutto in ordine'),
      h('p', null, 'Nessun avviso: dati completi, backup recente e archivio integro.'));
  }
  return h('ul', { class: `avvisi${compatto ? ' compatto' : ''}`, 'aria-label': 'Avvisi' }, visibili.map((a) => {
    let azione = null;
    if (a.azione?.href) {
      azione = h('a', { class: 'btn btn-secondario btn-sm', href: a.azione.href, onclick: () => dopoAzione?.() }, a.azione.etichetta);
    } else if (a.azione?.esegui) {
      azione = h('button', {
        type: 'button', class: 'btn btn-secondario btn-sm',
        onclick: async (ev) => {
          const b = ev.currentTarget;
          b.disabled = true;
          try { await a.azione.esegui(); notificaOk('Fatto.'); dopoAzione?.(); } catch (e) { segnalaErrore(e, 'Azione avviso'); } finally { b.disabled = false; }
        },
      }, a.azione.etichetta);
    }
    return h('li', { class: `avviso ${a.livello}` },
      h('span', { class: 'avviso-icona' }, icona(a.icona || ICONA_LIVELLO[a.livello], { dimensione: 20 })),
      h('div', { class: 'avviso-corpo' },
        h('div', { class: 'avviso-titolo' }, h('span', { class: 'solo-lettori' }, `${ETICHETTA_LIVELLO[a.livello]}: `), a.titolo),
        a.testo ? h('p', null, a.testo) : null,
        a.dettagli?.length ? h('ul', { class: 'avviso-dettagli' }, a.dettagli.map((d) => h('li', null, d))) : null,
        h('div', { class: 'riga-azioni', style: { marginTop: '8px' } },
          azione,
          alNascondi ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { avvisiNascosti.nascondi(a); alNascondi(); } }, 'Nascondi') : null),
      ),
    );
  }));
}
export { naviga };
