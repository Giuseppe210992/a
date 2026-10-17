// Dashboard: pochi riquadri grandi, le operazioni di ogni giorno, un solo grafico, le ultime pratiche e gli avvisi.
// Tutti i numeri vengono dal database (nessun dato dimostrativo) e rispettano il periodo scelto in alto.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, ui, modello, contesto } from '../core/app.js';
import { naviga } from '../core/router.js';
import { dataIt, dataOra, eur, eurInt, eurCompatto, num } from '../core/format.js';
import { riepilogo, serieTemporale, perCollaboratore, ultimePratiche } from '../data/calc/aggregati.js';
import { ETICHETTA_STATO } from '../data/repo/pratiche.js';
import { ultimoBackup } from '../data/backup.js';
import { calcolaAvvisi, avvisiNascosti } from '../components/avvisi.js';
import { disegnaAvvisi } from '../components/lista-avvisi.js';
import { creaSchedaGrafico } from '../components/scheda-grafico.js';
import { apriDialogoIncasso, apriDialogoLiquidazione, eseguiBackupRapido } from '../components/dialoghi.js';
import { montaColonne } from '../charts/colonne.js';

const FORMATO_EURO = { asse: eurCompatto, valore: eur, breve: eurCompatto, intero: false };

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
    const schede = [];

    // ------------------------------------------------ primi passi (solo archivio da configurare)
    const nScaglioni = m.tabellaPredefinita.length + [...m.tabellePerZona.values()].reduce((a, t) => a + t.length, 0);
    const passi = [
      { fatto: m.collaboratori.length > 0, titolo: 'Controlla i collaboratori', testo: 'Luca e Giuseppe sono già inseriti: modificali o aggiungi gli altri collaboratori.', href: '#/impostazioni?sezione=collaboratori' },
      { fatto: m.zone.length > 0, titolo: 'Aggiungi le zone di lavoro', testo: 'Per ogni zona stabilisci anche come si divide tra i collaboratori: poi la divisione è automatica.', href: '#/impostazioni?sezione=zone' },
      { fatto: nScaglioni > 0, titolo: nScaglioni > 0 ? 'Controlla scaglioni e percentuali' : 'Imposta scaglioni e percentuali', testo: nScaglioni > 0 ? 'Sono già impostati quelli dell\'agenzia: verifica le soglie e le percentuali, o modificale.' : 'Le soglie di fatturato mensile e la percentuale di provvigione di ciascuna.', href: '#/impostazioni?sezione=scaglioni' },
      { fatto: m.pratiche.length > 0, titolo: 'Inserisci la prima pratica', testo: 'Da qui in poi la dashboard si aggiorna da sola.', href: '#/nuova' },
    ];
    const primiPassi = passi.every((p) => p.fatto) ? null : h('section', { class: 'card primi-passi', 'aria-labelledby': 'pp-titolo' },
      h('div', { class: 'card-corpo' },
        h('h2', { id: 'pp-titolo', style: { fontSize: '18px', fontWeight: 720 } }, 'Per iniziare'),
        h('p', { class: 'sottotesto', style: { marginTop: '4px' } }, 'Pochi passaggi e sei pronto. Finché non inserisci pratiche, i numeri restano a zero.'),
        h('div', { class: 'passi' }, passi.map((p, i) => h('div', { class: `passo${p.fatto ? ' fatto' : ''}` },
          h('span', { class: 'numero' }, p.fatto ? icona('check', { dimensione: 16 }) : String(i + 1)),
          h('div', { class: 'testo' }, h('b', null, p.titolo), h('span', null, p.testo)),
          p.fatto ? h('span', { class: 'badge badge-ok' }, 'Fatto') : h('a', { class: 'btn btn-secondario btn-sm', href: p.href }, 'Vai')))),
      ));

    // ------------------------------------------------ riquadri
    const quotaLiquidata = r.maturateCent > 0 ? Math.max(0, Math.min(100, (r.liquidateCent / r.maturateCent) * 100)) : 0;
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
        etichetta: 'Provvigioni dei collaboratori', nomeIcona: 'wallet', valore: eurInt(r.maturateCent), titolo: eur(r.maturateCent),
        nota: perColl.length ? perColl.slice(0, 3).map((c) => `${c.nome} ${eurInt(c.maturateCent)}`).join(' · ') : 'Nessun collaboratore', href: '#/provvigioni',
      }),
      riquadro({
        etichetta: 'Ancora da pagare ai collaboratori', nomeIcona: 'hand-coins', valore: eurInt(r.daLiquidareCent), titolo: eur(r.daLiquidareCent),
        meter: r.maturateCent > 0 ? h('div', { class: 'meter', role: 'img', 'aria-label': `Pagato ${Math.round(quotaLiquidata)}% delle provvigioni` }, h('i', { style: { width: `${quotaLiquidata}%` } })) : null,
        nota: r.maturateCent > 0 ? `Già pagati ${eurInt(r.liquidateCent)} su ${eurInt(r.maturateCent)}` : 'Nessuna provvigione nel periodo', href: '#/provvigioni?tab=dettaglio&solo=da-liquidare',
      }),
    ));

    // ------------------------------------------------ operazioni rapide
    const sottoBackup = h('small', null, 'Salva una copia dei dati');
    ultimoBackup(app).then((u) => { sottoBackup.textContent = u ? `Ultimo: ${dataOra(u)}` : 'Nessun backup ancora'; }).catch(() => {});
    const OPS = [
      { icona: 'file-plus', titolo: 'Nuova pratica', sotto: 'Inserisci una compravendita', href: '#/nuova', principale: true, id: 'op-nuova' },
      { icona: 'banknote', titolo: 'Registra un incasso', sotto: 'Un pagamento ricevuto', azione: () => apriDialogoIncasso(), id: 'op-incasso' },
      { icona: 'hand-coins', titolo: 'Paga un collaboratore', sotto: 'Registra la liquidazione', azione: () => apriDialogoLiquidazione(), id: 'op-liquidazione' },
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

    // ------------------------------------------------ un solo grafico: i compensi mese per mese
    const gCompensi = creaSchedaGrafico({ id: 'compensi', titolo: 'Compensi mese per mese', sottotitolo: 'Compensi dell\'agenzia (senza IVA)', montaFn: montaColonne, largo: true, conTotali: false });
    schede.push(gCompensi);
    const sc = serieTemporale(m, ctx, { granularita: 'mensile', metrica: 'compensi' });
    const catDa = (sr) => sr.intervalli.map((i) => ({ chiave: i.chiave, etichetta: i.etichetta, etichettaLunga: i.etichettaLunga, dim: !i.inPeriodo }));
    const nIn = sc.intervalli.filter((i) => i.inPeriodo).length;
    gCompensi.aggiorna({
      spec: { titolo: 'Compensi mese per mese', categorie: catDa(sc), serie: sc.serie.map((x) => ({ ...x, colore: 1, nome: 'Compensi' })), formato: FORMATO_EURO, altezza: 260, nomeCategorie: 'Mese', messaggioVuoto: 'Nessun compenso registrato nel periodo', totali: { tot: r.compensiCent } },
      cifre: [{ etichetta: 'Totale del periodo', valore: eur(r.compensiCent) }, { etichetta: 'Media al mese', valore: eur(nIn ? Math.round(r.compensiCent / nIn) : 0) }],
      nota: sc.intervalli.some((i) => !i.inPeriodo) ? 'Le colonne più chiare sono fuori dal periodo scelto: servono solo come confronto.' : null,
      vuoto: r.compensiCent === 0 && sc.serie[0].totale === 0 ? 'Nessun compenso registrato: appena inserisci una pratica compare qui.' : null,
    });
    const grafici = h('section', { 'aria-labelledby': 'graf-titolo', class: 'grafici-contenitore' },
      h('h2', { class: 'sezione-titolo', id: 'graf-titolo' }, 'Come stanno andando i conti'),
      h('div', { class: 'grafici-griglia' }, gCompensi.el));

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
      primiPassi,
      riquadri,
      h('div', { style: { marginTop: '24px' } }, operazioni),
      h('div', { style: { marginTop: '24px' } }, grafici),
      basso,
    );
    return { distruggi() { vivo = false; schede.forEach((x) => x.distruggi()); } };
  },
};
