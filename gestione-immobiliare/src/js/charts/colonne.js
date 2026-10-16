// Grafico a colonne: una serie, serie affiancate o impilate. Le colonne fuori dal periodo scelto
// restano visibili ma attenuate (dato di contesto), cosi' non si ottiene mai un grafico con una sola barra.
import { h, s } from '../core/dom.js';
import { scalaVerticale, larghezzaTesto, barraVerticale, creaTooltip, creaLegenda, montaGrafico } from './base.js';

const SPESSORE_MAX = 24;
const DISTANZA = 2; // spazio di superficie tra barre vicine

function disegna(host, spec, W, stato, ridisegna) {
  const H = spec.altezza || 260;
  const cat = spec.categorie;
  const n = cat.length;
  const serie = spec.serie.filter((sr) => !stato.nascoste.has(sr.id));
  const fmtAsse = spec.formato.asse;
  const fmtVal = spec.formato.valore;
  const fmtBreve = spec.formato.breve || fmtAsse;

  const totaleDi = (i) => serie.reduce((a, sr) => a + (sr.valori[i] || 0), 0);
  let max = 0;
  for (let i = 0; i < n; i++) {
    if (spec.impilato) max = Math.max(max, serie.reduce((a, sr) => a + Math.max(0, sr.valori[i] || 0), 0));
    else for (const sr of serie) max = Math.max(max, sr.valori[i] || 0);
  }
  const scala = scalaVerticale(max, { intero: spec.formato.intero });
  const larghEtichY = Math.max(...scala.tacche.map((t) => larghezzaTesto(fmtAsse(t), 12)));
  const m = { sx: Math.ceil(larghEtichY) + 16, dx: 10, su: 24, giu: 30 };
  const innerW = Math.max(40, W - m.sx - m.dx);
  const innerH = H - m.su - m.giu;
  const banda = innerW / Math.max(1, n);
  const yBase = m.su + innerH;
  const y = (v) => m.su + innerH * (1 - v / scala.max);

  const legenda = creaLegenda(spec.serie, stato.nascoste, ridisegna);
  const area = h('div', { class: 'g-area', style: { height: `${H}px` } });
  const svg = s('svg', {
    class: 'g-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
    role: 'group', 'aria-roledescription': 'grafico', 'aria-label': `${spec.titolo}. Usa le frecce per scorrere i valori.`, tabindex: '0',
  });
  const tt = creaTooltip(area);

  // griglia e asse verticale (filetti)
  for (const t of scala.tacche) {
    const yy = y(t);
    svg.append(s('line', { class: t === 0 ? 'g-asse' : 'g-griglia', x1: m.sx, x2: W - m.dx, y1: yy, y2: yy }));
    svg.append(s('text', { class: 'g-testo', x: m.sx - 8, y: yy + 4, 'text-anchor': 'end' }, fmtAsse(t)));
  }

  // etichette dell'asse orizzontale: sempre l'ultima, saltando quelle che non entrano
  const maxEtic = Math.max(...cat.map((c) => larghezzaTesto(c.etichetta, 12)), 10);
  const passo = Math.max(1, Math.ceil((maxEtic + 10) / banda));
  cat.forEach((c, i) => {
    if ((n - 1 - i) % passo !== 0) return;
    svg.append(s('text', { class: `g-testo${c.dim ? ' g-dim-testo' : ''}`, x: m.sx + banda * (i + 0.5), y: yBase + 19, 'text-anchor': 'middle' }, c.etichetta));
  });

  // quali colonne ricevono il valore scritto: poche se sono molte
  const indiciPeriodo = cat.map((c, i) => (c.dim ? -1 : i)).filter((i) => i >= 0);
  let conValore = new Set();
  const valoreDi = (i) => (spec.impilato || serie.length === 1 ? totaleDi(i) : null);
  if (serie.length === 1 || spec.impilato) {
    if (indiciPeriodo.length <= 6 && banda >= 46) conValore = new Set(indiciPeriodo);
    else if (indiciPeriodo.length) {
      let imax = indiciPeriodo[0];
      for (const i of indiciPeriodo) if ((valoreDi(i) || 0) > (valoreDi(imax) || 0)) imax = i;
      conValore = new Set([imax, indiciPeriodo[indiciPeriodo.length - 1]]);
    }
  }

  const bande = [];
  const gruppi = [];
  for (let i = 0; i < n; i++) {
    const x0 = m.sx + banda * i;
    bande.push(svg.appendChild(s('rect', { class: 'g-banda', x: x0, y: m.su - 6, width: banda, height: innerH + 6, rx: 6 })));
  }
  for (let i = 0; i < n; i++) {
    const x0 = m.sx + banda * i;
    const g = s('g', { class: `g-colonna${cat[i].dim ? ' g-dim' : ''}` });
    if (!spec.impilato) {
      const k = Math.max(1, serie.length);
      const gruppoW = Math.min(banda * 0.82, k * SPESSORE_MAX + (k - 1) * DISTANZA);
      const w = (gruppoW - (k - 1) * DISTANZA) / k;
      const xg = x0 + (banda - gruppoW) / 2;
      serie.forEach((sr, j) => {
        const v = sr.valori[i] || 0;
        if (v <= 0) return;
        const hh = Math.max(2, innerH * (v / scala.max));
        g.append(s('path', { class: `g-barra g-serie-${sr.colore}`, d: barraVerticale(xg + j * (w + DISTANZA), yBase - hh, w, hh) }));
      });
      if (serie.length === 1 && conValore.has(i) && (serie[0].valori[i] || 0) > 0) {
        const hh = innerH * (serie[0].valori[i] / scala.max);
        g.append(s('text', { class: 'g-valore', x: x0 + banda / 2, y: yBase - hh - 6, 'text-anchor': 'middle' }, fmtBreve(serie[0].valori[i])));
      }
    } else {
      const w = Math.min(SPESSORE_MAX, banda * 0.62);
      const x = x0 + (banda - w) / 2;
      const attivi = serie.filter((sr) => (sr.valori[i] || 0) > 0);
      let acc = 0;
      attivi.forEach((sr, j) => {
        const v = sr.valori[i];
        const sotto = innerH * (acc / scala.max);
        const sopra = innerH * ((acc + v) / scala.max);
        acc += v;
        const ultima = j === attivi.length - 1;
        // 2px di superficie tra un segmento e il successivo
        const top = yBase - sopra + (ultima ? 0 : 1);
        const bot = yBase - sotto - (j === 0 ? 0 : 1);
        const hh = Math.max(2, bot - top);
        g.append(s('path', { class: `g-barra g-serie-${sr.colore}`, d: barraVerticale(x, bot - hh, w, hh, { arrotonda: ultima }) }));
      });
      if (conValore.has(i) && acc > 0) {
        g.append(s('text', { class: 'g-valore', x: x0 + banda / 2, y: yBase - innerH * (acc / scala.max) - 6, 'text-anchor': 'middle' }, fmtBreve(acc)));
      }
    }
    svg.append(g);
    gruppi.push(g);
  }

  // area sensibile: tutta la colonna (piu' grande della barra)
  const attiva = (i, daTastiera = false) => {
    if (stato.attivo >= 0 && bande[stato.attivo]) { bande[stato.attivo].classList.remove('g-attiva'); gruppi[stato.attivo].classList.remove('g-lift'); }
    stato.attivo = i;
    if (i < 0) { tt.nascondi(); return; }
    bande[i].classList.add('g-attiva');
    gruppi[i].classList.add('g-lift');
    const c = cat[i];
    const righe = serie.map((sr) => ({ colore: sr.colore, nome: sr.nome, valore: fmtVal(sr.valori[i] || 0) }));
    if (serie.length > 1) righe.push({ nome: 'Totale', valore: fmtVal(totaleDi(i)) });
    const alto = Math.max(...serie.map((sr) => sr.valori[i] || 0), spec.impilato ? totaleDi(i) : 0);
    const yy = Math.max(m.su, yBase - innerH * ((spec.impilato ? totaleDi(i) : alto) / scala.max));
    tt.mostra(m.sx + banda * (i + 0.5), yy, c.etichettaLunga || c.etichetta, righe, c.dim ? 'Fuori dal periodo selezionato' : null);
    void daTastiera;
  };
  for (let i = 0; i < n; i++) {
    const hit = s('rect', { class: 'g-hit', x: m.sx + banda * i, y: 0, width: banda, height: H });
    hit.addEventListener('pointerenter', () => attiva(i));
    hit.addEventListener('pointermove', () => { if (stato.attivo !== i) attiva(i); });
    svg.append(hit);
  }
  svg.addEventListener('pointerleave', () => attiva(-1));
  svg.addEventListener('blur', () => attiva(-1));
  svg.addEventListener('focus', () => { if (stato.attivo < 0 && indiciPeriodo.length) attiva(indiciPeriodo[indiciPeriodo.length - 1], true); });
  svg.addEventListener('keydown', (ev) => {
    const corrente = stato.attivo < 0 ? n - 1 : stato.attivo;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); attiva(Math.min(n - 1, corrente + 1), true); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); attiva(Math.max(0, corrente - 1), true); }
    else if (ev.key === 'Home') { ev.preventDefault(); attiva(0, true); }
    else if (ev.key === 'End') { ev.preventDefault(); attiva(n - 1, true); }
    else if (ev.key === 'Escape') { attiva(-1); }
  });

  area.append(svg);
  if (max === 0 && spec.messaggioVuoto) {
    area.append(h('div', { class: 'g-vuoto-sovrapposto' }, spec.messaggioVuoto));
  }
  host.append(...(legenda ? [legenda] : []), area);
  if (stato.attivo >= 0 && stato.attivo < n) attiva(stato.attivo);
}

export function montaColonne(host) {
  return montaGrafico(host, disegna);
}
