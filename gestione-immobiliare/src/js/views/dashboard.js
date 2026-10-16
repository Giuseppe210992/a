// Dashboard: riquadri riepilogativi, operazioni rapide, grafici, ultime pratiche e avvisi.
// Tutti i numeri vengono dal database (nessun dato dimostrativo) e rispettano i filtri scelti.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, ui, modello, contesto, impostazioni } from '../core/app.js';
import { naviga } from '../core/router.js';
import { leggiPref, scriviPref } from '../core/preferenze.js';
import { chiaveMese, oggi, periodoPrecedente } from '../core/dates.js';
import { eur, eurInt, eurCompatto, eurSegno, num, pctSegno, pct, dataIt, meseAnno, dataOra } from '../core/format.js';
import {
  riepilogo, serieTemporale, perCollaboratore, confrontoPrezzi, ultimePratiche, variazionePct, cumuloDelMese,
} from '../data/calc/aggregati.js';
import { ETICHETTA_STATO } from '../data/repo/pratiche.js';
import { ultimoBackup } from '../data/backup.js';
import { calcolaAvvisi, avvisiNascosti } from '../components/avvisi.js';
import { disegnaAvvisi } from '../components/lista-avvisi.js';
import { creaSchedaGrafico } from '../components/scheda-grafico.js';
import { apriDialogoIncasso, apriDialogoLiquidazione, apriDialogoEsporta, eseguiBackupRapido, eseguiImportazione } from '../components/dialoghi.js';
import { montaColonne } from '../charts/colonne.js';
import { montaBarre } from '../charts/barre.js';
import { montaDumbbell } from '../charts/dumbbell.js';
import { sparkline } from '../charts/sparkline.js';

const FORMATO_EURO = { asse: eurCompatto, valore: eur, breve: eurCompatto, intero: false };
const FORMATO_NUM = { asse: num, valore: num, breve: num, intero: true };

export function badgeStato(stato) {
  const icone = { in_corso: 'clock', conclusa: 'check', annullata: 'x' };
  return h('span', { class: `badge badge-${stato === 'in_corso' ? 'corso' : stato}` }, icona(icone[stato] || 'info', { dimensione: 14 }), ETICHETTA_STATO[stato] ?? stato);
}

/** Tiene al massimo `max` serie: le piu' grandi restano, il resto confluisce in "Altri" (grigio). */
export function riduciSerie(serie, max = 4) {
  const ordinate = serie.slice().sort((a, b) => b.totale - a.totale);
  if (ordinate.length <= max) return serie;
  const tieni = new Set(ordinate.slice(0, max - 1).map((x) => x.id));
  const resto = serie.filter((x) => !tieni.has(x.id) && x.totale > 0);
  const valori = serie[0].valori.map((_, i) => resto.reduce((a, x) => a + (x.valori[i] || 0), 0));
  return [
    ...serie.filter((x) => tieni.has(x.id)),
    ...(resto.length ? [{ id: 'altri', nome: 'Altri', colore: 0, valori, totale: valori.reduce((a, b) => a + b, 0) }] : []),
  ];
}

function descrizioneFiltri(ctx) {
  const m = modello();
  const parti = [ctx.periodo.etichetta];
  if (ctx.zonaId != null) parti.push(`zona ${m.zone.find((z) => z.id === ctx.zonaId)?.nome}`);
  if (ctx.collaboratoreId != null) parti.push(m.collaboratori.find((c) => c.id === ctx.collaboratoreId)?.nome);
  return parti.join(' · ');
}

function deltaTesto(att, prec, periodoPrec) {
  if (!periodoPrec) return null;
  const v = variazionePct(att, prec);
  const vs = `rispetto a ${periodoPrec.etichetta.toLowerCase()}`;
  if (v === null) return att > 0 ? { classe: 'neutro', icona: null, testo: 'Nessun confronto', vs: `${periodoPrec.etichetta.toLowerCase()} senza dati` } : null;
  if (Math.abs(v) < 0.05) return { classe: 'neutro', icona: 'minus', testo: 'Invariato', vs };
  return { classe: v > 0 ? 'su' : 'giu', icona: v > 0 ? 'arrow-up' : 'arrow-down', testo: pctSegno(v), vs };
}

