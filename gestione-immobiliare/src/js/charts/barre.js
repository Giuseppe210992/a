// Barre orizzontali impilate (es. provvigioni liquidate + da liquidare per collaboratore).
import { h, s } from '../core/dom.js';
import { scalaVerticale, larghezzaTesto, tronca, barraOrizzontale, creaTooltip, creaLegenda, montaGrafico } from './base.js';

const SPESSORE = 22;
const DISTANZA = 2;

function disegna(host, spec, W, stato, ridisegna) {
  const cat = spec.categorie;
  const n = cat.length;
  const serie = spec.serie.filter((sr) => !stato.nascoste.has(sr.id));
  const fmtAsse = spec.formato.asse;
  const fmtVal = spec.formato.valore;
  const fmtBreve = spec.formato.breve || fmtAsse;

  const totaleDi = (i) => serie.reduce((a, sr) => a + Math.max(0, sr.valori[i] || 0), 0);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, totaleDi(i));
  const scala = scalaVerticale(max, { intero: spec.formato.intero, tacche: W < 420 ? 3 : 4 });

  const righeH = 46;
  const H = 18 + n * righeH + 32;
  const larghNomi = Math.min(Math.max(...cat.map((c) => larghezzaTesto(c.etichetta, 13, 600)), 40), W * 0.34);
  const larghTotale = Math.max(...cat.map((_, i) => larghezzaTesto(fmtBreve(totaleDi(i)), 12, 650)), 30) + 10;
  const m = { sx: Math.ceil(larghNomi) + 14, dx: larghTotale + 8, su: 10 };
  const innerW = Math.max(40, W - m.sx - m.dx);
  const x = (v) => m.sx + innerW * (v / scala.max);

  const legenda = creaLegenda(spec.serie, stato.nascoste, ridisegna);
  const area = h('div', { class: 'g-area', style: { height: `${H}px` } });
  const svg = s('svg', {
    class: 'g-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
    role: 'group', 'aria-roledescription': 'grafico', 'aria-label': `${spec.titolo}. Usa le frecce per scorrere le righe.`, tabindex: '0',
  });
  const tt = creaTooltip(area);
  const yAsse = m.su + n * righeH;

  for (const t of scala.tacche) {
    svg.append(s('line', { class: t === 0 ? 'g-asse' : 'g-griglia', x1: x(t), x2: x(t), y1: m.su, y2: yAsse }));
    svg.append(s('text', { class: 'g-testo', x: x(t), y: yAsse + 18, 'text-anchor': t === 0 ? 'start' : 'middle' }, fmtAsse(t)));
  }

  const bande = [];
  cat.forEach((c, i) => {
    const y0 = m.su + i * righeH;
    bande.push(svg.appendChild(s('rect', { class: 'g-banda', x: 0, y: y0 + 2, width: W, height: righeH - 4, rx: 8 })));
  });
  cat.forEach((c, i) => {
    const y0 = m.su + i * righeH;
    const yb = y0 + (righeH - SPESSORE) / 2;
    svg.append(s('text', { class: 'g-testo g-testo-forte', x: 6, y: y0 + righeH / 2 + 4.5 }, tronca(c.etichetta, larghNomi, 13, 600)));
    const attivi = serie.filter((sr) => (sr.valori[i] || 0) > 0);
    let acc = 0;
    attivi.forEach((sr, j) => {
      const v = sr.valori[i];
      const xa = x(acc) + (j === 0 ? 0 : DISTANZA / 2);
      const xb = x(acc + v) - (j === attivi.length - 1 ? 0 : DISTANZA / 2);
      acc += v;
      const lung = Math.max(2, xb - xa);
      svg.append(s('path', { class: `g-barra g-serie-${sr.colore}`, d: barraOrizzontale(xa, yb, lung, SPESSORE, { arrotonda: j === attivi.length - 1 }) }));
      const testo = fmtBreve(v);
      // il valore dentro il segmento solo se entra con margine; altrimenti resta nel suggerimento e nella tabella
      if (serie.length > 1 && lung > larghezzaTesto(testo, 12, 650) + 16) {
        svg.append(s('text', { class: `g-su-barra g-su-${sr.colore}`, x: xa + lung / 2, y: yb + SPESSORE / 2 + 4, 'text-anchor': 'middle' }, testo));
      }
    });
    svg.append(s('text', { class: 'g-valore', x: x(acc) + 8, y: yb + SPESSORE / 2 + 4, 'text-anchor': 'start' }, fmtBreve(acc)));
  });

  const attiva = (i) => {
    if (stato.attivo >= 0 && bande[stato.attivo]) bande[stato.attivo].classList.remove('g-attiva');
    stato.attivo = i;
    if (i < 0) { tt.nascondi(); return; }
    bande[i].classList.add('g-attiva');
    const righe = serie.map((sr) => ({ colore: sr.colore, nome: sr.nome, valore: fmtVal(sr.valori[i] || 0) }));
    if (serie.length > 1) righe.push({ nome: 'Totale', valore: fmtVal(totaleDi(i)) });
    tt.mostra(Math.min(W - 30, x(totaleDi(i))), m.su + i * righeH + righeH / 2, cat[i].etichettaLunga || cat[i].etichetta, righe);
  };
  cat.forEach((_, i) => {
    const hit = s('rect', { class: 'g-hit', x: 0, y: m.su + i * righeH, width: W, height: righeH });
    hit.addEventListener('pointerenter', () => attiva(i));
    hit.addEventListener('pointermove', () => { if (stato.attivo !== i) attiva(i); });
    svg.append(hit);
  });
  svg.addEventListener('pointerleave', () => attiva(-1));
  svg.addEventListener('blur', () => attiva(-1));
  svg.addEventListener('focus', () => { if (stato.attivo < 0 && n) attiva(0); });
  svg.addEventListener('keydown', (ev) => {
    const c = stato.attivo < 0 ? 0 : stato.attivo;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); attiva(Math.min(n - 1, c + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); attiva(Math.max(0, c - 1)); }
    else if (ev.key === 'Home') { ev.preventDefault(); attiva(0); }
    else if (ev.key === 'End') { ev.preventDefault(); attiva(n - 1); }
    else if (ev.key === 'Escape') attiva(-1);
  });

  area.append(svg);
  host.append(...(legenda ? [legenda] : []), area);
  if (stato.attivo >= 0 && stato.attivo < n) attiva(stato.attivo);
}

export function montaBarre(host) {
  return montaGrafico(host, disegna);
}
