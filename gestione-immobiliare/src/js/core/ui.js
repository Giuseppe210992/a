// Elementi di interfaccia condivisi: notifiche, finestre di dialogo, conferme, menu.
import { h, svuota, $ } from './dom.js';
import { icona } from './icone.js';

// ------------------------------------------------------------ notifiche

let areaToast = null;

function assicuraArea() {
  if (!areaToast || !document.body.contains(areaToast)) {
    areaToast = h('div', { class: 'toast-area no-stampa', role: 'region', 'aria-label': 'Notifiche', 'aria-live': 'polite' });
    document.body.append(areaToast);
  }
  return areaToast;
}

const ICONE_TOAST = { successo: 'circle-check', errore: 'circle-x', avviso: 'triangle-alert', info: 'info' };

/**
 * Mostra una notifica non invasiva.
 * tipo: 'successo' | 'errore' | 'avviso' | 'info'
 */
export function notifica({ tipo = 'info', titolo = null, testo, azione = null, durata = null }) {
  const area = assicuraArea();
  const ms = durata ?? (tipo === 'errore' ? 9000 : azione ? 8000 : 4500);
  let timer = null;
  const chiudi = () => { clearTimeout(timer); el.remove(); };
  const el = h('div', { class: `toast ${tipo}`, role: tipo === 'errore' ? 'alert' : 'status' },
    icona(ICONE_TOAST[tipo], { dimensione: 20 }),
    h('div', { class: 'toast-testo' },
      titolo ? h('strong', null, titolo) : null,
      testo,
      azione ? h('div', { style: { marginTop: '6px' } }, h('button', { class: 'toast-azione', type: 'button', onclick: () => { chiudi(); azione.onClick(); } }, azione.etichetta)) : null,
    ),
    h('button', { class: 'toast-chiudi', type: 'button', 'aria-label': 'Chiudi notifica', onclick: chiudi }, icona('x', { dimensione: 16 })),
  );
  area.append(el);
  while (area.children.length > 4) area.firstChild.remove();
  const avvia = () => { timer = setTimeout(chiudi, ms); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', avvia);
  avvia();
  return { chiudi };
}

export const ok = (testo, extra = {}) => notifica({ tipo: 'successo', testo, ...extra });
export const errore = (testo, extra = {}) => notifica({ tipo: 'errore', testo, ...extra });
export const info = (testo, extra = {}) => notifica({ tipo: 'info', testo, ...extra });
export const avviso = (testo, extra = {}) => notifica({ tipo: 'avviso', testo, ...extra });

// ------------------------------------------------------------ finestre di dialogo

/**
 * Apre una finestra modale (elemento <dialog> nativo: blocca lo sfondo, gestisce Esc e il focus).
 * azioni: [{ etichetta, tipo: 'primario'|'secondario'|'pericolo', onClick: async () => (false per non chiudere), id }]
 * Restituisce { chiudi, el, corpo, risultato: Promise<id dell'azione o null> }.
 */
export function apriModale({ titolo, descrizione = null, icona: nomeIcona = null, tonoIcona = 'info', contenuto = null, azioni = [], larghezza = 560, chiudibile = true, alChiudere = null }) {
  const precedente = document.activeElement;
  let risolvi;
  const risultato = new Promise((r) => { risolvi = r; });
  let chiusa = false;

  const corpo = h('div', { class: 'modale-corpo' }, contenuto);
  const piede = h('div', { class: 'modale-piede' });
  const dlg = h('dialog', { class: 'modale', style: { '--larghezza': `${larghezza}px` }, 'aria-labelledby': 'modale-titolo' },
    h('div', { class: 'modale-testa' },
      h('div', { class: 'con-icona' },
        nomeIcona ? h('span', { class: `modale-icona ${tonoIcona}` }, icona(nomeIcona, { dimensione: 22 })) : null,
        h('div', null, h('h2', { id: 'modale-titolo' }, titolo), descrizione ? h('p', null, descrizione) : null),
      ),
      chiudibile ? h('button', { class: 'btn btn-ghost btn-icona btn-sm', type: 'button', 'aria-label': 'Chiudi', onclick: () => chiudi(null) }, icona('x', { dimensione: 18 })) : null,
    ),
    corpo,
    azioni.length ? piede : null,
  );

  function chiudi(esito = null) {
    if (chiusa) return;
    chiusa = true;
    if (dlg.open) dlg.close();
    dlg.remove();
    if (precedente && precedente.focus && document.contains(precedente)) precedente.focus();
    if (alChiudere) alChiudere(esito);
    risolvi(esito);
  }

  for (const a of azioni) {
    const btn = h('button', {
      type: 'button',
      class: `btn ${a.tipo === 'primario' ? 'btn-primario' : a.tipo === 'pericolo' ? 'btn-pericolo' : 'btn-secondario'}`,
      dataset: { azione: a.id ?? '' },
      onclick: async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          const r = a.onClick ? await a.onClick(dlg) : undefined;
          if (r === false) return;
          chiudi(a.id ?? true);
        } catch (e) {
          console.error(e);
          errore(e && e.message ? e.message : 'Operazione non riuscita.');
        } finally {
          btn.disabled = false;
        }
      },
    }, a.icona ? icona(a.icona, { dimensione: 16 }) : null, a.etichetta);
    piede.append(btn);
  }

  // Il cursore resta dentro la finestra: dall'ultimo elemento Tab torna al primo, e viceversa con Maiusc+Tab.
  dlg.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const raggiungibili = [...dlg.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]')]
      .filter((e) => !e.disabled && e.tabIndex >= 0 && e.offsetParent !== null);
    if (!raggiungibili.length) return;
    const primo = raggiungibili[0];
    const ultimo = raggiungibili[raggiungibili.length - 1];
    if (ev.shiftKey && (document.activeElement === primo || !dlg.contains(document.activeElement))) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && (document.activeElement === ultimo || !dlg.contains(document.activeElement))) { ev.preventDefault(); primo.focus(); }
  });
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); if (chiudibile) chiudi(null); });
  dlg.addEventListener('click', (ev) => {
    if (chiudibile && ev.target === dlg) chiudi(null); // clic sullo sfondo
  });
  document.body.append(dlg);
  dlg.showModal();
  // Il focus va al primo campo, oppure all'azione primaria.
  const primo = dlg.querySelector('input:not([type=hidden]), select, textarea');
  (primo || dlg.querySelector('.btn-primario, .btn-pericolo') || dlg.querySelector('button'))?.focus();
  return { chiudi, el: dlg, corpo, risultato };
}