function riquadro({ etichetta, nomeIcona, valore, titolo = null, delta = null, spark = null, nota = null, href = null, meter = null }) {
  const corpo = [
    h('div', { class: 'kpi-testa' }, h('span', { class: 'kpi-etichetta' }, etichetta), h('span', { class: 'kpi-icona' }, icona(nomeIcona, { dimensione: 17 }))),
    h('div', { class: 'kpi-valore', title: titolo }, valore),
    delta ? h('div', { class: `kpi-delta ${delta.classe}` }, h('span', { class: 'kpi-delta-riga' }, delta.icona ? icona(delta.icona, { dimensione: 14 }) : null, delta.testo), h('span', { class: 'vs' }, delta.vs)) : h('div', { class: 'kpi-delta' }),
    meter,
    nota ? h('div', { class: 'kpi-nota' }, nota) : null,
    spark ? h('div', { class: 'kpi-spark', 'aria-hidden': 'false' }, spark) : null,
  ];
  return href ? h('a', { class: 'kpi', href }, ...corpo) : h('div', { class: 'kpi' }, ...corpo);
}

function queryArchivio(ctx, extra = {}) {
  const q = new URLSearchParams({ da: ctx.periodo.da, a: ctx.periodo.a, ...extra });
  if (ctx.zonaId != null) q.set('zona', String(ctx.zonaId));
  if (ctx.collaboratoreId != null) q.set('collab', String(ctx.collaboratoreId));
  return `#/pratiche?${q.toString()}`;
}

