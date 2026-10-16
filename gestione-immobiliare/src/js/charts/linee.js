// Grafico a linee con mirino che segue il puntatore e un solo suggerimento con tutte le serie.
import { h, s } from '../core/dom.js';
import { scalaVerticale, larghezzaTesto, creaTooltip, creaLegenda, montaGrafico } from './base.js';

function disegna(host, spec, W, stato, ridisegna) {
  const H = spec.altezza || 260;
  const cat = spec.categorie;
  const n = cat.length;
  const serie = spec.serie.filter((sr) => !stato.nascoste.has(sr.id));
  const fmtAsse = spec.formato.asse;
  const fmtVal = spec.formato.valore;

  let max = 0;
  for (const sr of serie) for (let i = 0; i < n; i++) max = Math.max(max, sr.valori[i] || 0);
  const scala = scalaVerticale(max, { intero: spec.formato.intero });
  const larghEtichY = Math.max(...scala.tacche.map((t) => larghezzaTesto(fmtAsse(t), 12)));
  const m = { sx: Math.ceil(larghEtichY) + 16, dx: 16, su: 18, giu: 30 };
  const innerW = Math.max(40, W - m.sx - m.dx);
  const innerH = H - m.su - m.giu;
  const yBase = m.su + innerH;
  const y = (v) => m.su + innerH * (1 - v / scala.max);
  const x = (i) => (n === 1 ? m.sx + innerW / 2 : m.sx + (innerW * i) / (n - 1));

  const legenda = creaLegenda(spec.serie, stato.nascoste, ridisegna, { forma: 'linea' });
  const area = h('div', { class: 'g-area', style: { height: `${H}px` } });
  const svg = s('svg', {
    class: 'g-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
    role: 'group', 'aria-roledescription': 'grafico', 'aria-label': `${spec.titolo}. Usa le frecce per scorrere i valori.`, tabindex: '0',
  });
  const tt = creaTooltip(area);

  for (const t of scala.tacche) {
    const yy = y(t);
    svg.append(s('line', { class: t === 0 ? 'g-asse' : 'g-griglia', x1: m.sx, x2: W - m.dx, y1: yy, y2: yy }));
    svg.append(s('text', { class: 'g-testo', x: m.sx - 8, y: yy + 4, 'text-anchor': 'end' }, fmtAsse(t)));
  }
  const maxEtic = Math.max(...cat.map((c) => larghezzaTesto(c.etichetta, 12)), 10);
  const passo = Math.max(1, Math.ceil((maxEtic + 14) / (innerW / Math.max(1, n - 1))));
  cat.forEach((c, i) => {
    if ((n - 1 - i) % passo !== 0) return;
    svg.append(s('text', { class: `g-testo${c.dim ? ' g-dim-testo' : ''}`, x: x(i), y: yBase + 19, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, c.etichetta));
  });

  const mirino = s('line', { class: 'g-mirino g-nascosto', x1: 0, x2: 0, y1: m.su, y2: yBase });
  svg.append(mirino);

  const puntiAttivi = [];
  serie.forEach((sr) => {
    const pts = sr.valori.map((v, i) => [x(i), y(v || 0)]);
    if (serie.length === 1) {
      svg.append(s('path', { class: `g-area-riempita g-serie-${sr.colore}`, d: `M${pts[0][0]},${yBase}L${pts.map((p) => p.join(',')).join('L')}L${pts[n - 1][0]},${yBase}Z` }));
    }
    svg.append(s('polyline', { class: `g-linea g-serie-${sr.colore}`, points: pts.map((p) => p.join(',')).join(' ') }));
    // punto finale sempre visibile (r >= 4 con anello di superficie)
    const iUltimo = (() => { let k = n - 1; while (k > 0 && cat[k].dim) k -= 1; return k; })();
    svg.append(s('circle', { class: 'g-punto-anello', cx: pts[iUltimo][0], cy: pts[iUltimo][1], r: 6 }), s('circle', { class: `g-punto g-serie-${sr.colore}`, cx: pts[iUltimo][0], cy: pts[iUltimo][1], r: 4 }));
    const pa = s('circle', { class: `g-punto g-serie-${sr.colore} g-punto-attivo g-nascosto`, r: 5 });
    const par = s('circle', { class: 'g-punto-anello g-punto-attivo-anello g-nascosto', r: 7 });
    svg.append(par, pa);
    puntiAttivi.push({ sr, pa, par });
  });

  const attiva = (i) => {
    stato.attivo = i;
    if (i < 0) { tt.nascondi(); mirino.classList.add('g-nascosto'); puntiAttivi.forEach(({ pa, par }) => { pa.classList.add('g-nascosto'); par.classList.add('g-nascosto'); }); return; }
    mirino.classList.remove('g-nascosto');
    mirino.setAttribute('x1', x(i)); mirino.setAttribute('x2', x(i));
    puntiAttivi.forEach(({ sr, pa, par }) => {
      const cy = y(sr.valori[i] || 0);
      for (const el of [pa, par]) { el.classList.remove('g-nascosto'); el.setAttribute('cx', x(i)); el.setAttribute('cy', cy); }
    });
    const righe = serie.map((sr) => ({ colore: sr.colore, linea: true, nome: sr.nome, valore: fmtVal(sr.valori[i] || 0) }));
    tt.mostra(x(i), m.su + 20, cat[i].etichettaLunga || cat[i].etichetta, righe, cat[i].dim ? 'Fuori dal periodo selezionato' : null);
  };
  const hit = s('rect', { class: 'g-hit', x: m.sx - 10, y: 0, width: innerW + 20, height: H });
  const dalPuntatore = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const i = n === 1 ? 0 : Math.round(((px - m.sx) / innerW) * (n - 1));
    attiva(Math.max(0, Math.min(n - 1, i)));
  };
  hit.addEventListener('pointermove', dalPuntatore);
  hit.addEventListener('pointerenter', dalPuntatore);
  svg.addEventListener('pointerleave', () => attiva(-1));
  svg.addEventListener('blur', () => attiva(-1));
  svg.addEventListener('focus', () => { if (stato.attivo < 0) attiva(n - 1); });
  svg.addEventListener('keydown', (ev) => {
    const c = stato.attivo < 0 ? n - 1 : stato.attivo;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); attiva(Math.min(n - 1, c + 1)); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); attiva(Math.max(0, c - 1)); }
    else if (ev.key === 'Home') { ev.preventDefault(); attiva(0); }
    else if (ev.key === 'End') { ev.preventDefault(); attiva(n - 1); }
    else if (ev.key === 'Escape') attiva(-1);
  });
  svg.append(hit);

  area.append(svg);
  host.append(...(legenda ? [legenda] : []), area);
  if (stato.attivo >= 0 && stato.attivo < n) attiva(stato.attivo);
}

export function montaLinee(host) {
  return montaGrafico(host, disegna);
}
