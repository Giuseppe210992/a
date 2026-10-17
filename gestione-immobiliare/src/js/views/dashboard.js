// Dashboard: pochi riquadri grandi, le operazioni di ogni giorno, un solo grafico, le ultime pratiche e gli avvisi.
// Tutti i numeri vengono dal database (nessun dato dimostrativo) e rispettano il periodo scelto in alto.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, ui, modello, contesto } from '../core/app.js';
import { naviga } from '../core/router.js';
import { dataIt, dataOra, eur, eurInt, num } from '../core/format.js';
import { riepilogo, perCollaboratore, ultimePratiche } from '../data/calc/aggregati.js';
import { ETICHETTA_STATO } from '../data/repo/pratiche.js';
import { ultimoBackup } from '../data/backup.js';
import { calcolaAvvisi, avvisiNascosti } from '../components/avvisi.js';
import { disegnaAvvisi } from '../components/lista-avvisi.js';
import { eseguiBackupRapido } from '../components/dialoghi.js';

export function badgeStato(stato) {
  const icone = { in_corso: 'clock', conclusa: 'check', annullata: 'x' };
  return h('span', { class: `badge badge-${stato === 'in_corso' ? 'corso' : stato}` }, icona(icone[stato] || 'info', { dimensione: 14 }), ETICHETTA_STATO[stato] ?? stato);
}

function riquadro({ etichetta, nomeIcona, valore, titolo = null, nota = null, href = null, meter = null }) {
  const corpo = [
    h('div', { class: 'kpi-testa' }, h('span', { class: 'kpi-etichetta' }, etichetta), h('span', { class: 'kpi-icona' }, icona(nomeIcona, { dimensione: 17 }))),
    h('div', { class: 'kpi-valore', title: titolo }, valore),
    meter,
    nota ? h('div', { class: 'kpi-nota' }, nota) : null,
  ];
  return href ? h('a', { class: 'kpi', href }, ...corpo) : h('div', { class: 'kpi' }, ...corpo);
}

function queryArchivio(ctx, extra = {}) {
  const q = new URLSearchParams({ da: ctx.periodo.da, a: ctx.periodo.a, ...extra });
  return `#/pratiche?${q.toString()}`;
}