/**
 * Chiede conferma prima di un'operazione importante. Restituisce true/false.
 * Con `frase`, l'utente deve scrivere la parola indicata (per operazioni irreversibili).
 */
export function conferma({ titolo, messaggio, dettagli = [], etichettaConferma = 'Conferma', etichettaAnnulla = 'Annulla', tipo = 'pericolo', frase = null, icona: nomeIcona = null }) {
  const corpo = h('div', null,
    messaggio ? h('p', null, messaggio) : null,
    dettagli.length ? h('ul', { class: 'lista-dettagli' }, dettagli.map((d) => h('li', null, d))) : null,
  );
  let campo = null;
  let bottone = null;
  if (frase) {
    campo = h('input', { class: 'input', type: 'text', autocomplete: 'off', 'aria-label': `Scrivi ${frase} per confermare`, placeholder: frase, style: { marginTop: '14px' } });
    corpo.append(h('p', { style: { marginTop: '14px' } }, 'Per confermare scrivi ', h('strong', null, frase), ':'), campo);
  }
  const m = apriModale({
    titolo,
    icona: nomeIcona ?? (tipo === 'pericolo' ? 'triangle-alert' : 'circle-help'),
    tonoIcona: tipo === 'pericolo' ? 'pericolo' : 'info',
    contenuto: corpo,
    azioni: [
      { id: 'annulla', etichetta: etichettaAnnulla, tipo: 'secondario' },
      { id: 'conferma', etichetta: etichettaConferma, tipo: tipo === 'pericolo' ? 'pericolo' : 'primario' },
    ],
  });
  if (frase) {
    // Il pulsante resta disattivato finche' non si scrive la parola richiesta.
    bottone = m.el.querySelector('[data-azione="conferma"]');
    bottone.disabled = true;
    campo.addEventListener('input', () => { bottone.disabled = campo.value.trim().toUpperCase() !== frase.toUpperCase(); });
    campo.focus();
  } else {
    // Il focus iniziale va su "Annulla": un Invio distratto non conferma un'eliminazione.
    m.el.querySelector('[data-azione="annulla"]')?.focus();
  }
  return m.risultato.then((r) => r === 'conferma');
}

