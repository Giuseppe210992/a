// Campi dei moduli: etichetta + controllo + aiuto + messaggio d'errore, con formati italiani.
import { h } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { leggiEuro, leggiPercentuale, numDec, euroPerInput } from '../core/format.js';

let contatore = 0;
const nuovoId = (p = 'campo') => `${p}-${++contatore}`;

function costruisci({ etichetta, controllo, aiuto, obbligatorio, id, classe = '', accessorio = null }) {
  const idErrore = `${id}-err`;
  const idAiuto = `${id}-aiuto`;
  const elErrore = h('div', { class: 'errore', id: idErrore, role: 'alert' });
  const elAiuto = aiuto ? h('div', { class: 'aiuto', id: idAiuto }, aiuto) : null;
  controllo.setAttribute('aria-describedby', [elAiuto ? idAiuto : null, idErrore].filter(Boolean).join(' '));
  const el = h('div', { class: `campo ${classe}`.trim() },
    etichetta ? h('label', { for: id }, etichetta, obbligatorio ? h('span', { class: 'obbligatorio', 'aria-hidden': 'true' }, '*') : null) : null,
    accessorio ? accessorio : controllo,
    elAiuto,
    elErrore,
  );
  const errore = (msg) => {
    elErrore.replaceChildren();
    if (msg) {
      elErrore.append(icona('circle-alert', { dimensione: 15 }), h('span', null, msg));
      el.classList.add('ha-errore');
      controllo.setAttribute('aria-invalid', 'true');
    } else {
      el.classList.remove('ha-errore');
      controllo.removeAttribute('aria-invalid');
    }
  };
  controllo.addEventListener('input', () => { if (el.classList.contains('ha-errore')) errore(null); });
  controllo.addEventListener('change', () => { if (el.classList.contains('ha-errore')) errore(null); });
  return { el, errore };
}

export function campoTesto({ etichetta, valore = '', placeholder = '', obbligatorio = false, aiuto = null, maxlength = 200, tipo = 'text', id = nuovoId(), classe = '', autocomplete = 'off', lista = null, onInput = null }) {
  const input = h('input', { id, class: 'input', type: tipo, value: valore ?? '', placeholder, maxlength, autocomplete, list: lista, required: obbligatorio ? true : null });
  const { el, errore } = costruisci({ etichetta, controllo: input, aiuto, obbligatorio, id, classe });
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  return { el, input, errore, get: () => input.value.trim(), set: (v) => { input.value = v ?? ''; } };
}

export function campoAreaTesto({ etichetta, valore = '', placeholder = '', aiuto = null, maxlength = 2000, id = nuovoId(), classe = '', righe = 3 }) {
  const input = h('textarea', { id, class: 'textarea', rows: righe, maxlength, placeholder });
  input.value = valore ?? '';
  const { el, errore } = costruisci({ etichetta, controllo: input, aiuto, id, classe });
  return { el, input, errore, get: () => input.value.trim(), set: (v) => { input.value = v ?? ''; } };
}