export const dashboard = {
  id: 'dashboard',
  titolo: 'Dashboard',
  // in alto resta solo il periodo: zona, collaboratore e vista mensile/annuale si usano nelle Statistiche
  filtri: { zona: false, collaboratore: false, granularita: false },
  monta(contenitore) {
    const m = modello();
    // la dashboard guarda sempre tutta l'agenzia, mese per mese
    const ctx = { ...contesto(), zonaId: null, collaboratoreId: null, granularita: 'mensile' };
    const r = riepilogo(m, ctx);

    // ------------------------------------------------ riquadri
    const perColl = perCollaboratore(m, ctx);

    const riquadri = h('div', { class: 'kpi-contenitore' }, h('section', { class: 'kpi-griglia', 'aria-label': 'Riepilogo del periodo', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' } },
      riquadro({
        etichetta: 'Pratiche concluse', nomeIcona: 'handshake', valore: num(r.concluse),
        nota: 'Nel periodo scelto', href: queryArchivio(ctx, { stato: 'conclusa' }),
      }),
      riquadro({
        etichetta: 'Compensi dell\'agenzia', nomeIcona: 'receipt', valore: eurInt(r.compensiCent), titolo: eur(r.compensiCent),
        nota: 'Senza IVA', href: '#/statistiche',
      }),
      riquadro({
        etichetta: 'Provvigioni pagate', nomeIcona: 'wallet', valore: eurInt(r.maturateCent), titolo: eur(r.maturateCent),
        nota: perColl.length ? perColl.slice(0, 3).map((c) => `${c.nome} ${eurInt(c.maturateCent)}`).join(' · ') : 'Nessun collaboratore', href: '#/provvigioni',
      }),
    ));

    // ------------------------------------------------ operazioni rapide
    const sottoBackup = h('small', null, 'Salva una copia dei dati');
    ultimoBackup(app).then((u) => { sottoBackup.textContent = u ? `Ultimo: ${dataOra(u)}` : 'Nessun backup ancora'; }).catch(() => {});
    const OPS = [
      { icona: 'file-plus', titolo: 'Nuova pratica', sotto: 'Inserisci una compravendita', href: '#/nuova', principale: true, id: 'op-nuova' },
      { icona: 'database-backup', titolo: 'Crea un backup', sotto: sottoBackup, azione: () => eseguiBackupRapido(), id: 'op-backup' },
    ];
    const operazioni = h('section', { 'aria-labelledby': 'ops-titolo' },
      h('h2', { class: 'sezione-titolo', id: 'ops-titolo' }, 'Cosa vuoi fare?'),
      h('div', { class: 'ops-contenitore' }, h('div', { class: 'ops-griglia' }, OPS.map((o) => {
        const contenuto = [h('span', { class: 'op-icona' }, icona(o.icona, { dimensione: 20 })), h('span', null, h('b', null, o.titolo), typeof o.sotto === 'string' ? h('small', null, o.sotto) : o.sotto)];
        return o.href
          ? h('a', { class: `op${o.principale ? ' principale-op' : ''}`, href: o.href, id: o.id }, ...contenuto)
          : h('button', { type: 'button', class: 'op', id: o.id, onclick: o.azione }, ...contenuto);
      }))));

    // ------------------------------------------------ ultime pratiche e avvisi
    const ultime = ultimePratiche(m, ctx, 5);
    const tabellaUltime = ultime.length
      ? h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella' },
        h('caption', { class: 'solo-lettori' }, 'Ultime pratiche inserite o modificate'),
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Pratica'), h('th', { class: 'num' }, 'Compensi'))),
        h('tbody', null, ultime.map((p) => {
          const vai = () => naviga(`#/pratiche/${p.id}`);
          return h('tr', { class: 'cliccabile', onclick: (ev) => { if (!ev.target.closest('a')) vai(); } },
            h('td', null, p.dataEtichetta),
            h('td', null, h('a', { href: `#/pratiche/${p.id}`, class: 'forte', style: { color: 'var(--text)' } }, p.descrizione), h('span', { class: 'sottotesto' }, p.codice)),
            h('td', { class: 'num forte' }, eur(p.compensoTotaleCent)));
        }))))
      : h('div', { class: 'vuoto' }, icona('archive', { dimensione: 40 }), h('strong', null, 'Nessuna pratica da mostrare'), h('p', null, m.pratiche.length ? 'Nessuna pratica nel periodo scelto.' : 'Quando inserirai la prima pratica la vedrai qui.'),
        m.pratiche.length ? null : h('a', { class: 'btn btn-primario', href: '#/nuova' }, icona('plus', { dimensione: 16 }), 'Nuova pratica'));
    const cardUltime = h('section', { class: 'card', 'aria-labelledby': 'ult-titolo' },
      h('div', { class: 'card-testa' }, h('div', null, h('h2', { id: 'ult-titolo' }, 'Ultime pratiche'), h('p', null, 'Clic su una riga per aprirla')), h('a', { class: 'btn btn-secondario btn-sm', href: '#/pratiche' }, 'Vedi tutte')),
      h('div', { style: { marginTop: '8px' } }, tabellaUltime));

    const corpoAvvisi = h('div', { class: 'card-corpo', style: { paddingTop: '12px' } }, h('p', { class: 'sottotesto' }, 'Controllo in corso…'));
    const titoloAvvisi = h('h2', { id: 'avv-titolo' }, 'Avvisi');
    const cardAvvisi = h('section', { class: 'card', 'aria-labelledby': 'avv-titolo', id: 'avvisi' },
      h('div', { class: 'card-testa' }, h('div', null, titoloAvvisi, h('p', null, 'Cose a cui fare attenzione, mai bloccanti'))), corpoAvvisi);
    let vivo = true;
    const caricaAvvisi = async () => {
      let lista = [];
      try { lista = await calcolaAvvisi(); } catch (e) { console.error(e); }
      if (!vivo) return;
      const visibili = lista.filter((a) => !avvisiNascosti.ha(a));
      titoloAvvisi.textContent = visibili.length ? `Avvisi (${visibili.length})` : 'Avvisi';
      const nodi = [disegnaAvvisi(lista, { alNascondi: caricaAvvisi, dopoAzione: () => { caricaAvvisi(); ui.aggiornaAvvisi(); } })];
      if (avvisiNascosti.quanti()) nodi.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', style: { marginTop: '10px' }, onclick: () => { avvisiNascosti.ripristinaTutti(); caricaAvvisi(); ui.aggiornaAvvisi(); } }, `Mostra di nuovo gli avvisi nascosti (${avvisiNascosti.quanti()})`));
      corpoAvvisi.replaceChildren(...nodi);
    };
    caricaAvvisi();

    const basso = h('div', { class: 'duo-contenitore', style: { marginTop: '24px' } }, h('div', { class: 'duo' }, cardUltime, cardAvvisi));

    monta(contenitore,
      h('div', { class: 'pagina-testa' },
        h('div', null, h('h1', null, 'Dashboard'), h('p', null, `Come sta andando l'agenzia · ${ctx.periodo.etichetta}`))),
      riquadri,
      h('div', { style: { marginTop: '24px' } }, operazioni),
      basso,
    );
    return { distruggi() { vivo = false; } };
  },
};
