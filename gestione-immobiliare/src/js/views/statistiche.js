// Statistiche e grafici: analisi mensili e annuali di attivita' e risultati economici.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto } from '../core/app.js';
import { eur, eurInt, eurCompatto, num, pct, pctSegno } from '../core/format.js';
import {
  serieTemporale, perCollaboratore, perZona, perTipologia, indicatori, riepilogo,
} from '../data/calc/aggregati.js';
import { csvTabella, codificaTesto, nomeFile } from '../data/esporta.js';
import { creaSchedaGrafico } from '../components/scheda-grafico.js';
import { montaColonne } from '../charts/colonne.js';
import { montaBarre } from '../charts/barre.js';
import { montaLinee } from '../charts/linee.js';
import { ok as notificaOk } from '../core/ui.js';

const FORMATO_EURO = { asse: eurCompatto, valore: eur, breve: eurCompatto, intero: false };
const FORMATO_NUM = { asse: num, valore: num, breve: num, intero: true };

export const statistiche = {
  id: 'statistiche', titolo: 'Statistiche e grafici',
  filtri: { zona: true, collaboratore: true, granularita: true },
  monta(contenitore) {
    const m = modello();
    const ctx = contesto();
    const gran = ctx.granularita;
    const etichettaVista = gran === 'annuale' ? 'per anno' : 'per mese';
    const nomeCat = gran === 'annuale' ? 'Anno' : 'Mese';
    const schede = [];
    const scheda = (id, titolo, sotto, fn, opz = {}) => { const s = creaSchedaGrafico({ id, titolo, sottotitolo: sotto, montaFn: fn, ...opz }); schede.push(s); return s; };
    const cat = (sr) => sr.intervalli.map((i) => ({ chiave: i.chiave, etichetta: i.etichetta, etichettaLunga: i.etichettaLunga, dim: !i.inPeriodo }));
    const tot = (sr) => Object.fromEntries(sr.serie.map((x) => [x.id, x.totale]));

    const r = riepilogo(m, ctx);
    const ind = indicatori(m, ctx);
    const margine = r.compensiCent - r.provvigioniCent;

    // ---- indicatori
    const tessera = (etichetta, valore, nota) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-etichetta' }, etichetta), h('div', { class: 'kpi-valore' }, valore), nota ? h('div', { class: 'kpi-nota' }, nota) : null);
    const indicatoriEl = h('div', { class: 'kpi-contenitore' }, h('section', { class: 'kpi-griglia', 'aria-label': 'Indicatori del periodo', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' } },
      tessera('Tempo medio di chiusura', ind.giorniMediChiusura === null ? '—' : `${num(Math.round(ind.giorniMediChiusura))} giorni`, 'Dall\'apertura al rogito'),
      tessera('Prezzo medio di vendita', ind.prezzoMedioCent === null ? '—' : eurInt(ind.prezzoMedioCent), 'Pratiche concluse con prezzo'),
      tessera('Compenso medio per pratica', ind.compensoMedioCent === null ? '—' : eurInt(ind.compensoMedioCent), 'Imponibile'),
      tessera('Compenso sul prezzo di vendita', ind.incidenzaCompensoPct === null ? '—' : pct(Math.round(ind.incidenzaCompensoPct * 100) / 100), 'Compensi / prezzi di vendita'),
      tessera('Margine di agenzia', eurInt(margine), r.compensiCent ? `${pct(Math.round((margine / r.compensiCent) * 1000) / 10)} dei compensi, prima dei costi` : 'Compensi meno provvigioni')));

    // ---- grafici
    const gCompInc = scheda('compensi-incassi', 'Compensi e incassi', `Compensi di competenza (rogito) e incassi ricevuti (data del pagamento), ${etichettaVista}`, montaLinee, { largo: true, conTotali: true });
    const sCo = serieTemporale(m, ctx, { granularita: gran, metrica: 'compensi' });
    const sIn = serieTemporale(m, ctx, { granularita: gran, metrica: 'incassi' });
    gCompInc.aggiorna({
      spec: { titolo: 'Compensi e incassi', categorie: cat(sCo), serie: [{ id: 'co', nome: 'Compensi (imponibile)', colore: 1, valori: sCo.serie[0].valori }, { id: 'in', nome: 'Incassi (IVA inclusa)', colore: 2, valori: sIn.serie[0]?.valori ?? sCo.serie[0].valori.map(() => 0) }], formato: FORMATO_EURO, altezza: 270, nomeCategorie: nomeCat, totali: { co: sCo.serie[0].totale, in: sIn.serie[0]?.totale ?? 0 } },
      cifre: [{ etichetta: 'Compensi', valore: eur(r.compensiCent) }, { etichetta: 'Incassi nel periodo', valore: eur(sIn.serie[0]?.totale ?? 0) }],
      nota: 'Le due serie non sono confrontabili riga per riga: i compensi sono senza IVA e seguono il rogito, gli incassi sono quelli ricevuti (contanti già senza IVA, bonifico e assegno con IVA compresa) e seguono la data del pagamento.',
      vuoto: sCo.serie[0].totale === 0 && (sIn.serie[0]?.totale ?? 0) === 0 ? 'Nessun compenso né incasso nel periodo.' : null,
    });

    const gConcl = scheda('concluse', 'Compravendite concluse', `Numero di rogiti, ${etichettaVista}`, montaColonne);
    const sCn = serieTemporale(m, ctx, { granularita: gran, metrica: 'concluse' });
    gConcl.aggiorna({ spec: { titolo: 'Compravendite concluse', categorie: cat(sCn), serie: sCn.serie.map((x) => ({ ...x, colore: 1, nome: 'Compravendite' })), formato: FORMATO_NUM, altezza: 250, nomeCategorie: nomeCat, totali: tot(sCn) }, cifre: [{ etichetta: 'Nel periodo', valore: num(r.concluse) }], vuoto: sCn.serie[0].totale === 0 ? 'Nessuna compravendita conclusa.' : null });

    const gVal = scheda('valore', 'Valore degli immobili venduti', `Somma dei prezzi di vendita, ${etichettaVista}`, montaColonne);
    const sVa = serieTemporale(m, ctx, { granularita: gran, metrica: 'valore' });
    gVal.aggiorna({ spec: { titolo: 'Valore degli immobili venduti', categorie: cat(sVa), serie: sVa.serie.map((x) => ({ ...x, colore: 1, nome: 'Valore venduto' })), formato: FORMATO_EURO, altezza: 250, nomeCategorie: nomeCat, totali: tot(sVa) }, cifre: [{ etichetta: 'Nel periodo', valore: eurInt(r.valoreVendutoCent) }], vuoto: sVa.serie[0].totale === 0 ? 'Nessun immobile venduto.' : null });

    const gMarg = scheda('margine', 'Provvigioni e margine di agenzia', `Come si divide il compenso: provvigioni ai collaboratori e margine, ${etichettaVista}`, montaColonne, { conTotali: true, largo: true });
    const sPr = serieTemporale(m, ctx, { granularita: gran, metrica: 'provvigioniCalcolate' });
    const sMg = serieTemporale(m, ctx, { granularita: gran, metrica: 'margine' });
    gMarg.aggiorna({
      spec: { titolo: 'Provvigioni e margine di agenzia', impilato: true, categorie: cat(sPr), serie: [{ id: 'pv', nome: 'Provvigioni ai collaboratori', colore: 'o1', valori: sPr.serie[0].valori }, { id: 'mg', nome: 'Margine di agenzia', colore: 'o2', valori: sMg.serie[0].valori }], formato: FORMATO_EURO, altezza: 260, nomeCategorie: nomeCat, totali: { pv: sPr.serie[0].totale, mg: sMg.serie[0].totale } },
      cifre: [{ etichetta: 'Provvigioni', valore: eurInt(sPr.serie[0].totale) }, { etichetta: 'Margine', valore: eurInt(sMg.serie[0].totale) }],
      nota: 'Provvigioni e margine sommati danno i compensi del periodo (imponibile). I costi di gestione non sono compresi.',
      vuoto: sPr.serie[0].totale === 0 && sMg.serie[0].totale === 0 ? 'Nessun compenso nel periodo.' : null,
    });

    const pz = perZona(m, ctx).filter((z) => z.fatturatoCent > 0 || z.pratiche > 0);
    const gZone = scheda('per-zona', 'Compensi per zona', 'Nel periodo selezionato', montaBarre);
    gZone.aggiorna({
      spec: { titolo: 'Compensi per zona', nomeCategorie: 'Zona', categorie: pz.map((z) => ({ chiave: z.id, etichetta: z.nome, etichettaLunga: `${z.nome} · ${z.pratiche} pratiche` })), serie: [{ id: 'f', nome: 'Compensi', colore: 1, valori: pz.map((z) => z.fatturatoCent) }], formato: FORMATO_EURO },
      cifre: pz.length ? [{ etichetta: 'Zone con attività', valore: num(pz.length) }] : null,
      vuoto: pz.length ? null : 'Nessuna attività per zona nel periodo.',
    });

    const pc = perCollaboratore(m, ctx).filter((c) => c.fatturatoCent > 0 || c.pratiche > 0);
    const gColl = scheda('per-collaboratore', 'Compensi per collaboratore', 'Fatturato attribuito (quota di ciascuno) nel periodo', montaBarre);
    gColl.aggiorna({
      spec: { titolo: 'Compensi per collaboratore', nomeCategorie: 'Collaboratore', categorie: pc.map((c) => ({ chiave: c.id, etichetta: c.nome, etichettaLunga: `${c.nome} · ${c.pratiche} pratiche` })), serie: [{ id: 'f', nome: 'Fatturato attribuito', colore: 1, valori: pc.map((c) => c.fatturatoCent) }], formato: FORMATO_EURO },
      cifre: pc.length ? [{ etichetta: 'Collaboratori attivi', valore: num(pc.length) }] : null,
      vuoto: pc.length ? null : 'Nessuna attività per collaboratore nel periodo.',
    });

    const tp = perTipologia(m, ctx);
    const gTipo = scheda('per-tipo', 'Pratiche per tipo di immobile', 'Numero di compravendite concluse nel periodo', montaBarre);
    gTipo.aggiorna({
      spec: { titolo: 'Pratiche per tipo di immobile', nomeCategorie: 'Tipo', categorie: tp.map((t) => ({ chiave: t.nome, etichetta: t.nome, etichettaLunga: `${t.nome} · compensi ${eur(t.compensiCent)}` })), serie: [{ id: 'n', nome: 'Pratiche', colore: 1, valori: tp.map((t) => t.pratiche) }], formato: FORMATO_NUM },
      vuoto: tp.length ? null : 'Nessuna compravendita nel periodo.',
    });

    // ---- tabella riepilogativa
    const intervalli = sCo.intervalli;
    const righe = intervalli.map((iv, i) => ({
      etichetta: iv.etichettaLunga, inPeriodo: iv.inPeriodo,
      concluse: sCn.serie[0].valori[i], compensi: sCo.serie[0].valori[i], incassi: sIn.serie[0]?.valori[i] ?? 0,
      provvigioni: sPr.serie[0].valori[i], margine: sMg.serie[0].valori[i], valore: sVa.serie[0].valori[i],
    })).filter((x) => x.inPeriodo);
    const somma = (k) => righe.reduce((s, x) => s + x[k], 0);
    const tabella = h('section', { class: 'card', style: { marginTop: '16px' }, 'aria-labelledby': 'tab-riep' },
      h('div', { class: 'card-testa' }, h('div', null, h('h2', { id: 'tab-riep' }, 'Riepilogo numerico'), h('p', null, `Valori del periodo ${etichettaVista}`)),
        h('button', { type: 'button', class: 'btn btn-secondario btn-sm', id: 'esporta-statistiche', onclick: async () => {
          const csv = csvTabella(['Periodo', 'Concluse', 'Compensi', 'Incassi', 'Provvigioni', 'Margine', 'Valore venduto'].map((x) => x), righe.map((x) => [x.etichetta, x.concluse, (x.compensi / 100).toFixed(2).replace('.', ','), (x.incassi / 100).toFixed(2).replace('.', ','), (x.provvigioni / 100).toFixed(2).replace('.', ','), (x.margine / 100).toFixed(2).replace('.', ','), (x.valore / 100).toFixed(2).replace('.', ',')]));
          const rr = await app.driver.esportaFile(codificaTesto(csv), nomeFile('Statistiche', 'csv'), 'text/csv;charset=utf-8');
          if (rr && rr.salvato !== false) notificaOk('Statistiche esportate in CSV.');
        } }, icona('download', { dimensione: 15 }), 'Esporta in CSV')),
      h('div', { class: 'tabella-wrap', style: { marginTop: '8px' } }, h('table', { class: 'tabella tabella-compatta', id: 'tabella-statistiche' },
        h('thead', null, h('tr', null, h('th', null, nomeCat), h('th', { class: 'num' }, 'Concluse'), h('th', { class: 'num' }, 'Compensi'), h('th', { class: 'num' }, 'Incassi'), h('th', { class: 'num' }, 'Provvigioni'), h('th', { class: 'num' }, 'Margine'), h('th', { class: 'num' }, 'Valore venduto'))),
        h('tbody', null, righe.map((x) => h('tr', null, h('th', { scope: 'row', style: { textAlign: 'left', fontWeight: 600 } }, x.etichetta), h('td', { class: 'num' }, num(x.concluse)), h('td', { class: 'num' }, eur(x.compensi)), h('td', { class: 'num' }, eur(x.incassi)), h('td', { class: 'num' }, eur(x.provvigioni)), h('td', { class: 'num' }, eur(x.margine)), h('td', { class: 'num' }, eur(x.valore))))),
        h('tfoot', null, h('tr', null, h('td', null, 'Totale'), h('td', { class: 'num' }, num(somma('concluse'))), h('td', { class: 'num' }, eur(somma('compensi'))), h('td', { class: 'num' }, eur(somma('incassi'))), h('td', { class: 'num' }, eur(somma('provvigioni'))), h('td', { class: 'num' }, eur(somma('margine'))), h('td', { class: 'num' }, eur(somma('valore'))))))));

    monta(contenitore,
      h('div', { class: 'pagina-testa' }, h('div', null, h('h1', null, 'Statistiche e grafici'), h('p', null, `Analisi ${gran === 'annuale' ? 'annuali' : 'mensili'} di attività e risultati economici · ${ctx.periodo.etichetta}`))),
      indicatoriEl,
      h('div', { class: 'grafici-contenitore', style: { marginTop: '20px' } }, h('h2', { class: 'solo-lettori' }, 'Grafici'), h('div', { class: 'grafici-griglia' }, gCompInc.el, gConcl.el, gVal.el, gMarg.el, gZone.el, gColl.el, gTipo.el)),
      tabella);
    return { distruggi() { schede.forEach((s) => s.distruggi()); } };
  },
};
export { pctSegno };
