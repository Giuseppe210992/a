// Confronto "prima -> dopo" per elemento (prezzo di acquisto -> prezzo di vendita).
import { h, s } from '../core/dom.js';
import { scalaVerticale, larghezzaTesto, tronca, creaTooltip, montaGrafico } from './base.js';

const RIGA = 52;

function disegna(host, spec, W, stato) {
  const righe = spec.righe;
  const n = righe.length;
  const fmtAsse = spec.formato.asse;
  const fmtVal = spec.formato.valore;
  let max = 0;
  for (const r of righe) max = Math.max(max, r.a, r.b);
  const scala = scalaVerticale(max, { tacche: W < 480 ? 3 : 4 });

  const larghNomi = Math.min(Math.max(...righe.map((r) => Math.max(larghezzaTesto(r.etichetta, 13, 600), larghezzaTesto(r.sotto || '', 11.5, 400))), 40), Math.max(110, W * 0.32));
  const larghDelta = Math.max(...righe.map((r) => larghezzaTesto(r.deltaTesto, 12.5, 650)), 40) + 6;
  const m = { sx: Math.ceil(larghNomi) + 16, dx: Math.ceil(larghDelta) + 10, su: 12 };
  const innerW = Math.max(60, W - m.sx - m.dx);
  const H = m.su + n * RIGA + 34;
  const x = (v) => m.sx + innerW * (v / scala.max);
  const yAsse = m.su + n * RIGA;

  const area = h('div', { class: 'g-area', style: { height: `${H}px` } });
  const svg = s('svg', {
    class: 'g-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
    role: 'group', 'aria-roledescription': 'grafico', 'aria-label': `${spec.titolo}. Usa le frecce per scorrere le righe.`, tabindex: '0',
  });
  const tt = creaTooltip(area);

  for (const t of scala.tacche) {
    svg.append(s('line', { class: t === 0 ? 'g-asse' : 'g-griglia', x1: x(t), x2: x(t), y1: m.su, y2: yAsse }));
    svg.append(s('text', { class: 'g-testo', x: x(t), y: yAsse + 18, 'text-anchor': t === 0 ? 'start' : 'middle' }, fmtAsse(t)));
  }
  const bande = righe.map((_, i) => svg.appendChild(s('rect', { class: 'g-banda', x: 0, y: m.su + i * RIGA + 2, width: W, height: RIGA - 4, rx: 8 })));
  righe.forEach((r, i) => {
    const cy = m.su + i * RIGA + RIGA / 2;
    svg.append(s('text', { class: 'g-testo g-testo-forte', x: 6, y: cy - 2 }, tronca(r.etichetta, larghNomi, 13, 600)));
    if (r.sotto) svg.append(s('text', { class: 'g-testo g-testo-sotto', x: 6, y: cy + 14 }, tronca(r.sotto, larghNomi, 11.5, 400)));
    const xa = x(r.a), xb = x(r.b);
    svg.append(s('line', { class: 'g-collega', x1: xa, x2: xb, y1: cy, y2: cy }));
    // anello di superficie di 2px attorno a ogni punto: restano leggibili anche se si sovrappongono
    svg.append(s('circle', { class: 'g-punto-anello', cx: xa, cy, r: 7 }), s('circle', { class: 'g-punto g-serie-o2', cx: xa, cy, r: 5 }));
    svg.append(s('circle', { class: 'g-punto-anello', cx: xb, cy, r: 7 }), s('circle', { class: 'g-punto g-serie-o1', cx: xb, cy, r: 5 }));
    svg.append(s('text', { class: `g-valore g-delta ${r.deltaCent > 0 ? 'su' : r.deltaCent < 0 ? 'giu' : ''}`, x: W - 6, y: cy + 4.5, 'text-anchor': 'end' }, r.deltaTesto));
  });

  const attiva = (i) => {
    if (stato.attivo >= 0 && bande[stato.attivo]) bande[stato.attivo].classList.remove('g-attiva');
    stato.attivo = i;
    if (i < 0) { tt.nascondi(); return; }
    bande[i].classList.add('g-attiva');
    const r = righe[i];
    tt.mostra(Math.min(W - 40, Math.max(x(r.a), x(r.b))), m.su + i * RIGA + RIGA / 2, r.etichettaLunga || r.etichetta, [
      { colore: 'o2', nome: spec.nomi[0], valore: fmtVal(r.a) },
      { colore: 'o1', nome: spec.nomi[1], valore: fmtVal(r.b) },
      { nome: 'Differenza', valore: r.deltaTesto },
    ]);
  };
  righe.forEach((_, i) => {
    const hit = s('rect', { class: 'g-hit', x: 0, y: m.su + i * RIGA, width: W, height: RIGA });
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
  host.append(h('ul', { class: 'g-legenda', 'aria-label': 'Legenda' },
    h('li', null, h('span', { class: 'g-legenda-voce statica' }, h('span', { class: 'g-legenda-chiave g-serie-o2 cerchio' }), h('span', null, spec.nomi[0]))),
    h('li', null, h('span', { class: 'g-legenda-voce statica' }, h('span', { class: 'g-legenda-chiave g-serie-o1 cerchio' }), h('span', null, spec.nomi[1])))),
  area);
  if (stato.attivo >= 0 && stato.attivo < n) attiva(stato.attivo);
}

export function montaDumbbell(host) {
  return montaGrafico(host, disegna);
}
