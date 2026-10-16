// Mini-grafico per i riquadri: linea sobria e punto finale evidenziato.
import { s } from '../core/dom.js';

export function sparkline(valori, { larghezza = 120, altezza = 34, etichetta = '', formato = String, etichette = [] } = {}) {
  const n = valori.length;
  const svg = s('svg', { class: 'spark', width: larghezza, height: altezza, viewBox: `0 0 ${larghezza} ${altezza}`, role: 'img', 'aria-label': etichetta || 'Andamento' });
  if (n < 2) return svg;
  const max = Math.max(...valori, 1);
  const px = 6, py = 6;
  const x = (i) => px + ((larghezza - 2 * px) * i) / (n - 1);
  const y = (v) => altezza - py - ((altezza - 2 * py) * v) / max;
  svg.append(s('polyline', { class: 'spark-linea', points: valori.map((v, i) => `${x(i)},${y(v)}`).join(' ') }));
  const u = n - 1;
  svg.append(s('circle', { class: 'spark-anello', cx: x(u), cy: y(valori[u]), r: 6 }), s('circle', { class: 'spark-punto', cx: x(u), cy: y(valori[u]), r: 4 }));
  // suggerimento nativo su ogni punto
  valori.forEach((v, i) => {
    const hit = s('circle', { class: 'spark-hit', cx: x(i), cy: y(v), r: 8 }, s('title', null, `${etichette[i] ?? ''}${etichette[i] ? ': ' : ''}${formato(v)}`));
    svg.append(hit);
  });
  return svg;
}
