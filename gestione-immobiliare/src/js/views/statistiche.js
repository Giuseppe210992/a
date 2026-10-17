// Statistiche e grafici: analisi mensili e annuali di attivita' e risultati economici.
import { h, monta } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, contesto } from '../core/app.js';
import { eur, eurInt, eurCompatto, num, pct, pctSegno } from '../core/format.js';
import {
  serieTemporale, perCollaboratore, perZona, indicatori, riepilogo,
} from '../data/calc/aggregati.js';
import { csvTabella, codificaTesto, nomeFile } from '../data/esporta.js';
import { creaSchedaGrafico } from '../components/scheda-grafico.js';
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
      tessera('Compenso medio per pratica', ind.compensoMedioCent === null ? '—' : eurInt(ind.compensoMedioCent), 'Senza IVA'),
      tessera('Prezzo medio di vendita', ind.prezzoMedioCent === null ? '—' : eurInt(ind.prezzoMedioCent), 'Pratiche concluse con prezzo'),
      tessera('Margine dell\'agenzia', eurInt(margine), r.compensiCent ? `${pct(Math.round((margine / r.compensiCent) * 1000) / 10)} dei compensi, prima dei costi` : 'Compensi meno provvigioni')));

    // ---- grafici
    const gCompInc = scheda('compensi-incassi', 'Compensi e incassi', `Compensi di competenza (rogito) e incassi ricevuti (data del pagamento), ${etichettaVista}`, montaLinee, { largo: true, conTotali: true });
    const sCo = serieTemporale(m, ctx, { granularita: gran, metrica: 'compensi' });
    const sIn = serieTemporale(m, ctx, { granularita: gran, metrica: 'incassi' });
    gCompInc.aggiorna({
      spec: { titolo: 'Compensi e incassi', categorie: cat(sCo), serie: [{ id: 'co', nome: 'Compensi (imponibile)', colore: 1, valori: sCo.serie[0].valori }, { id: 'in', nome: 'Incassi (IVA inclusa)', colore: 2, valori: sIn.serie[0]?.valori ?? sCo.serie[0].valori.map(() => 0) }], formato: FORMATO_EURO, altezza: 270, nomeCategorie: nomeCat, totali: { co: sCo.serie[0].totale, in: sIn.serie[0]?.totale ?? 0 } },
      cifre: [{ etichetta: 'Compensi', valore: eur(r.compensiCent) }, { etichetta: 'Incassi nel periodo', valore: eur(sIn.serie[0]?.totale ?? 0) }],
      nota: 'I compensi sono senza IVA e seguono il giorno della pratica; gli incassi comprendono l\'IVA e seguono la data del pagamento: per questo i due numeri non coincidono.',
      vuoto: sCo.serie[0].totale === 0 && (sIn.serie[0]?.totale ?? 0) === 0 ? 'Nessun compenso né incasso nel periodo.' : null,
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

    // ---- tabella riepilogativa (solo numeri)
    const sCn = serieTemporale(m, ctx, { granularita: gran, metrica: 'concluse' });
    const sVa = serieTemporale(m, ctx, { granularita: gran, metrica: 'valore' });
    const sPr = serieTemporale(m, ctx, { granularita: gran, metrica: 'provvigioniCalcolate' });
    const sMg = serieTemporale(m, ctx, { granularita: gran, metrica: 'margine' });
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
      h('div', { class: 'grafici-contenitore', style: { marginTop: '20px' } }, h('h2', { class: 'solo-lettori' }, 'Grafici'), h('div', { class: 'grafici-griglia' }, gCompInc.el, gZone.el, gColl.el)),
      tabella);
    return { distruggi() { schede.forEach((s) => s.distruggi()); } };
  },
};
export { pctSegno };