/** Finestra con solo un messaggio e "Ok". */
export function messaggio({ titolo, testo, tono = 'info', icona: nomeIcona = 'info', dettagli = [] }) {
  return apriModale({
    titolo, icona: nomeIcona, tonoIcona: tono,
    contenuto: h('div', null, testo ? h('p', null, testo) : null, dettagli.length ? h('ul', { class: 'lista-dettagli' }, dettagli.map((d) => h('li', null, d))) : null),
    azioni: [{ id: 'ok', etichetta: 'Ok', tipo: 'primario' }],
  }).risultato;
}

// ------------------------------------------------------------ menu a comparsa

/**
 * Collega a un pulsante un menu di voci: [{ etichetta, icona, onClick, pericolo }]
 * Restituisce l'elemento contenitore da inserire nella pagina.
 */
export function menuAzioni(pulsante, voci) {
  const wrap = h('span', { class: 'popover-wrap' }, pulsante);
  let aperto = null;
  const chiudi = () => {
    if (!aperto) return;
    aperto.remove();
    aperto = null;
    pulsante.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', fuori, true);
    document.removeEventListener('keydown', tasti, true);
  };
  const fuori = (ev) => { if (aperto && !aperto.contains(ev.target) && !pulsante.contains(ev.target)) chiudi(); };
  const tasti = (ev) => {
    if (ev.key === 'Escape') { chiudi(); pulsante.focus(); }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const bs = [...aperto.querySelectorAll('button.voce')];
      const i = bs.indexOf(document.activeElement);
      bs[(i + (ev.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  };
  pulsante.setAttribute('aria-haspopup', 'menu');
  pulsante.setAttribute('aria-expanded', 'false');
  pulsante.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (aperto) { chiudi(); return; }
    aperto = h('div', { class: 'popover', role: 'menu', style: { right: '0', top: 'calc(100% + 6px)' } },
      voci.map((v) => (v === '-' ? h('hr') : h('button', {
        class: `voce${v.pericolo ? ' pericolo' : ''}`, type: 'button', role: 'menuitem',
        onclick: (e) => { e.stopPropagation(); chiudi(); v.onClick(); },
      }, v.icona ? icona(v.icona, { dimensione: 17 }) : null, v.etichetta))),
    );
    wrap.append(aperto);
    pulsante.setAttribute('aria-expanded', 'true');
    aperto.querySelector('button.voce')?.focus();
    document.addEventListener('click', fuori, true);
    document.addEventListener('keydown', tasti, true);
  });
  return wrap;
}

/** Messaggio di errore leggibile da un'eccezione. */
export function testoErrore(e) {
  if (!e) return 'Operazione non riuscita.';
  if (e.campi && Object.keys(e.campi).length) return Object.values(e.campi)[0];
  return e.message || 'Operazione non riuscita.';
}

/** Mostra l'errore all'utente e lo registra in console per la diagnosi. */
export function segnalaErrore(e, contesto = null) {
  console.error(contesto || 'Errore', e);
  errore(testoErrore(e));
}

export { svuota, $ };

// ------------------------------------------------------------ popover ancorato

/**
 * Apre un pannello ancorato a un elemento (posizione fissa, non viene tagliato dai contenitori).
 * Si chiude con Esc, clic fuori o chiudi(). Restituisce { chiudi, el }.
 */
export function apriPopover(ancora, contenuto, { allinea = 'inizio', larghezzaMin = 280, alChiudere = null } = {}) {
  const el = h('div', { class: 'popover', role: 'dialog', style: { position: 'fixed', minWidth: `${larghezzaMin}px`, maxWidth: 'min(94vw, 460px)' } }, contenuto);
  document.body.append(el);
  const posiziona = () => {
    const r = ancora.getBoundingClientRect();
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    let left = allinea === 'fine' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  posiziona();
  let chiuso = false;
  const chiudi = () => {
    if (chiuso) return;
    chiuso = true;
    el.remove();
    document.removeEventListener('mousedown', fuori, true);
    document.removeEventListener('keydown', tasti, true);
    window.removeEventListener('resize', chiudi);
    ancora.setAttribute?.('aria-expanded', 'false');
    if (alChiudere) alChiudere();
  };
  const fuori = (ev) => { if (!el.contains(ev.target) && !ancora.contains(ev.target)) chiudi(); };
  const tasti = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); chiudi(); ancora.focus?.(); } };
  document.addEventListener('mousedown', fuori, true);
  document.addEventListener('keydown', tasti, true);
  window.addEventListener('resize', chiudi);
  ancora.setAttribute?.('aria-expanded', 'true');
  return { chiudi, el, riposiziona: posiziona };
}