export const dashboard = {
  id: 'dashboard',
  titolo: 'Dashboard',
  filtri: { zona: true, collaboratore: true, granularita: true },
  monta(contenitore) {
    const m = modello();
    const ctx = contesto();
    const gran = ctx.granularita;
    const prec = periodoPrecedente(ctx.periodo);
    const r = riepilogo(m, ctx);
    const rp = prec ? riepilogo(m, { ...ctx, periodo: prec }) : null;
    const schede = [];

    // ------------------------------------------------ primi passi (solo archivio da configurare)
    const nScaglioni = m.tabellaPredefinita.length + [...m.tabellePerZona.values()].reduce((a, t) => a + t.length, 0);
    const passi = [
      { fatto: m.collaboratori.length > 0, titolo: 'Controlla i collaboratori', testo: 'Luca e Giuseppe sono già inseriti: modificali o aggiungi gli altri collaboratori.', href: '#/impostazioni?sezione=collaboratori' },
      { fatto: m.zone.length > 0, titolo: 'Aggiungi le zone di lavoro', testo: 'Servono per il cumulo mensile e per le statistiche per zona.', href: '#/impostazioni?sezione=zone' },
      { fatto: nScaglioni > 0, titolo: 'Imposta scaglioni e percentuali', testo: 'Le soglie di fatturato mensile e la percentuale di provvigione di ciascuna.', href: '#/impostazioni?sezione=scaglioni' },
      { fatto: m.pratiche.length > 0, titolo: 'Inserisci la prima pratica', testo: 'Da qui in poi la dashboard si aggiorna da sola.', href: '#/nuova' },
    ];
    const primiPassi = passi.every((p) => p.fatto) ? null : h('section', { class: 'card primi-passi', 'aria-labelledby': 'pp-titolo' },
      h('div', { class: 'card-corpo' },
        h('h2', { id: 'pp-titolo', style: { fontSize: '18px', fontWeight: 720 } }, 'Per iniziare'),
        h('p', { class: 'sottotesto', style: { marginTop: '4px' } }, 'Pochi passaggi per avere calcoli e grafici corretti. La dashboard mostra solo i tuoi dati reali: finché non ne inserisci, i numeri restano a zero.'),
        h('div', { class: 'passi' }, passi.map((p, i) => h('div', { class: `passo${p.fatto ? ' fatto' : ''}` },
          h('span', { class: 'numero' }, p.fatto ? icona('check', { dimensione: 16 }) : String(i + 1)),
          h('div', { class: 'testo' }, h('b', null, p.titolo), h('span', null, p.testo)),
          p.fatto ? h('span', { class: 'badge badge-ok' }, 'Fatto') : h('a', { class: 'btn btn-secondario btn-sm', href: p.href }, 'Vai')))),
      ));

    // ------------------------------------------------ riquadri
    const sp = (metrica) => {
      const sr = serieTemporale(m, { ...ctx }, { granularita: 'mensile', metrica });
      return sr.serie[0] ? { valori: sr.serie[0].valori, etichette: sr.intervalli.map((i) => i.etichettaLunga) } : { valori: [], etichette: [] };
    };
    const sCompensi = sp('compensi'), sConcluse = sp('concluse'), sMaturate = sp('provvigioni'), sValore = sp('valore');
    const quotaLiquidata = r.maturateCent > 0 ? Math.max(0, Math.min(100, (r.liquidateCent / r.maturateCent) * 100)) : 0;
    const perColl = perCollaboratore(m, ctx);

    const riquadri = h('div', { class: 'kpi-contenitore' }, h('section', { class: 'kpi-griglia', 'aria-label': 'Riepilogo del periodo' },
      riquadro({
        etichetta: 'Compravendite concluse', nomeIcona: 'handshake', valore: num(r.concluse),
        delta: deltaTesto(r.concluse, rp?.concluse, prec), spark: sparkline(sConcluse.valori, { etichetta: 'Compravendite concluse, ultimi 12 mesi', formato: num, etichette: sConcluse.etichette }),
        nota: 'Per data di rogito', href: queryArchivio(ctx, { stato: 'conclusa' }),
      }),
      riquadro({
        etichetta: 'Totale compensi registrati', nomeIcona: 'receipt', valore: eurInt(r.compensiCent), titolo: eur(r.compensiCent),
        delta: deltaTesto(r.compensiCent, rp?.compensiCent, prec), spark: sparkline(sCompensi.valori, { etichetta: 'Compensi, ultimi 12 mesi', formato: eur, etichette: sCompensi.etichette }),
        nota: `Imponibile · incassati ${eurInt(r.incassatoCent)}`, href: '#/statistiche',
      }),
      riquadro({
        etichetta: 'Provvigioni maturate', nomeIcona: 'wallet', valore: eurInt(r.maturateCent), titolo: eur(r.maturateCent),
        delta: deltaTesto(r.maturateCent, rp?.maturateCent, prec), spark: sparkline(sMaturate.valori, { etichetta: 'Provvigioni maturate, ultimi 12 mesi', formato: eur, etichette: sMaturate.etichette }),
        nota: perColl.length ? perColl.slice(0, 3).map((c) => `${c.nome} ${eurInt(c.maturateCent)}`).join(' · ') : 'Nessun collaboratore', href: '#/provvigioni',
      }),
      riquadro({
        etichetta: 'Provvigioni ancora da liquidare', nomeIcona: 'hand-coins', valore: eurInt(r.daLiquidareCent), titolo: eur(r.daLiquidareCent),
        meter: r.maturateCent > 0 ? h('div', { class: 'meter', role: 'img', 'aria-label': `Liquidato ${Math.round(quotaLiquidata)}% delle provvigioni maturate` }, h('i', { style: { width: `${quotaLiquidata}%` } })) : null,
        nota: r.maturateCent > 0 ? `Liquidate ${eurInt(r.liquidateCent)} su ${eurInt(r.maturateCent)} maturate` : 'Nessuna provvigione maturata nel periodo', href: '#/provvigioni?tab=dettaglio&solo=da-liquidare',
      }),
      riquadro({
        etichetta: 'Valore complessivo immobili venduti', nomeIcona: 'building-2', valore: eurInt(r.valoreVendutoCent), titolo: eur(r.valoreVendutoCent),
        delta: deltaTesto(r.valoreVendutoCent, rp?.valoreVendutoCent, prec), spark: sparkline(sValore.valori, { etichetta: 'Valore venduto, ultimi 12 mesi', formato: eur, etichette: sValore.etichette }),
        nota: r.concluse ? `Prezzo medio ${eurInt(Math.round(r.valoreVendutoCent / r.concluse))}` : 'Somma dei prezzi di vendita', href: queryArchivio(ctx, { stato: 'conclusa' }),
      }),
      riquadro({
        etichetta: 'Pratiche in corso', nomeIcona: 'clock', valore: num(r.inCorso),
        nota: 'Aperte oggi, qualunque sia il periodo', href: `#/pratiche?stato=in_corso${ctx.zonaId != null ? `&zona=${ctx.zonaId}` : ''}${ctx.collaboratoreId != null ? `&collab=${ctx.collaboratoreId}` : ''}`,
      }),
    ));

    // ------------------------------------------------ operazioni rapide
    const sottoBackup = h('small', null, 'Salva una copia dei dati');
    ultimoBackup(app).then((u) => { sottoBackup.textContent = u ? `Ultimo: ${dataOra(u)}` : 'Nessun backup ancora'; }).catch(() => {});
    const OPS = [
      { icona: 'file-plus', titolo: 'Inserisci nuova compravendita', sotto: 'Apri una nuova pratica', href: '#/nuova', principale: true, id: 'op-nuova' },
      { icona: 'search', titolo: 'Cerca una pratica', sotto: 'Per codice, via, cliente o zona', azione: () => ui.cerca(), id: 'op-cerca' },
      { icona: 'banknote', titolo: 'Registra un incasso', sotto: 'Pagamento ricevuto dal cliente', azione: () => apriDialogoIncasso(), id: 'op-incasso' },
      { icona: 'hand-coins', titolo: 'Registra una liquidazione', sotto: 'Pagamento a un collaboratore', azione: () => apriDialogoLiquidazione(), id: 'op-liquidazione' },
      { icona: 'layers', titolo: 'Consulta il cumulo mensile', sotto: 'Scaglioni e percentuali raggiunte', href: '#/cumulo', id: 'op-cumulo' },
      { icona: 'download', titolo: 'Esporta i dati', sotto: 'CSV per Excel o archivio completo', azione: () => apriDialogoEsporta(), id: 'op-esporta' },
      { icona: 'database-backup', titolo: 'Crea un backup', sotto: sottoBackup, azione: () => eseguiBackupRapido(), id: 'op-backup' },
      { icona: 'upload', titolo: 'Importa un backup precedente', sotto: 'Sostituisce i dati con un file salvato', azione: () => eseguiImportazione(), id: 'op-importa' },
    ];
    const operazioni = h('section', { 'aria-labelledby': 'ops-titolo' },
      h('h2', { class: 'sezione-titolo', id: 'ops-titolo' }, 'Operazioni rapide'),
      h('div', { class: 'ops-contenitore' }, h('div', { class: 'ops-griglia' }, OPS.map((o) => {
        const contenuto = [h('span', { class: 'op-icona' }, icona(o.icona, { dimensione: 20 })), h('span', null, h('b', null, o.titolo), typeof o.sotto === 'string' ? h('small', null, o.sotto) : o.sotto)];
        return o.href
          ? h('a', { class: `op${o.principale ? ' principale-op' : ''}`, href: o.href, id: o.id }, ...contenuto)
          : h('button', { type: 'button', class: 'op', id: o.id, onclick: o.azione }, ...contenuto);
      }))));

    // ------------------------------------------------ grafici
    const etichettaVista = gran === 'annuale' ? 'per anno' : 'per mese';
    const cArea = (id, titolo, sotto, montaFn, extra = {}) => {
      const sch = creaSchedaGrafico({ id, titolo, sottotitolo: sotto, montaFn, ...extra });
      schede.push(sch);
      return sch;
    };

    const gCompensi = cArea('compensi', 'Andamento dei compensi', `Compensi registrati (imponibile), ${etichettaVista}`, montaColonne, { largo: true, conTotali: false });
    const sc = serieTemporale(m, ctx, { granularita: gran, metrica: 'compensi' });
    const catDa = (sr) => sr.intervalli.map((i) => ({ chiave: i.chiave, etichetta: i.etichetta, etichettaLunga: i.etichettaLunga, dim: !i.inPeriodo }));
    const nIn = sc.intervalli.filter((i) => i.inPeriodo).length;
    gCompensi.aggiorna({
      spec: { titolo: 'Andamento dei compensi', categorie: catDa(sc), serie: sc.serie.map((x) => ({ ...x, colore: 1, nome: 'Compensi' })), formato: FORMATO_EURO, altezza: 260, nomeCategorie: gran === 'annuale' ? 'Anno' : 'Mese', messaggioVuoto: 'Nessun compenso registrato nel periodo', totali: { tot: r.compensiCent } },
      cifre: [{ etichetta: 'Totale del periodo', valore: eur(r.compensiCent) }, { etichetta: gran === 'annuale' ? 'Media annua' : 'Media mensile', valore: eur(nIn ? Math.round(r.compensiCent / nIn) : 0) }],
      nota: sc.intervalli.some((i) => !i.inPeriodo) ? 'Le colonne più chiare sono fuori dal periodo selezionato: servono solo come confronto.' : null,
      vuoto: r.compensiCent === 0 && sc.serie[0].totale === 0 ? 'Nessun compenso registrato: appena concludi una pratica compare qui.' : null,
    });

    const gConcluse = cArea('concluse', 'Compravendite concluse', `Numero di pratiche con rogito, ${etichettaVista}`, montaColonne);
    const sn = serieTemporale(m, ctx, { granularita: gran, metrica: 'concluse' });
    gConcluse.aggiorna({
      spec: { titolo: 'Compravendite concluse', categorie: catDa(sn), serie: sn.serie.map((x) => ({ ...x, colore: 1, nome: 'Compravendite' })), formato: FORMATO_NUM, altezza: 260, nomeCategorie: gran === 'annuale' ? 'Anno' : 'Mese', messaggioVuoto: 'Nessuna compravendita nel periodo', totali: { tot: r.concluse } },
      cifre: [{ etichetta: 'Nel periodo', valore: num(r.concluse) }, { etichetta: 'Valore medio', valore: r.concluse ? eurInt(Math.round(r.valoreVendutoCent / r.concluse)) : '—' }],
      vuoto: sn.serie[0].totale === 0 ? 'Nessuna compravendita conclusa finora.' : null,
    });

    const gProvv = cArea('provvigioni', 'Provvigioni maturate e liquidate', 'Per collaboratore, nel periodo', montaBarre);
    gProvv.aggiorna({
      spec: {
        titolo: 'Provvigioni maturate e liquidate per collaboratore', ordinale: true, nomeCategorie: 'Collaboratore',
        categorie: perColl.map((c) => ({ chiave: c.id, etichetta: c.nome, etichettaLunga: `${c.nome} · maturate ${eur(c.maturateCent)}` })),
        serie: [
          { id: 'liq', nome: 'Liquidate', colore: 'o1', valori: perColl.map((c) => Math.max(0, c.liquidateCent)) },
          { id: 'dal', nome: 'Da liquidare', colore: 'o2', valori: perColl.map((c) => Math.max(0, c.daLiquidareCent)) },
        ],
        formato: FORMATO_EURO,
      },
      cifre: [{ etichetta: 'Maturate', valore: eurInt(r.maturateCent) }, { etichetta: 'Liquidate', valore: eurInt(r.liquidateCent) }, { etichetta: 'Da liquidare', valore: eurInt(r.daLiquidareCent) }],
      nota: 'Maturate = liquidate + da liquidare. La lunghezza della barra è il totale maturato.',
      vuoto: !perColl.length ? 'Nessun collaboratore attivo.' : (r.maturateCent === 0 && r.liquidateCent === 0 ? 'Nessuna provvigione maturata nel periodo.' : null),
    });

    // confronto tra collaboratori con scelta della misura
    let metrica = leggiPref('confrontoMetrica', 'compensi');
    if (!['compensi', 'provvigioni', 'concluse'].includes(metrica)) metrica = 'compensi';
    const etichetteMetrica = { compensi: 'Compensi', provvigioni: 'Provvigioni', concluse: 'Pratiche' };
    const gConf = cArea('confronto', 'Confronto tra collaboratori', `Risultati di ciascun collaboratore, ${etichettaVista}`, montaColonne, { conTotali: true });
    const segmenti = h('div', { class: 'segmenti', role: 'group', 'aria-label': 'Misura da confrontare', style: { marginBottom: '8px' } });
    const disegnaConfronto = () => {
      segmenti.replaceChildren(...Object.entries(etichetteMetrica).map(([k, e]) => h('button', { type: 'button', 'aria-pressed': String(k === metrica), onclick: () => { metrica = k; scriviPref('confrontoMetrica', k); disegnaConfronto(); } }, e)));
      const sr = serieTemporale(m, ctx, { granularita: gran, metrica, per: 'collaboratore' });
      const serie = riduciSerie(sr.serie.filter((x) => x.id !== 'c0' || x.totale > 0));
      const fmt = metrica === 'concluse' ? FORMATO_NUM : FORMATO_EURO;
      const totali = Object.fromEntries(serie.map((x) => [x.id, x.totale]));
      gConf.aggiorna({
        extra: segmenti,
        spec: { titolo: `Confronto tra collaboratori: ${etichetteMetrica[metrica].toLowerCase()}`, categorie: catDa(sr), serie, formato: fmt, altezza: 260, nomeCategorie: gran === 'annuale' ? 'Anno' : 'Mese', messaggioVuoto: 'Nessun dato nel periodo', totali },
        cifre: serie.filter((x) => x.id !== 'altri').slice(0, 4).map((x) => ({ etichetta: x.nome, valore: metrica === 'concluse' ? num(x.totale) : eurInt(x.totale) })),
        vuoto: serie.every((x) => x.totale === 0) ? 'Nessun dato da confrontare nel periodo.' : null,
      });
    };
    disegnaConfronto();

    const gZona = cArea('zone', 'Provvigioni per zona e scaglioni raggiunti', `Provvigioni maturate per zona, ${etichettaVista}`, montaColonne, { conTotali: true });
    const sz = serieTemporale(m, ctx, { granularita: gran, metrica: 'provvigioni', per: 'zona' });
    const serieZone = riduciSerie(sz.serie.filter((x) => x.id !== 'z0' || x.totale > 0), 5);
    const fineRif = ctx.periodo.a < oggi() ? ctx.periodo.a : oggi();
    const meseRif = chiaveMese(fineRif);
    const righeCumulo = cumuloDelMese(m, meseRif, { zonaId: ctx.zonaId, collaboratoreId: ctx.collaboratoreId })
      .flatMap((g) => g.righe.map((x) => ({ ...x, zonaNome: x.zonaNome ?? g.zonaNome })))
      .filter((x) => x.fatturatoCent > 0);
    const sottoZone = h('div', { style: { marginTop: '12px' } },
      h('div', { class: 'sottotesto forte', style: { marginBottom: '6px' } }, `Scaglioni raggiunti a ${meseAnno(meseRif)}`),
      righeCumulo.length
        ? h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella tabella-compatta' },
          h('thead', null, h('tr', null, h('th', null, 'Zona'), h('th', null, 'Collaboratore'), h('th', { class: 'num' }, 'Cumulo'), h('th', null, 'Scaglione'))),
          h('tbody', null, righeCumulo.slice(0, 6).map((x) => h('tr', null,
            h('td', null, x.zonaNome ?? '—'), h('td', null, x.collaboratoreNome ?? 'Tutti'), h('td', { class: 'num' }, eurInt(x.fatturatoCent)),
            h('td', null, x.scaglione ? h('span', { class: 'badge badge-info' }, `${x.scaglioneIdx + 1}° · ${pct(x.percentuale)}`) : h('span', { class: 'sottotesto' }, 'non configurato')))))),
          righeCumulo.length > 6 ? h('div', { class: 'sottotesto', style: { padding: '8px 14px' } }, `e altre ${righeCumulo.length - 6} righe`) : null)
        : h('p', { class: 'sottotesto' }, `Nessun fatturato registrato a ${meseAnno(meseRif)}.`),
      h('a', { href: '#/cumulo', style: { fontSize: '13px', fontWeight: 650, display: 'inline-block', marginTop: '8px' } }, 'Apri il cumulo mensile →'));
    gZona.aggiorna({
      spec: { titolo: 'Provvigioni per zona', categorie: catDa(sz), serie: serieZone, impilato: true, formato: FORMATO_EURO, altezza: 250, nomeCategorie: gran === 'annuale' ? 'Anno' : 'Mese', messaggioVuoto: 'Nessuna provvigione nel periodo', totali: Object.fromEntries(serieZone.map((x) => [x.id, x.totale])) },
      cifre: serieZone.filter((x) => x.totale > 0).slice(0, 4).map((x) => ({ etichetta: x.nome, valore: eurInt(x.totale) })),
      sotto: sottoZone,
      vuoto: serieZone.every((x) => x.totale === 0) && !righeCumulo.length ? 'Nessuna provvigione maturata per zona nel periodo.' : null,
    });

    const gPrezzi = cArea('prezzi', 'Prezzo di acquisto e di vendita', 'Solo per le pratiche in cui sono noti entrambi i prezzi', montaDumbbell, { largo: true });
    const cp = confrontoPrezzi(m, ctx, 8);
    const spec = {
      titolo: 'Confronto tra prezzo di acquisto e prezzo di vendita', nomi: ['Prezzo di acquisto', 'Prezzo di vendita'], formato: FORMATO_EURO,
      righe: cp.righe.map((x) => ({
        etichetta: x.pratica.codice, sotto: x.pratica.immobile_indirizzo, etichettaLunga: `${x.pratica.codice} — ${x.pratica.immobile_indirizzo}`,
        a: x.acquistoCent, b: x.venditaCent, deltaCent: x.deltaCent,
        deltaTesto: `${eurSegno(x.deltaCent)} (${pctSegno(x.deltaPct)})`,
      })),
    };
    gPrezzi.aggiorna({
      spec,
      cifre: cp.totale ? [{ etichetta: 'Variazione media', valore: pctSegno(cp.mediaDeltaPct) }, { etichetta: 'Pratiche confrontate', valore: `${num(cp.totale)}${cp.totale > cp.righe.length ? ` (ultime ${cp.righe.length})` : ''}` }] : null,
      nota: cp.mancanti > 0 && cp.totale ? `${cp.mancanti} ${cp.mancanti === 1 ? 'pratica conclusa non ha' : 'pratiche concluse non hanno'} entrambi i prezzi (acquisto e vendita) e non compare${cp.mancanti === 1 ? '' : 'ono'} nel confronto.` : null,
      vuoto: cp.totale ? null : (cp.mancanti ? `Nessuna delle ${cp.mancanti} pratiche concluse nel periodo ha sia il prezzo di acquisto sia quello di vendita. Inseriscili nella scheda della pratica per vedere il confronto.` : 'Nessuna pratica con prezzo di acquisto e di vendita nel periodo.'),
      tabella: () => h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella tabella-compatta' },
        h('caption', { class: 'solo-lettori' }, 'Prezzo di acquisto e di vendita'),
        h('thead', null, h('tr', null, h('th', null, 'Pratica'), h('th', { class: 'num' }, 'Acquisto'), h('th', { class: 'num' }, 'Vendita'), h('th', { class: 'num' }, 'Differenza'))),
        h('tbody', null, cp.righe.map((x) => h('tr', null, h('th', { scope: 'row' }, `${x.pratica.codice} — ${x.pratica.immobile_indirizzo}`), h('td', { class: 'num' }, eur(x.acquistoCent)), h('td', { class: 'num' }, eur(x.venditaCent)), h('td', { class: 'num' }, `${eurSegno(x.deltaCent)} (${pctSegno(x.deltaPct)})`)))))),
    });

    const grafici = h('section', { 'aria-labelledby': 'graf-titolo', class: 'grafici-contenitore' },
      h('h2', { class: 'sezione-titolo', id: 'graf-titolo' }, 'Grafici'),
      h('div', { class: 'grafici-griglia' }, gCompensi.el, gConcluse.el, gProvv.el, gConf.el, gZona.el, gPrezzi.el));

    // ------------------------------------------------ ultime pratiche e avvisi
    const ultime = ultimePratiche(m, ctx, 8);
    const tabellaUltime = ultime.length
      ? h('div', { class: 'tabella-wrap' }, h('table', { class: 'tabella' },
        h('caption', { class: 'solo-lettori' }, 'Ultime pratiche inserite o modificate'),
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Immobile'), h('th', null, 'Zona'), h('th', null, 'Stato'), h('th', { class: 'num' }, 'Compensi'))),
        h('tbody', null, ultime.map((p) => {
          const vai = () => naviga(`#/pratiche/${p.id}`);
          return h('tr', { class: 'cliccabile', onclick: (ev) => { if (!ev.target.closest('a')) vai(); } },
            h('td', { class: 'num' }, dataIt(p.dataRif)),
            h('td', null, h('a', { href: `#/pratiche/${p.id}`, class: 'forte', style: { color: 'var(--text)' } }, p.immobile_indirizzo), h('span', { class: 'sottotesto' }, `${p.codice}${p.immobile_comune ? ` · ${p.immobile_comune}` : ''}`)),
            h('td', null, p.zonaNome ?? h('span', { class: 'badge badge-warn' }, 'Da indicare')),
            h('td', null, badgeStato(p.stato)),
            h('td', { class: 'num forte' }, eur(p.compensoTotaleCent)));
        }))))
      : h('div', { class: 'vuoto' }, icona('archive', { dimensione: 40 }), h('strong', null, 'Nessuna pratica da mostrare'), h('p', null, m.pratiche.length ? 'Nessuna pratica corrisponde ai filtri di zona e collaboratore.' : 'Quando inserirai la prima pratica la vedrai qui.'),
        m.pratiche.length ? null : h('a', { class: 'btn btn-primario', href: '#/nuova' }, icona('plus', { dimensione: 16 }), 'Nuova pratica'));
    const cardUltime = h('section', { class: 'card', 'aria-labelledby': 'ult-titolo' },
      h('div', { class: 'card-testa' }, h('div', null, h('h2', { id: 'ult-titolo' }, 'Ultime pratiche'), h('p', null, 'Inserite o modificate di recente · clic su una riga per aprire la scheda')), h('a', { class: 'btn btn-secondario btn-sm', href: '#/pratiche' }, 'Vedi archivio')),
      h('div', { style: { marginTop: '8px' } }, tabellaUltime));

    const corpoAvvisi = h('div', { class: 'card-corpo', style: { paddingTop: '12px' } }, h('p', { class: 'sottotesto' }, 'Controllo in corso…'));
    const titoloAvvisi = h('h2', { id: 'avv-titolo' }, 'Avvisi');
    const cardAvvisi = h('section', { class: 'card', 'aria-labelledby': 'avv-titolo', id: 'avvisi' },
      h('div', { class: 'card-testa' }, h('div', null, titoloAvvisi, h('p', null, 'Segnalazioni automatiche, mai bloccanti'))), corpoAvvisi);
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
        h('div', null, h('h1', null, 'Dashboard'), h('p', null, `Panoramica dell'agenzia · ${descrizioneFiltri(ctx)}`))),
      primiPassi,
      riquadri,
      h('div', { style: { marginTop: '24px' } }, operazioni),
      h('div', { style: { marginTop: '24px' } }, grafici),
      basso,
    );
    return { distruggi() { vivo = false; schede.forEach((x) => x.distruggi()); } };
  },
};
