// Struttura permanente dell'applicazione: barra laterale fissa, intestazione, barra dei filtri
// e area in cui le schermate vengono mostrate.
import { h } from './core/dom.js';
import { icona } from './core/icone.js';
import { app, contesto, modello } from './core/app.js';
import { naviga } from './core/router.js';
import { dataEstesa, maiuscola } from './core/format.js';
import { oggi } from './core/dates.js';
import { leggiPref, scriviPref } from './core/preferenze.js';
import { apriPopover, notifica, ok as notificaOk, segnalaErrore } from './core/ui.js';
import { creaRicerca } from './components/ricerca.js';
import { creaBarraFiltri, apriSelettorePeriodo } from './components/filtri.js';
import { calcolaAvvisi, avvisiNascosti } from './components/avvisi.js';
import { disegnaAvvisi } from './components/lista-avvisi.js';
import { esportaArchivio } from './data/backup.js';

export const VOCI_MENU = [
  { id: 'dashboard', href: '#/', etichetta: 'Dashboard', icona: 'layout-dashboard', attiva: (p) => p === '/' },
  { id: 'nuova', href: '#/nuova', etichetta: 'Nuova pratica', icona: 'file-plus', attiva: (p) => p === '/nuova' },
  { id: 'pratiche', href: '#/pratiche', etichetta: 'Archivio pratiche', icona: 'archive', attiva: (p) => p.startsWith('/pratiche') },
  { id: 'provvigioni', href: '#/provvigioni', etichetta: 'Provvigioni e liquidazioni', icona: 'hand-coins', attiva: (p) => p.startsWith('/provvigioni') },
  { id: 'cumulo', href: '#/cumulo', etichetta: 'Cumulo mensile per zona', icona: 'layers', attiva: (p) => p.startsWith('/cumulo') },
  { id: 'statistiche', href: '#/statistiche', etichetta: 'Statistiche e grafici', icona: 'chart-column', attiva: (p) => p.startsWith('/statistiche') },
  { id: 'backup', href: '#/backup', etichetta: 'Backup e archivio storico', icona: 'database-backup', attiva: (p) => p.startsWith('/backup') },
  { id: 'impostazioni', href: '#/impostazioni', etichetta: 'Impostazioni', icona: 'settings', attiva: (p) => p.startsWith('/impostazioni') },
];

