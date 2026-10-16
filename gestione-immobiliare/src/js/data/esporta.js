// Esportazione in CSV (apribile con Excel italiano: separatore ";", virgola decimale, UTF-8 con BOM).
import { csvCampo, csvEuro, dataIt } from '../core/format.js';
import { ETICHETTA_STATO } from './repo/pratiche.js';

const BOM = '﻿';

function creaCsv(intestazioni, righe) {
  const out = [intestazioni.map(csvCampo).join(';')];
  for (const r of righe) out.push(r.map(csvCampo).join(';'));
  return BOM + out.join('\r\n') + '\r\n';
}

export function csvPratiche(modello, pratiche = modello.pratiche) {
  const nomeCollab = new Map(modello.collaboratori.map((c) => [c.id, c.nome]));
  const intestazioni = [
    'Codice', 'Stato', 'Data apertura', 'Data rogito', 'Zona', 'Indirizzo', 'Comune', 'Tipo immobile',
    'Prezzo di vendita', 'Prezzo di acquisto', 'Venditore', 'Acquirente',
    'Compenso venditore', 'Compenso acquirente', 'Totale compensi (imponibile)', 'Aliquota IVA %', 'IVA', 'Totale con IVA',
    'Incassato', 'Da incassare', 'Collaboratori e quote', 'Provvigioni calcolate', 'Provvigioni maturate',
    'Provvigioni liquidate', 'Provvigioni da liquidare', 'Dati mancanti', 'Note',
  ];
  const righe = pratiche.map((p) => [
    p.codice, ETICHETTA_STATO[p.stato] ?? p.stato, dataIt(p.data_pratica), p.data_rogito ? dataIt(p.data_rogito) : '',
    p.zonaNome ?? '', p.immobile_indirizzo, p.immobile_comune ?? '', p.immobile_tipo ?? '',
    csvEuro(p.prezzo_vendita_cent), csvEuro(p.prezzo_acquisto_cent), p.venditore ?? '', p.acquirente ?? '',
    csvEuro(p.compenso_venditore_cent), csvEuro(p.compenso_acquirente_cent), csvEuro(p.compensoTotaleCent),
    String(p.aliquota_iva).replace('.', ','), csvEuro(p.ivaCent), csvEuro(p.totaleLordoCent),
    csvEuro(p.incassatoCent), csvEuro(p.daIncassareCent),
    p.voci.filter((v) => v.collaboratoreId != null).map((v) => `${nomeCollab.get(v.collaboratoreId) ?? '?'} ${String(v.quotaPct).replace('.', ',')}%`).join(' / '),
    csvEuro(p.provvigioniCent), csvEuro(p.maturateCent), csvEuro(p.liquidateCent), csvEuro(p.daLiquidareCent),
    p.mancanti.map((m) => m.testo).join(' | '), p.note ?? '',
  ]);
  return creaCsv(intestazioni, righe);
}

export function csvProvvigioni(modello, voci) {
  const nomeCollab = new Map(modello.collaboratori.map((c) => [c.id, c.nome]));
  const intestazioni = ['Codice pratica', 'Data rogito', 'Zona', 'Collaboratore', 'Quota %', 'Fatturato attribuito', 'Percentuale applicata', 'Provvigione calcolata', 'Maturata', 'Liquidata', 'Da liquidare'];
  const righe = voci.map(({ p, v }) => [
    p.codice, p.data_rogito ? dataIt(p.data_rogito) : '', p.zonaNome ?? '', nomeCollab.get(v.collaboratoreId) ?? 'Non assegnato',
    String(v.quotaPct).replace('.', ','), csvEuro(v.fatturatoCent), String(Math.round(v.percentualeApplicata * 100) / 100).replace('.', ','),
    csvEuro(v.provvigioneCent), csvEuro(v.maturataCent), csvEuro(v.liquidataCent), csvEuro(v.daLiquidareCent),
  ]);
  return creaCsv(intestazioni, righe);
}

export function csvIncassi(modello) {
  const intestazioni = ['Data', 'Codice pratica', 'Immobile', 'Importo (IVA inclusa)', 'Pagante', 'Metodo', 'Note'];
  const righe = modello.incassi.map((i) => [
    dataIt(i.data), i.pratica?.codice ?? '', i.pratica?.immobile_indirizzo ?? '', csvEuro(i.importo_cent), i.pagante ?? '', i.metodo ?? '', i.note ?? '',
  ]);
  return creaCsv(intestazioni, righe);
}

export function csvLiquidazioni(modello) {
  const intestazioni = ['Data', 'Collaboratore', 'Pratica', 'Importo', 'Metodo', 'Note'];
  const righe = [];
  for (const l of modello.liquidazioni) {
    for (const r of l.righe) {
      righe.push([dataIt(l.data), l.collaboratoreNome ?? '', r.pratica?.codice ?? '', csvEuro(r.importo_cent), l.metodo ?? '', l.note ?? '']);
    }
  }
  return creaCsv(intestazioni, righe);
}

export function csvTabella(intestazioni, righe) {
  return creaCsv(intestazioni, righe);
}

export function nomeFile(prefisso, estensione, data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefisso}_${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}.${estensione}`;
}

export function codificaTesto(testo) {
  return new TextEncoder().encode(testo);
}
