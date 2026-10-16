// Inserimento e modifica di una pratica (compravendita), con calcolo dei compensi e stima delle provvigioni in tempo reale.
import { h, monta, ritarda } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, impostazioni } from '../core/app.js';
import { naviga, rimonta } from '../core/router.js';
import { oggi } from '../core/dates.js';
import { eur, eurInt, pct, num, meseAnno, leggiPercentuale, numDec } from '../core/format.js';
import { apriModale, conferma, ok as notificaOk, segnalaErrore, errore as notificaErrore } from '../core/ui.js';
import { campoTesto, campoAreaTesto, campoData, campoImporto, campoPercentuale, campoSelezione, mostraErrori } from '../components/campi.js';
import { salvaPratica, prossimoCodice, STATI, TIPI_IMMOBILE } from '../data/repo/pratiche.js';
import { creaZona } from '../data/repo/anagrafiche.js';
import { opzioniCalcolo } from '../data/repo/impostazioni.js';
import { stimaPratica } from '../data/stima.js';

function bozzaVuota() {
  return { stato: 'in_corso', data_pratica: oggi(), aliquota_iva: impostazioni()['iva.predefinita'] ?? 22 };
}

function montaForm(contenitore, { pratica = null }) {
  const m = modello();
  const imp = impostazioni();
  const modifica = !!pratica;
  const base = pratica || bozzaVuota();
  const collaboratoriAttivi = m.collaboratori.filter((c) => c.attivo || (pratica && pratica.voci.some((v) => v.collaboratoreId === c.id)));
  let sporco = false;
  let salvataggioInCorso = false;
  const segnaSporco = () => { sporco = true; aggiornaBarra(); };

  // ----------------------------------------------------------- campi
  const codiceIniziale = pratica ? pratica.codice : prossimoCodice(app.archivio, base.data_pratica);
  let codiceModificatoDaUtente = modifica;
  const f = {
    codice: campoTesto({ etichetta: 'Codice pratica', valore: codiceIniziale, obbligatorio: true, maxlength: 30, aiuto: 'Proposto in automatico; puoi cambiarlo.', onInput: () => { codiceModificatoDaUtente = true; } }),
    stato: campoSelezione({ etichetta: 'Stato', valore: base.stato, obbligatorio: true, opzioni: STATI.map((s) => ({ valore: s.valore, etichetta: s.etichetta })) }),
    data_pratica: campoData({ etichetta: 'Data di apertura', valore: base.data_pratica, obbligatorio: true }),
    data_rogito: campoData({ etichetta: 'Data del rogito', valore: base.data_rogito ?? '', aiuto: 'Il mese del rogito decide in quale cumulo mensile entra la pratica.' }),
    immobile_indirizzo: campoTesto({ etichetta: 'Indirizzo dell\'immobile', valore: base.immobile_indirizzo ?? '', obbligatorio: true, maxlength: 160, placeholder: 'Via, numero civico' }),
    immobile_comune: campoTesto({ etichetta: 'Comune', valore: base.immobile_comune ?? '', maxlength: 80 }),
    immobile_tipo: campoSelezione({ etichetta: 'Tipo di immobile', valore: base.immobile_tipo ?? '', vuoto: 'Non indicato', opzioni: TIPI_IMMOBILE.map((t) => ({ valore: t, etichetta: t })) }),
    zona_id: campoSelezione({ etichetta: 'Zona', valore: base.zona_id ?? '', vuoto: 'Da indicare', opzioni: [] }),
    prezzo_vendita_cent: campoImporto({ etichetta: 'Prezzo di vendita', centesimi: base.prezzo_vendita_cent ?? null }),
    prezzo_acquisto_cent: campoImporto({ etichetta: 'Prezzo di acquisto (se noto)', centesimi: base.prezzo_acquisto_cent ?? null, aiuto: 'Quanto aveva pagato l\'attuale proprietario. Serve al confronto acquisto/vendita.' }),
    venditore: campoTesto({ etichetta: 'Venditore', valore: base.venditore ?? '', maxlength: 120 }),
    acquirente: campoTesto({ etichetta: 'Acquirente', valore: base.acquirente ?? '', maxlength: 120 }),
    compenso_venditore_cent: campoImporto({ etichetta: 'Compenso dal venditore (imponibile)', centesimi: base.compenso_venditore_cent ?? null }),
    compenso_acquirente_cent: campoImporto({ etichetta: 'Compenso dall\'acquirente (imponibile)', centesimi: base.compenso_acquirente_cent ?? null }),
    aliquota_iva: campoSelezione({ etichetta: 'Aliquota IVA', valore: String(base.aliquota_iva ?? 22), opzioni: [] }),
    note: campoAreaTesto({ etichetta: 'Note', valore: base.note ?? '', righe: 3 }),
  };
  const pctVend = campoPercentuale({ etichetta: '% sul prezzo', placeholder: 'es. 3' });
  const pctAcq = campoPercentuale({ etichetta: '% sul prezzo', placeholder: 'es. 3' });

  function riempiZone(selezionata) {
    const mm = modello();
    f.zona_id.riempi(mm.zone.filter((z) => z.attiva || z.id === selezionata).map((z) => ({ valore: z.id, etichetta: z.nome })), selezionata ?? '');
  }
  riempiZone(base.zona_id);
  const aliquote = [...new Set([...(imp['iva.aliquote'] || [22]), Number(base.aliquota_iva ?? 22)])].sort((a, b) => b - a);
  f.aliquota_iva.riempi(aliquote.map((a) => ({ valore: String(a), etichetta: a === 0 ? '0% (esente / non imponibile)' : `${String(a).replace('.', ',')}%` })), String(base.aliquota_iva ?? 22));

  // la % sul prezzo e l'importo si aggiornano a vicenda
  const prezzoVend = () => f.prezzo_vendita_cent.get();
  let blocca = false;
  const sincronizza = (pctCampo, impCampo) => {
    pctCampo.input.addEventListener('input', () => {
      if (blocca) return;
      const p = pctCampo.get();
      const pr = prezzoVend();
      if (p !== null && pr) { blocca = true; impCampo.set(Math.round((pr * p) / 100)); blocca = false; ricalcola(); }
    });
    impCampo.input.addEventListener('input', () => {
      if (blocca) return;
      const v = impCampo.get();
      const pr = prezzoVend();
      if (v !== null && pr) { blocca = true; pctCampo.set(Math.round((v / pr) * 10000) / 100); blocca = false; }
    });
  };
  sincronizza(pctVend, f.compenso_venditore_cent);
  sincronizza(pctAcq, f.compenso_acquirente_cent);
  const aggiornaPct = () => {
    const pr = prezzoVend();
    for (const [pc, ic] of [[pctVend, f.compenso_venditore_cent], [pctAcq, f.compenso_acquirente_cent]]) {
      const v = ic.get();
      if (pr && v) { blocca = true; pc.set(Math.round((v / pr) * 10000) / 100); blocca = false; } else if (!pr) { blocca = true; pc.set(null); blocca = false; }
    }
  };
  aggiornaPct();

  // ----------------------------------------------------------- ripartizione
  let quote = pratica ? pratica.voci.filter((v) => v.collaboratoreId != null).map((v) => ({ collaboratore_id: v.collaboratoreId, percentuale: v.quotaPct })) : [];
  if (!modifica) {
    const pred = (imp['ripartizione.predefinita'] || []).filter((x) => collaboratoriAttivi.some((c) => c.id === x.collaboratoreId));
    if (pred.length) quote = pred.map((x) => ({ collaboratore_id: x.collaboratoreId, percentuale: x.percentuale }));
    else if (collaboratoriAttivi.length === 1) quote = [{ collaboratore_id: collaboratoriAttivi[0].id, percentuale: 100 }];
  }
  const boxQuote = h('div', { class: 'quote-righe' });
  const erroreQuote = h('div', { class: 'campo ha-errore' }, h('div', { class: 'errore', role: 'alert' }));
  const totaleQuote = h('div', { class: 'sottotesto forte' });
  const meterQuote = h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', null));
  const sommaQuote = () => quote.reduce((s, q) => s + Math.round((Number(q.percentuale) || 0) * 100), 0) / 100;

  function disegnaQuote() {
    boxQuote.replaceChildren();
    quote.forEach((q, i) => {
      const usati = new Set(quote.filter((_, j) => j !== i).map((x) => x.collaboratore_id));
      const sel = campoSelezione({
        etichetta: i === 0 ? 'Collaboratore' : null, valore: q.collaboratore_id ?? '', vuoto: 'Scegli…',
        opzioni: m.collaboratori.filter((c) => (c.attivo || c.id === q.collaboratore_id) && !usati.has(c.id)).map((c) => ({ valore: c.id, etichetta: c.nome })),
        onChange: (v) => { q.collaboratore_id = v === '' ? null : +v; segnaSporco(); ricalcola(); },
      });
      sel.input.setAttribute('aria-label', `Collaboratore ${i + 1}`);
      const p = campoPercentuale({ etichetta: i === 0 ? 'Quota' : null, valore: q.percentuale ?? null, onInput: (v) => { q.percentuale = v ?? 0; aggiornaTotaleQuote(); segnaSporco(); ricalcola(); } });
      p.input.setAttribute('aria-label', `Quota del collaboratore ${i + 1}`);
      boxQuote.append(h('div', { class: 'quota-riga' }, sel.el, p.el,
        h('button', { type: 'button', class: 'btn btn-ghost btn-icona', 'aria-label': `Togli il collaboratore ${i + 1}`, title: 'Togli', onclick: () => { quote.splice(i, 1); segnaSporco(); disegnaQuote(); ricalcola(); } }, icona('x', { dimensione: 18 }))));
    });
    aggiornaTotaleQuote();
  }
  function aggiornaTotaleQuote() {
    const t = sommaQuote();
    totaleQuote.textContent = quote.length ? `Totale quote: ${pct(t)}` : 'Nessun collaboratore assegnato';
    totaleQuote.style.color = !quote.length ? '' : Math.abs(t - 100) < 0.005 ? 'var(--ok-text)' : 'var(--crit-text)';
    meterQuote.firstChild.style.width = `${Math.min(100, t)}%`;
    meterQuote.firstChild.style.background = Math.abs(t - 100) < 0.005 ? 'var(--ok)' : t > 100 ? 'var(--crit)' : 'var(--warn)';
    meterQuote.hidden = !quote.length;
  }
  const preset = (etichetta, fn) => h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => { fn(); segnaSporco(); disegnaQuote(); ricalcola(); } }, etichetta);
  const boxPreset = h('div', { class: 'riga-azioni' });
  function disegnaPreset() {
    const voci = collaboratoriAttivi.slice(0, 4).map((c) => preset(`Tutto a ${c.nome}`, () => { quote = [{ collaboratore_id: c.id, percentuale: 100 }]; }));
    if (collaboratoriAttivi.length >= 2) {
      voci.push(preset('Parti uguali', () => {
        const attivi = collaboratoriAttivi.filter((c) => c.attivo);
        const n = attivi.length || 1;
        const base2 = Math.floor(10000 / n) / 100;
        quote = attivi.map((c, i) => ({ collaboratore_id: c.id, percentuale: i === n - 1 ? Math.round((100 - base2 * (n - 1)) * 100) / 100 : base2 }));
      }));
    }
    if ((imp['ripartizione.predefinita'] || []).length) {
      voci.push(preset('Ripartizione predefinita', () => { quote = (imp['ripartizione.predefinita'] || []).map((x) => ({ collaboratore_id: x.collaboratoreId, percentuale: x.percentuale })); }));
    }
    monta(boxPreset, ...voci);
  }
  const aggiungi = h('button', { type: 'button', class: 'btn btn-secondario btn-sm', onclick: () => {
    const rest = m.collaboratori.filter((c) => c.attivo && !quote.some((q) => q.collaboratore_id === c.id));
    if (!rest.length && m.collaboratori.length) { notificaErrore('Hai già aggiunto tutti i collaboratori.'); return; }
    const resto = Math.max(0, Math.round((100 - sommaQuote()) * 100) / 100);
    quote.push({ collaboratore_id: rest[0]?.id ?? null, percentuale: quote.length ? resto : 100 });
    segnaSporco(); disegnaQuote(); ricalcola();
  } }, icona('plus', { dimensione: 16 }), 'Aggiungi collaboratore');
  disegnaPreset();
  disegnaQuote();

  // ----------------------------------------------------------- riepilogo e stima
  const riepilogo = h('div', { class: 'riepilogo-calcolo', 'aria-live': 'polite' });
  const stima = h('div', { class: 'stima-provvigione', 'aria-live': 'polite' });

  function leggiBozza() {
    return {
      id: pratica?.id ?? null,
      codice: f.codice.get(), stato: f.stato.get(), data_pratica: f.data_pratica.get(), data_rogito: f.data_rogito.get() || null,
      zona_id: f.zona_id.get() === '' ? null : +f.zona_id.get(),
      immobile_indirizzo: f.immobile_indirizzo.get(), immobile_comune: f.immobile_comune.get(), immobile_tipo: f.immobile_tipo.get(),
      prezzo_vendita_cent: f.prezzo_vendita_cent.get(), prezzo_acquisto_cent: f.prezzo_acquisto_cent.get(),
      venditore: f.venditore.get(), acquirente: f.acquirente.get(),
      compenso_venditore_cent: f.compenso_venditore_cent.get() ?? 0, compenso_acquirente_cent: f.compenso_acquirente_cent.get() ?? 0,
      aliquota_iva: Number(f.aliquota_iva.get()), note: f.note.get(),
    };
  }
  const quoteValide = () => quote.filter((q) => q.collaboratore_id && Number(q.percentuale) > 0).map((q) => ({ collaboratore_id: q.collaboratore_id, percentuale: Number(q.percentuale) }));

  function ricalcola() {
    const b = leggiBozza();
    const cv = b.compenso_venditore_cent, ca = b.compenso_acquirente_cent;
    const tot = cv + ca;
    const iva = Math.round((tot * Math.round(b.aliquota_iva * 100)) / 10000);
    monta(riepilogo,
      h('div', { class: 'riga' }, h('span', null, 'Compenso dal venditore'), h('span', { class: 'valore' }, eur(cv))),
      h('div', { class: 'riga' }, h('span', null, 'Compenso dall\'acquirente'), h('span', { class: 'valore' }, eur(ca))),
      h('div', { class: 'riga' }, h('span', null, 'Totale imponibile'), h('span', { class: 'valore' }, eur(tot))),
      h('div', { class: 'riga' }, h('span', null, `IVA ${String(b.aliquota_iva).replace('.', ',')}%`), h('span', { class: 'valore' }, eur(iva))),
      h('div', { class: 'riga totale' }, h('span', null, 'Totale con IVA'), h('span', { class: 'valore' }, eur(tot + iva))),
      pratica ? h('div', { class: 'riga' }, h('span', null, 'Già incassato'), h('span', { class: 'valore' }, eur(pratica.incassatoCent))) : null,
    );
    // stima delle provvigioni
    let s;
    try { s = stimaPratica(app.archivio, b, quoteValide(), opzioniCalcolo(imp)); } catch (e) { console.error(e); s = null; }
    if (!s) { monta(stima); return; }
    const mm = s.modello;
    const nomi = new Map(mm.collaboratori.map((c) => [c.id, c.nome]));
    const righe = [];
    if (!quoteValide().length) {
      righe.push(h('div', { class: 'stima-riga' }, h('div', { class: 'dettaglio' }, 'Assegna la pratica ad almeno un collaboratore per vedere la stima delle provvigioni.')));
    } else if (!mm.tabellaPredefinita.length && !mm.tabellePerZona.size) {
      righe.push(h('div', { class: 'nota attenzione' }, icona('triangle-alert', { dimensione: 18 }), h('span', null, 'Gli scaglioni non sono ancora impostati: le provvigioni risultano a zero.'), h('a', { href: '#/impostazioni?sezione=scaglioni' }, 'Imposta')));
    } else {
      for (const v of s.pratica.voci.filter((x) => x.collaboratoreId != null)) {
        const cu = s.cumuli.find((c) => c.collaboratoreId === v.collaboratoreId || c.collaboratoreId === null);
        righe.push(h('div', { class: 'stima-riga' },
          h('div', { class: 'titolo' }, h('span', null, nomi.get(v.collaboratoreId) ?? 'Collaboratore'), h('span', { class: 'num' }, eur(v.provvigioneCent))),
          h('div', { class: 'dettaglio' }, `Quota ${pct(v.quotaPct)} dei compensi: ${eur(v.fatturatoCent)}`),
          cu ? h('div', { class: 'dettaglio' }, `Cumulo di ${meseAnno(cu.mese)}${cu.zonaNome ? ` in ${cu.zonaNome}` : ''}: ${eur(cu.fatturatoCent)} → scaglione ${cu.scaglioneIdx + 1} (${pct(cu.percentuale)})`) : null,
          cu?.prossimo ? h('div', { class: 'dettaglio' }, `Mancano ${eur(cu.prossimo.mancanteCent)} allo scaglione ${cu.prossimo.indice + 1} (${pct(cu.prossimo.percentuale)})`) : null));
      }
    }
    monta(stima,
      h('h3', { style: { fontSize: '14px', fontWeight: 700 } }, 'Stima delle provvigioni'),
      s.simulata ? h('p', { class: 'sottotesto' }, `La pratica non è conclusa: la stima la considera conclusa a ${meseAnno(s.mese)}.`) : null,
      ...righe,
      h('p', { class: 'sottotesto' }, 'La stima si aggiorna se cambiano le altre pratiche del mese (gli scaglioni dipendono dal cumulo).'));
  }
  const ricalcolaRitardato = ritarda(ricalcola, 120);

  // ----------------------------------------------------------- collegamenti tra campi
  for (const c of Object.values(f)) {
    c.input.addEventListener('input', () => { segnaSporco(); ricalcolaRitardato(); });
    c.input.addEventListener('change', () => { segnaSporco(); ricalcola(); });
  }
  f.prezzo_vendita_cent.input.addEventListener('input', () => { if (!blocca) aggiornaPct(); });
  f.data_pratica.input.addEventListener('change', () => {
    if (!codiceModificatoDaUtente) f.codice.set(prossimoCodice(app.archivio, f.data_pratica.get() || oggi()));
  });
  f.stato.input.addEventListener('change', () => {
    if (f.stato.get() === 'conclusa' && !f.data_rogito.get()) f.data_rogito.set(oggi());
    aggiornaRogito();
  });
  const rogitoAiuto = f.data_rogito.el.querySelector('.aiuto');
  function aggiornaRogito() {
    const conclusa = f.stato.get() === 'conclusa';
    if (rogitoAiuto) rogitoAiuto.textContent = conclusa ? 'Obbligatoria per una pratica conclusa: decide in quale cumulo mensile entra.' : 'Compilala quando la pratica si conclude.';
  }
  aggiornaRogito();

  const btnZona = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
    const nome = campoTesto({ etichetta: 'Nome della zona', maxlength: 60, obbligatorio: true });
    apriModale({
      titolo: 'Nuova zona', icona: 'map-pin', contenuto: h('form', { onsubmit: (e) => e.preventDefault() }, nome.el),
      azioni: [{ id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' }, { id: 'crea', etichetta: 'Crea zona', tipo: 'primario', onClick: async () => {
        try {
          const id = await creaZona(app.archivio, { nome: nome.get() });
          riempiZone(id);
          f.zona_id.set(id);
          segnaSporco();
          notificaOk(`Zona “${nome.get()}” creata. Ricorda di impostarne gli scaglioni se sono diversi dai predefiniti.`);
          ricalcola();
        } catch (e) {
          if (e.campi) { nome.errore(e.campi.nome); return false; }
          throw e;
        }
      } }],
    });
  } }, icona('plus', { dimensione: 15 }), 'Nuova zona');

  // ----------------------------------------------------------- salvataggio
  const stato = h('span', { class: 'stato-mod' }, modifica ? 'Nessuna modifica' : 'Compila i dati della pratica');
  function aggiornaBarra() {
    stato.textContent = sporco ? 'Modifiche non ancora salvate' : (modifica ? 'Nessuna modifica' : 'Compila i dati della pratica');
  }

  function raccogli() {
    const b = leggiBozza();
    const errori = {};
    for (const campo of ['prezzo_vendita_cent', 'prezzo_acquisto_cent', 'compenso_venditore_cent', 'compenso_acquirente_cent']) {
      if (!f[campo].valido()) errori[campo] = 'Scrivi un importo valido, ad esempio 1.500,00';
    }
    for (const campo of ['data_pratica', 'data_rogito']) {
      if (!f[campo].valido()) errori[campo] = 'Scrivi la data come gg/mm/aaaa, ad esempio 16/10/2026';
    }
    return { b, errori };
  }

  async function salva(dopo) {
    if (salvataggioInCorso) return;
    const { b, errori } = raccogli();
    const quoteSalva = quoteValide();
    if (Object.keys(errori).length) { mostraErrori(f, errori); focusPrimo(errori); return; }
    erroreQuote.querySelector('.errore').replaceChildren();
    // coerenza della ripartizione
    const somma = sommaQuote();
    if (quoteSalva.length && Math.abs(somma - 100) > 0.005) {
      const procedi = await conferma({
        titolo: 'La ripartizione non fa 100%', tipo: 'primario', etichettaConferma: 'Salva comunque', icona: 'triangle-alert',
        messaggio: `Le quote assegnate sommano ${pct(somma)}. La pratica verrà salvata ma segnalata tra quelle con dati mancanti.`,
      });
      if (!procedi) return;
    }
    if (quote.some((q) => !q.collaboratore_id && Number(q.percentuale) > 0)) {
      notificaErrore('C\'è una riga della ripartizione senza collaboratore: sceglilo o toglila.');
      return;
    }
    salvataggioInCorso = true;
    try {
      const id = await salvaPratica(app.archivio, b, quoteSalva);
      sporco = false;
      notificaOk(`Pratica ${b.codice} ${modifica ? 'aggiornata' : 'salvata'}.`);
      if (dopo === 'nuova') {
        rimonta(); // modulo vuoto, pronto per la pratica successiva
      } else {
        naviga(`#/pratiche/${id}`);
      }
    } catch (e) {
      if (e.campi) {
        const primo = mostraErrori(f, e.campi);
        if (e.campi.quote) { erroreQuote.querySelector('.errore').replaceChildren(icona('circle-alert', { dimensione: 15 }), h('span', null, e.campi.quote)); }
        focusPrimo(e.campi, primo);
        notificaErrore('Controlla i campi evidenziati.');
      } else {
        segnalaErrore(e, 'Salvataggio pratica');
      }
    } finally {
      salvataggioInCorso = false;
    }
  }
  function focusPrimo(errori, primo = null) {
    const ordine = Object.keys(f);
    const chiave = ordine.find((k) => errori[k]);
    (primo || (chiave && f[chiave]))?.input?.focus();
    (primo || (chiave && f[chiave]))?.el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const form = h('form', { novalidate: true, id: 'form-pratica', onsubmit: (e) => { e.preventDefault(); salva('scheda'); } },
    h('div', { class: 'form-layout' },
      h('div', { class: 'form-colonna' },
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Dati della pratica'),
          h('div', { class: 'griglia-campi' }, h('div', { class: 'c-4' }, f.codice.el), h('div', { class: 'c-4' }, f.stato.el), h('div', { class: 'c-4' }),
            h('div', { class: 'c-4' }, f.data_pratica.el), h('div', { class: 'c-4' }, f.data_rogito.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Immobile'),
          h('div', { class: 'griglia-campi' },
            h('div', { class: 'c-8' }, f.immobile_indirizzo.el), h('div', { class: 'c-4' }, f.immobile_comune.el),
            h('div', { class: 'c-4' }, f.immobile_tipo.el),
            h('div', { class: 'c-4' }, f.zona_id.el, h('div', { style: { marginTop: '4px' } }, btnZona)),
            h('div', { class: 'c-4' }),
            h('div', { class: 'c-6' }, f.prezzo_vendita_cent.el), h('div', { class: 'c-6' }, f.prezzo_acquisto_cent.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Parti'),
          h('div', { class: 'griglia-campi' }, h('div', { class: 'c-6' }, f.venditore.el), h('div', { class: 'c-6' }, f.acquirente.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Compensi di agenzia'),
          h('p', { class: 'descrizione' }, 'Importi senza IVA. Puoi scrivere l\'importo oppure la percentuale sul prezzo di vendita: l\'altro valore si calcola da solo.'),
          h('div', { class: 'griglia-campi' },
            h('div', { class: 'c-6' }, f.compenso_venditore_cent.el, h('div', { style: { marginTop: '10px', maxWidth: '180px' } }, pctVend.el)),
            h('div', { class: 'c-6' }, f.compenso_acquirente_cent.el, h('div', { style: { marginTop: '10px', maxWidth: '180px' } }, pctAcq.el)),
            h('div', { class: 'c-4' }, f.aliquota_iva.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Ripartizione tra collaboratori'),
          h('p', { class: 'descrizione' }, 'Come si divide la pratica. Le quote devono fare 100%: da qui si calcolano fatturato e provvigioni di ciascuno.'),
          boxQuote, erroreQuote, h('div', { style: { marginTop: '12px', display: 'grid', gap: '10px' } }, meterQuote, totaleQuote, h('div', { class: 'riga-azioni' }, aggiungi), boxPreset)),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Note'), f.note.el),
      ),
      h('aside', { class: 'form-riepilogo', 'aria-label': 'Riepilogo' },
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Riepilogo compensi'), riepilogo),
        h('section', { class: 'card sezione-modulo' }, stima)),
    ),
    h('div', { class: 'barra-salvataggio' }, stato,
      h('a', { class: 'btn btn-secondario', href: modifica ? `#/pratiche/${pratica.id}` : '#/pratiche', id: 'annulla-pratica' }, 'Annulla'),
      modifica ? null : h('button', { type: 'button', class: 'btn btn-secondario', id: 'salva-e-nuova', onclick: () => salva('nuova') }, 'Salva e inserisci un\'altra'),
      h('button', { type: 'submit', class: 'btn btn-primario', id: 'salva-pratica' }, icona('check', { dimensione: 18 }), modifica ? 'Salva le modifiche' : 'Salva pratica')),
  );

  monta(contenitore,
    h('div', { class: 'pagina-testa' },
      h('div', null,
        h('h1', null, modifica ? `Modifica pratica ${pratica.codice}` : 'Nuova pratica'),
        h('p', null, modifica ? 'Cambia i dati e salva: provvigioni, cumulo e grafici si aggiornano subito.' : 'Inserisci una nuova compravendita. Puoi salvarla anche incompleta: i dati mancanti vengono segnalati.'))),
    form);
  ricalcola();
  if (!modifica) f.immobile_indirizzo.input.focus();
  return {
    haModifiche: () => sporco && !salvataggioInCorso,
    distruggi() { ricalcolaRitardato.annulla(); },
  };
}

export const vistaNuova = {
  id: 'nuova', titolo: 'Nuova pratica', autoAggiorna: false,
  monta(c) { return montaForm(c, {}); },
};

export const vistaModifica = {
  id: 'modifica', titolo: 'Modifica pratica', autoAggiorna: false,
  monta(c, params) {
    const p = modello().perId.get(+params.id);
    if (!p) {
      monta(c, h('div', { class: 'vuoto' }, icona('circle-x', { dimensione: 40 }), h('strong', null, 'Pratica non trovata'), h('p', null, 'La pratica che cerchi non esiste più.'), h('a', { class: 'btn btn-primario', href: '#/pratiche' }, 'Vai all\'archivio')));
      return {};
    }
    return montaForm(c, { pratica: p });
  },
};
export { eurInt, num, numDec, leggiPercentuale };