export function costruisciShell(radice) {
  let prefSidebar = leggiPref('sidebar', 'estesa'); // 'estesa' | 'ridotta' (solo schermi larghi)
  let overlayAperto = false;
  let layout = 'desktop';
  const body = document.body;

  // ---------------------------------------------------------------- barra laterale
  const tooltip = h('div', { class: 'tooltip-nav no-stampa', role: 'presentation', hidden: true });
  const voci = VOCI_MENU.map((v) => {
    const a = h('a', { class: 'nav-voce', href: v.href, 'aria-label': v.etichetta, dataset: { id: v.id, etichetta: v.etichetta } },
      icona(v.icona, { dimensione: 22 }),
      h('span', { class: 'nav-testo' }, v.etichetta),
      h('span', { class: 'nav-badge', hidden: true }));
    const mostra = () => {
      if (body.dataset.sidebar !== 'ridotta') return;
      const r = a.getBoundingClientRect();
      tooltip.textContent = v.etichetta;
      tooltip.style.left = `${r.right + 12}px`;
      tooltip.style.top = `${r.top + r.height / 2}px`;
      tooltip.hidden = false;
    };
    const nascondi = () => { tooltip.hidden = true; };
    a.addEventListener('mouseenter', mostra);
    a.addEventListener('focus', mostra);
    a.addEventListener('mouseleave', nascondi);
    a.addEventListener('blur', nascondi);
    a.addEventListener('click', () => { chiudiMenuMobile(); nascondi(); });
    return { def: v, a, badge: a.querySelector('.nav-badge') };
  });

  const puntoStato = h('span', { class: 'sb-punto', 'data-stato': 'salvato' });
  const testoStato = h('span', { class: 'sb-stato-testo' }, 'Dati salvati');
  const btnRiduci = h('button', { type: 'button', class: 'sb-riduci', 'aria-expanded': 'true', 'aria-controls': 'barra-laterale' });
  const icoRiduci = h('span', { class: 'sb-ico' });
  const testoRiduci = h('span', { class: 'sb-riduci-testo' }, 'Riduci barra');
  btnRiduci.append(icoRiduci, testoRiduci);

  const sidebar = h('aside', { class: 'sidebar no-stampa', id: 'barra-laterale', 'aria-label': 'Menu principale' },
    h('a', { class: 'sb-marchio', href: '#/', 'aria-label': 'Gestione Immobiliare, vai alla dashboard' },
      h('span', { class: 'sb-logo' }, icona('house', { dimensione: 22 })),
      h('span', { class: 'sb-nome' }, 'Gestione', h('br'), 'Immobiliare', h('small', null, 'Gestionale compravendite'))),
    h('nav', { class: 'sb-nav', 'aria-label': 'Sezioni' }, voci.map((v) => v.a)),
    h('div', { class: 'sb-piede' },
      h('div', { class: 'sb-stato', role: 'status', 'aria-live': 'polite' }, puntoStato, testoStato),
      btnRiduci),
  );
  const scrim = h('div', { class: 'scrim', onclick: () => { chiudiMenuMobile(); chiudiOverlay(); } });

  // Menu a scorrimento del telefono: apertura, chiusura e stato per gli screen reader
  function impostaMenuMobile(aperto, { focus = false } = {}) {
    if (aperto) body.dataset.menu = 'aperto'; else body.removeAttribute('data-menu');
    btnMenu.setAttribute('aria-expanded', String(aperto));
    btnMenu.setAttribute('aria-label', aperto ? 'Chiudi il menu' : 'Apri il menu');
    if (aperto) setTimeout(() => voci[0]?.a.focus(), 30); // la tastiera parte dalla prima voce
    else if (focus) btnMenu.focus();
  }
  function chiudiMenuMobile() { if (body.dataset.menu) impostaMenuMobile(false); }
  function chiudiOverlay() { if (overlayAperto) { overlayAperto = false; applicaLayout(); } }

  function applicaLayout() {
    const w = window.innerWidth;
    layout = w >= 1100 ? 'desktop' : w >= 760 ? 'compatto' : 'mobile';
    body.dataset.layout = layout;
    if (layout === 'desktop') body.dataset.sidebar = prefSidebar;
    else if (layout === 'compatto') body.dataset.sidebar = overlayAperto ? 'estesa' : 'ridotta';
    else { body.dataset.sidebar = 'estesa'; overlayAperto = false; }
    if (layout !== 'mobile') chiudiMenuMobile();
    const ridotta = body.dataset.sidebar === 'ridotta';
    icoRiduci.replaceChildren(icona(ridotta ? 'panel-left-open' : 'panel-left-close', { dimensione: 22 }));
    testoRiduci.textContent = ridotta ? 'Espandi barra' : 'Riduci barra';
    btnRiduci.setAttribute('aria-expanded', String(!ridotta));
    btnRiduci.setAttribute('aria-label', ridotta ? 'Espandi la barra laterale' : 'Riduci la barra laterale');
    tooltip.hidden = true;
  }
  btnRiduci.addEventListener('click', () => {
    if (layout === 'desktop') { prefSidebar = prefSidebar === 'estesa' ? 'ridotta' : 'estesa'; scriviPref('sidebar', prefSidebar); }
    else if (layout === 'compatto') overlayAperto = !overlayAperto;
    applicaLayout();
  });
  window.addEventListener('resize', applicaLayout);

  // ---------------------------------------------------------------- intestazione
  const btnMenu = h('button', { type: 'button', class: 'btn btn-ghost btn-icona btn-menu', 'aria-label': 'Apri il menu', 'aria-controls': 'barra-laterale', 'aria-expanded': 'false',
    onclick: () => impostaMenuMobile(body.dataset.menu !== 'aperto') }, icona('menu', { dimensione: 22 }));
  const elData = h('span', { class: 'tb-data' });
  const titolo = h('div', { class: 'tb-titolo' }, h('strong', null, 'Gestione Immobiliare'), elData);
  const chipPeriodoTesto = h('span', { class: 'chip-periodo-testo' });
  const chipPeriodo = h('button', { type: 'button', class: 'tb-periodo', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Periodo di riferimento: cambia',
    onclick: () => apriSelettorePeriodo(chipPeriodo) }, icona('calendar', { dimensione: 16 }), h('small', null, 'Periodo'), chipPeriodoTesto);
  const ricerca = creaRicerca();

  const btnNuova = h('a', { class: 'btn btn-primario', href: '#/nuova', id: 'btn-nuova-pratica', 'aria-label': 'Nuova pratica' }, icona('plus', { dimensione: 18 }), h('span', { class: 'btn-testo' }, 'Nuova pratica'));
  const contaCampanella = h('span', { class: 'campanella-n', hidden: true });
  const btnCampanella = h('button', { type: 'button', class: 'btn btn-secondario btn-icona', 'aria-label': 'Avvisi', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: apriCampanella }, icona('bell', { dimensione: 19 }), contaCampanella);
  const btnTema = h('button', { type: 'button', class: 'btn btn-secondario btn-icona', onclick: cambiaTema });
  const topbar = h('header', { class: 'topbar no-stampa' }, btnMenu, titolo, chipPeriodo, ricerca.el, h('div', { class: 'tb-azioni' }, btnNuova, btnCampanella, btnTema));

  function temaEffettivo() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function aggiornaBottoneTema() {
    const scuro = temaEffettivo() === 'dark';
    btnTema.replaceChildren(icona(scuro ? 'sun' : 'moon', { dimensione: 19 }));
    btnTema.setAttribute('aria-label', scuro ? 'Passa al tema chiaro' : 'Passa al tema scuro');
    btnTema.title = scuro ? 'Passa al tema chiaro' : 'Passa al tema scuro';
  }
  function cambiaTema() {
    const nuovo = temaEffettivo() === 'dark' ? 'light' : 'dark';
    applicaTema(nuovo);
  }
  aggiornaBottoneTema();

  // ---------------------------------------------------------------- filtri, banner e area vista
  const barraFiltri = creaBarraFiltri();
  const banner = h('div', { class: 'banner-errore no-stampa', role: 'alert', hidden: true });
  const vista = h('main', { class: 'contenuto', id: 'contenuto', tabindex: '-1', 'aria-live': 'polite' });
  const principale = h('div', { class: 'principale' }, topbar, banner, barraFiltri.el, vista);

  radice.className = '';
  const saltaAlContenuto = h('button', { type: 'button', class: 'salta-contenuto', onclick: () => vista.focus() }, 'Salta al contenuto');
  radice.replaceChildren(saltaAlContenuto, h('div', { class: 'app' }, h('div', { class: 'sb-slot' }, sidebar), principale), scrim, tooltip);

  // ---------------------------------------------------------------- salvataggio
  function mostraStatoSalvataggio(st) {
    puntoStato.dataset.stato = st.stato === 'errore' ? 'errore' : st.stato === 'salvataggio' ? 'salvataggio' : 'salvato';
    testoStato.textContent = st.stato === 'errore' ? 'Errore di salvataggio' : st.stato === 'salvataggio' ? 'Salvataggio…' : 'Dati salvati';
    if (st.stato === 'errore') {
      banner.hidden = false;
      banner.replaceChildren(
        icona('triangle-alert', { dimensione: 20 }),
        h('div', { class: 'banner-testo' }, h('strong', null, 'I dati non sono stati salvati. '),
          'Le ultime modifiche potrebbero andare perse se chiudi il programma. ', h('span', { class: 'sottotesto' }, st.errore || '')),
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => {
          try { await app.archivio.riprovaSalvataggio(); notificaOk('Salvataggio riuscito.'); } catch (e) { segnalaErrore(e, 'Nuovo tentativo di salvataggio'); }
        } }, 'Riprova a salvare'),
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: async () => {
          try { await esportaArchivio(app); } catch (e) { segnalaErrore(e, 'Esportazione'); }
        } }, 'Esporta una copia'),
      );
    } else {
      banner.hidden = true;
    }
  }
  app.archivio.alloStato(mostraStatoSalvataggio);

  // ---------------------------------------------------------------- avvisi (campanella e badge)
  let ultimiAvvisi = [];
  let inCorso = null;          // il calcolo degli avvisi in corso (uno alla volta)
  let richiestaNuova = false;  // durante il calcolo i dati sono cambiati di nuovo: se ne rifà uno subito dopo
  /** Ricalcola gli avvisi e aggiorna campanella e segnalazioni del menu. Una richiesta arrivata durante un calcolo non si perde mai. */
  function aggiornaAvvisi() {
    if (inCorso) { richiestaNuova = true; return inCorso; }
    inCorso = (async () => {
      try {
        do {
          richiestaNuova = false;
          try {
            ultimiAvvisi = await calcolaAvvisi();
          } catch (e) {
            console.error(e);
            ultimiAvvisi = [];
          }
        } while (richiestaNuova);
      } finally {
        inCorso = null;
      }
      mostraAvvisi();
      return ultimiAvvisi;
    })();
    return inCorso;
  }
  function mostraAvvisi() {
    const visibili = ultimiAvvisi.filter((a) => !avvisiNascosti.ha(a));
    contaCampanella.hidden = visibili.length === 0;
    contaCampanella.textContent = String(visibili.length);
    btnCampanella.setAttribute('aria-label', visibili.length ? `Avvisi: ${visibili.length}` : 'Avvisi: nessuno');
    const m = modello();
    const incomplete = m.pratiche.filter((p) => p.incompleta && !p.annullata).length;
    const badgePer = {
      pratiche: incomplete || null,
      backup: ultimiAvvisi.some((a) => (a.id === 'backup' || a.id.startsWith('integrita')) && a.livello !== 'info') ? '!' : null,
      provvigioni: null,
    };
    for (const v of voci) {
      const n = badgePer[v.def.id];
      v.badge.hidden = !n;
      v.badge.textContent = n ? String(n) : '';
      v.badge.title = '';
    }
  }
  avvisiNascosti.alCambio(mostraAvvisi); // nascondere o rimostrare un avviso, da qualunque schermata, aggiorna subito il numero sulla campanella
  function apriCampanella() {
    const contenuto = h('div', { class: 'popover-avvisi' });
    const disegna = () => {
      contenuto.replaceChildren(
        h('div', { class: 'popover-testa' }, h('strong', null, 'Avvisi')),
        disegnaAvvisi(ultimiAvvisi, { compatto: true, alNascondi: () => { disegna(); }, dopoAzione: () => { pop.chiudi(); aggiornaAvvisi(); } }),
      );
    };
    disegna();
    const pop = apriPopover(btnCampanella, contenuto, { allinea: 'fine', larghezzaMin: 340 });
  }

  // ---------------------------------------------------------------- aggiornamento dell'intestazione
  function aggiornaIntestazione() {
    elData.textContent = maiuscola(dataEstesa(oggi()));
    chipPeriodoTesto.textContent = contesto().periodo.etichetta;
    barraFiltri.aggiorna();
  }
  setInterval(() => { elData.textContent = maiuscola(dataEstesa(oggi())); }, 60000);

  function evidenziaVoce(percorso) {
    for (const v of voci) {
      if (v.def.attiva(percorso)) v.a.setAttribute('aria-current', 'page');
      else v.a.removeAttribute('aria-current');
    }
  }

  function applicaTema(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    scriviPref('tema', t || 'auto');
    aggiornaBottoneTema();
  }

  // Esc chiude il menu del telefono (o la barra aperta sopra il contenuto sui tablet) e riporta il cursore al pulsante
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    if (body.dataset.menu === 'aperto') { impostaMenuMobile(false, { focus: true }); }
    else if (overlayAperto) { chiudiOverlay(); btnRiduci.focus(); }
  });

  // scorciatoie da tastiera: "/" e Ctrl+K portano alla ricerca
  document.addEventListener('keydown', (ev) => {
    const el = document.activeElement;
    const inCampo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    if ((ev.key === '/' && !inCampo && !ev.ctrlKey && !ev.metaKey) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) {
      ev.preventDefault();
      ricerca.input.focus();
      ricerca.input.select();
    }
  });
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', aggiornaBottoneTema);

  applicaLayout();
  aggiornaIntestazione();

  return {
    vista, ricerca, barraFiltri, evidenziaVoce, aggiornaIntestazione, aggiornaAvvisi, applicaTema, temaEffettivo,
    avvisi: () => ultimiAvvisi,
    mostraStatoSalvataggio,
    chiudiMenuMobile,
    impostaFiltri: (opz) => barraFiltri.imposta(opz),
  };
}
export { naviga, notifica };