/** "16/10/2026" (o 16-10-26, 1/2/2026...) -> "2026-10-16"; stringa vuota se non e' una data valida. */
export function leggiDataIt(testo) {
  const m = /^\s*(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})\s*$/.exec(testo || '');
  if (!m) return '';
  const g = +m[1], mese = +m[2];
  let a = +m[3];
  if (m[3].length === 2) a += 2000;
  const d = new Date(Date.UTC(a, mese - 1, g));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mese - 1 || d.getUTCDate() !== g) return '';
  return `${String(a).padStart(4, '0')}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

export function dataPerCampo(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * Data nel formato italiano gg/mm/aaaa, uguale su qualsiasi computer e browser.
 * Si scrive a mano (le barre si inseriscono da sole) oppure si sceglie dal calendario.
 */
export function campoData({ etichetta, valore = '', obbligatorio = false, aiuto = null, id = nuovoId(), classe = '', onInput = null }) {
  const input = h('input', { id, class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'gg/mm/aaaa', maxlength: 10, autocomplete: 'off', value: dataPerCampo(valore), required: obbligatorio ? true : null });
  const nativo = h('input', { type: 'date', class: 'data-nativa', tabindex: '-1', 'aria-hidden': 'true' });
  const apri = h('button', { type: 'button', class: 'btn btn-ghost btn-icona btn-sm campo-data-btn', 'aria-label': 'Scegli dal calendario', title: 'Scegli dal calendario', onclick: () => {
    nativo.value = leggiDataIt(input.value);
    try { nativo.showPicker(); } catch { nativo.focus(); nativo.click(); }
  } }, icona('calendar', { dimensione: 17 }));
  const wrap = h('div', { class: 'campo-data' }, input, apri, nativo);
  const { el, errore } = costruisci({ etichetta, controllo: input, aiuto, obbligatorio, id, classe, accessorio: wrap });
  const get = () => leggiDataIt(input.value);
  const valido = () => input.value.trim() === '' || get() !== '';
  input.addEventListener('input', (ev) => {
    // le barre compaiono da sole mentre si scrivono le cifre
    if (ev.inputType && ev.inputType.startsWith('delete')) return;
    const cifre = input.value.replace(/\D/g, '').slice(0, 8);
    if (/[^\d/\-. ]/.test(input.value)) { input.value = input.value.replace(/[^\d/\-. ]/g, ''); }
    if (!/[/\-. ]/.test(input.value) && cifre.length > 2) {
      input.value = cifre.length > 4 ? `${cifre.slice(0, 2)}/${cifre.slice(2, 4)}/${cifre.slice(4)}` : `${cifre.slice(0, 2)}/${cifre.slice(2)}`;
    }
  });
  input.addEventListener('blur', () => { const iso = get(); if (iso) input.value = dataPerCampo(iso); });
  nativo.addEventListener('change', () => {
    if (!nativo.value) return;
    input.value = dataPerCampo(nativo.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if (onInput) input.addEventListener('input', () => onInput(get()));
  return { el, input, errore, valido, get, set: (v) => { input.value = dataPerCampo(v); } };
}

/** Importo in euro: l'utente scrive "1.234,56"; il valore e' in centesimi. */
export function campoImporto({ etichetta, centesimi = null, obbligatorio = false, aiuto = null, id = nuovoId(), classe = '', placeholder = '0,00', onInput = null, simbolo = '€' }) {
  const input = h('input', { id, class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, value: centesimi === null ? '' : numDec(centesimi / 100) });
  const wrap = h('div', { class: 'campo-importo' }, input, h('span', { class: 'simbolo', 'aria-hidden': 'true' }, simbolo));
  const { el, errore } = costruisci({ etichetta, controllo: input, aiuto, obbligatorio, id, classe, accessorio: wrap });
  const valido = () => input.value.trim() === '' || leggiEuro(input.value) !== null;
  input.addEventListener('blur', () => {
    const c = leggiEuro(input.value);
    if (c !== null) input.value = numDec(c / 100);
  });
  input.addEventListener('focus', () => { setTimeout(() => input.select(), 0); });
  if (onInput) input.addEventListener('input', () => onInput(leggiEuro(input.value)));
  return {
    el, input, errore, valido,
    get: () => leggiEuro(input.value),
    set: (c) => { input.value = c === null || c === undefined ? '' : numDec(c / 100); },
    setGrezzo: (c) => { input.value = c === null || c === undefined ? '' : euroPerInput(c); },
  };
}

export function campoPercentuale({ etichetta, valore = null, aiuto = null, id = nuovoId(), classe = '', placeholder = '0', onInput = null, obbligatorio = false }) {
  const input = h('input', { id, class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, value: valore === null ? '' : String(valore).replace('.', ',') });
  const wrap = h('div', { class: 'campo-importo' }, input, h('span', { class: 'simbolo', 'aria-hidden': 'true' }, '%'));
  const { el, errore } = costruisci({ etichetta, controllo: input, aiuto, obbligatorio, id, classe, accessorio: wrap });
  const valido = () => input.value.trim() === '' || leggiPercentuale(input.value) !== null;
  if (onInput) input.addEventListener('input', () => onInput(leggiPercentuale(input.value)));
  input.addEventListener('focus', () => { setTimeout(() => input.select(), 0); });
  return {
    el, input, errore, valido,
    get: () => leggiPercentuale(input.value),
    set: (v) => { input.value = v === null || v === undefined ? '' : String(v).replace('.', ','); },
  };
}

/** opzioni: [{ valore, etichetta, disabilitato }]  (il valore e' sempre una stringa nel DOM) */
export function campoSelezione({ etichetta, opzioni, valore = '', vuoto = null, obbligatorio = false, aiuto = null, id = nuovoId(), classe = '', onChange = null }) {
  const select = h('select', { id, class: 'select', required: obbligatorio ? true : null });
  const riempi = (lista, v) => {
    select.replaceChildren();
    if (vuoto !== null) select.append(h('option', { value: '' }, vuoto));
    for (const o of lista) select.append(h('option', { value: String(o.valore), disabled: o.disabilitato ? true : null }, o.etichetta));
    select.value = v === null || v === undefined ? '' : String(v);
    if (select.value !== (v === null || v === undefined ? '' : String(v))) select.value = vuoto !== null ? '' : (select.options[0]?.value ?? '');
  };
  riempi(opzioni, valore);
  const { el, errore } = costruisci({ etichetta, controllo: select, aiuto, obbligatorio, id, classe });
  if (onChange) select.addEventListener('change', () => onChange(select.value));
  return { el, input: select, errore, get: () => select.value, set: (v) => { select.value = v === null || v === undefined ? '' : String(v); }, riempi };
}

export function casella({ etichetta, selezionata = false, onChange = null, id = nuovoId('chk') }) {
  const input = h('input', { type: 'checkbox', id, checked: selezionata });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'check', for: id }, input, etichetta);
  return { el, input, get: () => input.checked, set: (v) => { input.checked = !!v; } };
}

/** Mostra gli errori di validazione sui campi (mappa nome -> campo). Restituisce il primo campo con errore. */
export function mostraErrori(campi, errori) {
  let primo = null;
  for (const [nome, c] of Object.entries(campi)) {
    const msg = errori ? errori[nome] : null;
    c.errore(msg || null);
    if (msg && !primo) primo = c;
  }
  return primo;
}
