// Inserimento e modifica di una pratica (compravendita conclusa), con calcolo dei compensi e stima delle provvigioni in tempo reale.
//
// Il modulo chiede poco: la zona, quanto ha pagato ciascuna parte e come (contanti già senza IVA; bonifico e assegno
// con IVA compresa). Il resto è automatico: numero della pratica, stato «conclusa», data di oggi e ripartizione tra i
// collaboratori a seconda della zona.
import { h, monta, ritarda } from '../core/dom.js';
import { icona } from '../core/icone.js';
import { app, modello, impostazioni } from '../core/app.js';
import { naviga, rimonta } from '../core/router.js';
import { oggi } from '../core/dates.js';
import { eur, pct, meseAnno, dataIt } from '../core/format.js';
import { apriModale, conferma, ok as notificaOk, segnalaErrore, errore as notificaErrore } from '../core/ui.js';
import { campoTesto, campoAreaTesto, campoImporto, campoSelezione, mostraErrori } from '../components/campi.js';
import { editorRipartizione, apriDialogoRipartizione } from '../components/ripartizione-zona.js';
import { salvaPratica, TIPI_IMMOBILE } from '../data/repo/pratiche.js';
import { creaZona, salvaRipartizioneZona, ripartizioneAutomatica } from '../data/repo/anagrafiche.js';
import { opzioniCalcolo } from '../data/repo/impostazioni.js';
import { calcolaCompensi, ivaSuImponibile, PARTI, MODALITA, CAMPI_PAGAMENTO, campoPagamento } from '../data/calc/compensi.js';
import { stimaPratica } from '../data/stima.js';

/** Importi iniziali dei sei campi di pagamento: quelli registrati, oppure (pratica vecchia) il compenso riportato come bonifico con IVA. */
function pagamentiIniziali(pratica) {
  const out = Object.fromEntries(CAMPI_PAGAMENTO.map((c) => [c, null]));
  if (!pratica) return { valori: out, daConvertire: false };
  if (pratica.compensi.daPagamenti) {
    for (const parte of PARTI) {
      for (const modo of MODALITA) {
        const v = pratica.compensi[parte.id][`${modo.id}Cent`];
        out[campoPagamento(parte.id, modo.id)] = v > 0 ? v : null;
      }
    }
    return { valori: out, daConvertire: false };
  }
  for (const parte of PARTI) {
    const imponibile = pratica.compensi[parte.id].imponibileCent;
    if (imponibile > 0) out[campoPagamento(parte.id, 'bonifico')] = imponibile + ivaSuImponibile(imponibile, pratica.aliquota_iva);
  }
  return { valori: out, daConvertire: true };
}

function montaForm(contenitore, { pratica = null }) {
  const m = modello();
  const imp = impostazioni();
  const modifica = !!pratica;
  const aliquotaIniziale = Number(pratica?.aliquota_iva ?? imp['iva.predefinita'] ?? 22);
  const iniziali = pagamentiIniziali(pratica);
  let sporco = false;
  let salvataggioInCorso = false;
  const segnaSporco = () => { sporco = true; aggiornaBarra(); };
  const dataPratica = pratica ? (pratica.data_rogito || pratica.data_pratica) : oggi();

  // ----------------------------------------------------------- campi
  const f = {
    zona_id: campoSelezione({ etichetta: 'Zona', valore: pratica?.zona_id ?? '', vuoto: 'Scegli la zona', obbligatorio: true, opzioni: [], aiuto: 'Decide la ripartizione tra i collaboratori e gli scaglioni.' }),
    immobile_tipo: campoSelezione({ etichetta: 'Tipo di immobile (facoltativo)', valore: pratica?.immobile_tipo ?? '', vuoto: 'Non indicato', opzioni: TIPI_IMMOBILE.map((t) => ({ valore: t, etichetta: t })) }),
    prezzo_vendita_cent: campoImporto({ etichetta: 'Prezzo di vendita', centesimi: pratica?.prezzo_vendita_cent ?? null }),
    prezzo_acquisto_cent: campoImporto({ etichetta: 'Prezzo di acquisto (se noto)', centesimi: pratica?.prezzo_acquisto_cent ?? null, aiuto: 'Quanto aveva pagato l\'attuale proprietario. Serve al confronto acquisto/vendita.' }),
    venditore: campoTesto({ etichetta: 'Venditore (nome, facoltativo)', valore: pratica?.venditore ?? '', maxlength: 120 }),
    acquirente: campoTesto({ etichetta: 'Acquirente (nome, facoltativo)', valore: pratica?.acquirente ?? '', maxlength: 120 }),
    aliquota_iva: campoSelezione({ etichetta: 'Aliquota IVA', valore: String(aliquotaIniziale), opzioni: [], aiuto: 'Serve a togliere l\'IVA da bonifico e assegno.' }),
    note: campoAreaTesto({ etichetta: 'Note', valore: pratica?.note ?? '', righe: 3 }),
  };
  // gli importi pagati: due parti × tre modi (contanti già senza IVA, bonifico e assegno con IVA compresa)
  for (const parte of PARTI) {
    for (const modo of MODALITA) {
      const nome = campoPagamento(parte.id, modo.id);
      f[nome] = campoImporto({ etichetta: `${modo.etichetta} (${modo.nota})`, centesimi: iniziali.valori[nome] });
      f[nome].input.setAttribute('aria-label', `${parte.etichetta}: ${modo.etichetta.toLowerCase()} (${modo.nota})`);
    }
  }

  function riempiZone(selezionata) {
    f.zona_id.riempi(modello().zone.filter((z) => z.attiva || z.id === selezionata).map((z) => ({ valore: z.id, etichetta: z.nome })), selezionata ?? '');
  }
  riempiZone(pratica?.zona_id ?? null);
  const aliquote = [...new Set([...(imp['iva.aliquote'] || [22]), aliquotaIniziale])].sort((a, b) => b - a);
  f.aliquota_iva.riempi(aliquote.map((a) => ({ valore: String(a), etichetta: a === 0 ? '0% (esente / non imponibile)' : `${String(a).replace('.', ',')}%` })), String(aliquotaIniziale));

  // ----------------------------------------------------------- ripartizione automatica a seconda della zona
  const quoteRegistrate = pratica ? pratica.voci.filter((v) => v.collaboratoreId != null).map((v) => ({ collaboratore_id: v.collaboratoreId, percentuale: v.quotaPct })) : [];
  const zonaIniziale = pratica?.zona_id ?? null;
  let quote = [];
  let origine = 'senza_zona';
  const zonaScelta = () => (f.zona_id.get() === '' ? null : +f.zona_id.get());
  function calcolaRipartizione() {
    const zonaId = zonaScelta();
    if (modifica && quoteRegistrate.length && zonaId === zonaIniziale) { quote = quoteRegistrate; origine = 'registrata'; return; }
    if (zonaId == null) { quote = []; origine = 'senza_zona'; return; }
    const r = ripartizioneAutomatica(app.archivio, zonaId, imp);
    quote = r.quote;
    origine = r.origine;
  }
  const boxRipartizione = h('div', { id: 'ripartizione-automatica' });
  function disegnaRipartizione() {
    const zona = modello().zone.find((z) => z.id === zonaScelta());
    const elenco = modello().collaboratori;
    const bottoneZona = (etichetta) => (zona ? h('button', { type: 'button', class: 'btn btn-secondario btn-sm', id: 'imposta-ripartizione-zona', onclick: () => apriDialogoRipartizione(zona, { dopo: () => { calcolaRipartizione(); disegnaRipartizione(); ricalcola(); } }) }, icona('handshake', { dimensione: 15 }), etichetta) : null);
    if (origine === 'senza_zona') {
      monta(boxRipartizione, h('p', { class: 'sottotesto' }, 'Scegli la zona: i compensi si dividono tra i collaboratori a seconda della zona.'));
      return;
    }
    if (!quote.length) {
      monta(boxRipartizione, h('div', { class: 'nota attenzione', id: 'ripartizione-mancante' }, icona('triangle-alert', { dimensione: 18 }),
        h('div', null, h('strong', null, `La zona “${zona?.nome ?? ''}” non ha una ripartizione. `), 'Senza, i compensi non vengono assegnati a nessun collaboratore e le provvigioni restano a zero. Imposta come si divide una pratica di questa zona: si fa una volta sola.')),
      h('div', { class: 'riga-azioni', style: { marginTop: '10px' } }, bottoneZona('Imposta la ripartizione della zona')));
      return;
    }
    const spiegazione = {
      zona: `Ripartizione impostata per la zona “${zona?.nome ?? ''}”.`,
      predefinita: `La zona “${zona?.nome ?? ''}” non ha una ripartizione propria: si usa quella predefinita.`,
      unico: 'C\'è un solo collaboratore attivo: tutto a lui.',
      registrata: 'Ripartizione già registrata per questa pratica: cambia solo se cambi la zona.',
    }[origine];
    monta(boxRipartizione,
      h('ul', { class: 'ripartizione-elenco', style: { display: 'grid', gap: '6px', listStyle: 'none', padding: 0, margin: 0 } }, quote.map((q) => {
        const c = elenco.find((x) => x.id === q.collaboratore_id);
        return h('li', { class: 'nome', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: `punto-col col-${c?.colore ?? 1}`, style: { width: '12px', height: '12px' }, 'aria-hidden': 'true' }), h('b', null, c?.nome ?? 'Collaboratore'), h('span', null, pct(q.percentuale)));
      })),
      h('p', { class: 'sottotesto', style: { marginTop: '8px' } }, spiegazione),
      origine === 'zona' || origine === 'predefinita' ? h('div', { class: 'riga-azioni', style: { marginTop: '8px' } }, bottoneZona('Cambia la ripartizione della zona')) : null);
  }

  // ----------------------------------------------------------- riepilogo e stima
  const riepilogo = h('div', { class: 'riepilogo-calcolo', 'aria-live': 'polite' });
  const stima = h('div', { class: 'stima-provvigione', 'aria-live': 'polite' });
  const nettoParte = Object.fromEntries(PARTI.map((p) => [p.id, h('div', { class: 'sottotesto forte', id: `compenso-${p.id}`, 'aria-live': 'polite', style: { marginTop: '8px' } })]));

  function leggiBozza() {
    const b = {
      id: pratica?.id ?? null,
      zona_id: zonaScelta(),
      immobile_tipo: f.immobile_tipo.get(),
      prezzo_vendita_cent: f.prezzo_vendita_cent.get(), prezzo_acquisto_cent: f.prezzo_acquisto_cent.get(),
      venditore: f.venditore.get(), acquirente: f.acquirente.get(),
      compensi_da_pagamenti: 1,
      aliquota_iva: Number(f.aliquota_iva.get()), note: f.note.get(),
    };
    for (const c of CAMPI_PAGAMENTO) b[c] = f[c].get() ?? 0;
    if (pratica) {
      // quello che il modulo non mostra resta com'era
      Object.assign(b, {
        codice: pratica.codice, stato: pratica.stato, data_pratica: pratica.data_pratica, data_rogito: pratica.data_rogito,
        immobile_indirizzo: pratica.immobile_indirizzo, immobile_comune: pratica.immobile_comune,
      });
    } else {
      // pratica nuova: inserita a conclusione, con la data di oggi (il numero lo assegna il programma)
      Object.assign(b, { stato: 'conclusa', data_pratica: oggi(), data_rogito: oggi() });
    }
    return b;
  }

  function ricalcola() {
    const b = leggiBozza();
    const c = calcolaCompensi(b);
    const prezzo = b.prezzo_vendita_cent;
    for (const parte of PARTI) {
      const x = c[parte.id];
      nettoParte[parte.id].textContent = x.pagatoCent > 0 ? `Compenso senza IVA ${parte.dal}: ${eur(x.imponibileCent)}${x.ivaCent > 0 ? ` (IVA compresa nei pagamenti: ${eur(x.ivaCent)})` : ''}` : '';
    }
    monta(riepilogo,
      h('div', { class: 'riga' }, h('span', null, 'Compenso dal venditore (senza IVA)'), h('span', { class: 'valore', id: 'riep-venditore' }, eur(c.venditore.imponibileCent))),
      h('div', { class: 'riga' }, h('span', null, 'Compenso dall\'acquirente (senza IVA)'), h('span', { class: 'valore', id: 'riep-acquirente' }, eur(c.acquirente.imponibileCent))),
      h('div', { class: 'riga' }, h('span', null, 'Totale compenso senza IVA'), h('span', { class: 'valore', id: 'riep-imponibile' }, eur(c.imponibileCent))),
      h('div', { class: 'riga' }, h('span', null, `IVA ${String(b.aliquota_iva).replace('.', ',')}% compresa in bonifico e assegno`), h('span', { class: 'valore', id: 'riep-iva' }, eur(c.ivaCent))),
      h('div', { class: 'riga totale' }, h('span', null, 'Totale pagato dalle parti'), h('span', { class: 'valore', id: 'riep-pagato' }, eur(c.pagatoCent))),
      prezzo && c.imponibileCent > 0 ? h('div', { class: 'riga' }, h('span', null, 'Compenso sul prezzo di vendita'), h('span', { class: 'valore' }, pct(Math.round((c.imponibileCent / prezzo) * 10000) / 100))) : null,
      pratica ? h('div', { class: 'riga' }, h('span', null, 'Già incassato (con eventuali incassi successivi)'), h('span', { class: 'valore' }, eur(pratica.incassatoCent))) : null,
    );
    // stima delle provvigioni
    let s;
    try { s = stimaPratica(app.archivio, b, quote, opzioniCalcolo(imp)); } catch (e) { console.error(e); s = null; }
    if (!s) { monta(stima); return; }
    const mm = s.modello;
    const nomi = new Map(mm.collaboratori.map((x) => [x.id, x.nome]));
    const righe = [];
    if (!quote.length) {
      righe.push(h('div', { class: 'stima-riga' }, h('div', { class: 'dettaglio' }, 'Scegli una zona con una ripartizione per vedere la stima delle provvigioni.')));
    } else if (!mm.tabellaPredefinita.length && !mm.tabellePerZona.size) {
      righe.push(h('div', { class: 'nota attenzione' }, icona('triangle-alert', { dimensione: 18 }), h('span', null, 'Gli scaglioni non sono ancora impostati: le provvigioni risultano a zero.'), h('a', { href: '#/impostazioni?sezione=scaglioni' }, 'Imposta')));
    } else {
      for (const v of s.pratica.voci.filter((x) => x.collaboratoreId != null)) {
        const cu = s.cumuli.find((x) => x.collaboratoreId === v.collaboratoreId || x.collaboratoreId === null);
        righe.push(h('div', { class: 'stima-riga' },
          h('div', { class: 'titolo' }, h('span', null, nomi.get(v.collaboratoreId) ?? 'Collaboratore'), h('span', { class: 'num' }, eur(v.provvigioneCent))),
          h('div', { class: 'dettaglio' }, `Quota ${pct(v.quotaPct)} dei compensi: ${eur(v.fatturatoCent)}`),
          cu ? h('div', { class: 'dettaglio' }, `Cumulo di ${meseAnno(cu.mese)}${cu.zonaNome ? ` in ${cu.zonaNome}` : ''}: ${eur(cu.fatturatoCent)} → scaglione ${cu.scaglioneIdx + 1} (${pct(cu.percentuale)})`) : null,
          cu?.prossimo ? h('div', { class: 'dettaglio' }, `Mancano ${eur(cu.prossimo.mancanteCent)} allo scaglione ${cu.prossimo.indice + 1} (${pct(cu.prossimo.percentuale)})`) : null));
      }
    }
    monta(stima,
      h('h3', { style: { fontSize: '14px', fontWeight: 700 } }, 'Stima delle provvigioni'),
      ...righe,
      h('p', { class: 'sottotesto' }, 'La stima si aggiorna se cambiano le altre pratiche del mese (gli scaglioni dipendono dal cumulo).'));
  }
  const ricalcolaRitardato = ritarda(ricalcola, 120);

  // ----------------------------------------------------------- collegamenti tra campi
  // Cambiando zona cambia la ripartizione (prima di ricalcolare tutto il resto).
  f.zona_id.input.addEventListener('change', () => { calcolaRipartizione(); disegnaRipartizione(); });
  for (const c of Object.values(f)) {
    c.input.addEventListener('input', () => { segnaSporco(); ricalcolaRitardato(); });
    c.input.addEventListener('change', () => { segnaSporco(); ricalcola(); });
  }

  const btnZona = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'nuova-zona', onclick: () => {
    const nome = campoTesto({ etichetta: 'Nome della zona', maxlength: 60, obbligatorio: true });
    const editor = editorRipartizione({ collaboratori: m.collaboratori.filter((c) => c.attivo) });
    apriModale({
      titolo: 'Nuova zona', icona: 'map-pin', larghezza: 560, invioConferma: true,
      descrizione: 'Scrivi il nome e, se già la sai, come si divide ogni pratica della zona tra i collaboratori. Puoi anche farlo dopo.',
      contenuto: h('form', { onsubmit: (e) => e.preventDefault() }, nome.el, h('h3', { style: { fontSize: '14px', fontWeight: 700, margin: '16px 0 8px' } }, 'Ripartizione tra i collaboratori'), editor.el),
      azioni: [{ id: 'annulla', etichetta: 'Annulla', tipo: 'secondario' }, { id: 'crea', etichetta: 'Crea zona', tipo: 'primario', onClick: async () => {
        const problema = editor.problema();
        if (problema) { editor.mostraErrore(problema); return false; }
        try {
          const id = await creaZona(app.archivio, { nome: nome.get() });
          if (editor.get().length) await salvaRipartizioneZona(app.archivio, id, editor.get());
          riempiZone(id);
          f.zona_id.set(id);
          segnaSporco();
          calcolaRipartizione(); disegnaRipartizione();
          notificaOk(`Zona “${nome.get()}” creata${editor.get().length ? ' con la sua ripartizione' : '. Ricorda di impostarne la ripartizione e, se sono diversi dai predefiniti, gli scaglioni'}.`);
          ricalcola();
        } catch (e) {
          if (e.campi && e.campi.nome) { nome.errore(e.campi.nome); return false; }
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
    for (const campo of ['prezzo_vendita_cent', 'prezzo_acquisto_cent', ...CAMPI_PAGAMENTO]) {
      if (!f[campo].valido()) errori[campo] = 'Scrivi un importo valido, ad esempio 1.500,00';
    }
    if (b.zona_id === null) errori.zona_id = 'Scegli la zona: serve per dividere i compensi tra i collaboratori.';
    return { b, errori };
  }

  async function salva(dopo) {
    if (salvataggioInCorso) return;
    const { b, errori } = raccogli();
    if (Object.keys(errori).length) { mostraErrori(f, errori); focusPrimo(errori); notificaErrore('Controlla i campi evidenziati.'); return; }
    if (!quote.length) {
      const procedi = await conferma({
        titolo: 'La zona non ha una ripartizione', tipo: 'primario', etichettaConferma: 'Salva comunque', icona: 'triangle-alert',
        messaggio: 'Senza ripartizione i compensi non vengono assegnati a nessun collaboratore e le provvigioni restano a zero. La pratica verrà segnalata tra quelle con dati mancanti.',
        dettagli: ['Puoi impostare la ripartizione della zona (pulsante nel modulo) e poi salvare.'],
      });
      if (!procedi) return;
    }
    salvataggioInCorso = true;
    try {
      const id = await salvaPratica(app.archivio, b, quote);
      const codice = app.archivio.valore('SELECT codice FROM pratiche WHERE id = ?', [id]);
      sporco = false;
      notificaOk(`Pratica ${codice} ${modifica ? 'aggiornata' : 'salvata'}.`);
      if (dopo === 'nuova') {
        rimonta(); // modulo vuoto, pronto per la pratica successiva
      } else {
        naviga(`#/pratiche/${id}`);
      }
    } catch (e) {
      if (e.campi) {
        const primo = mostraErrori(f, e.campi);
        focusPrimo(e.campi, primo);
        notificaErrore(e.campi.quote || 'Controlla i campi evidenziati.');
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

  const gruppoParte = (parte) => h('fieldset', { class: 'gruppo-pagamenti', id: `pagamenti-${parte.id}`, style: { border: 0, padding: 0, margin: '0 0 18px' } },
    h('legend', { class: 'sezione-titolo', style: { padding: 0, marginBottom: '8px' } }, `Pagato ${parte.dal}`),
    h('div', { class: 'griglia-campi' }, MODALITA.map((modo) => h('div', { class: 'c-4' }, f[campoPagamento(parte.id, modo.id)].el))),
    nettoParte[parte.id]);

  const form = h('form', { novalidate: true, id: 'form-pratica', onsubmit: (e) => { e.preventDefault(); salva('scheda'); } },
    h('div', { class: 'form-layout' },
      h('div', { class: 'form-colonna' },
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Zona e immobile'),
          h('p', { class: 'descrizione', id: 'data-pratica' }, modifica ? `Data della pratica: ${dataIt(dataPratica)}.` : `Data della pratica: ${dataIt(dataPratica)} (quella di oggi, assegnata in automatico).`),
          h('div', { class: 'griglia-campi' },
            h('div', { class: 'c-6' }, f.zona_id.el, h('div', { style: { marginTop: '4px' } }, btnZona)),
            h('div', { class: 'c-6' }, f.immobile_tipo.el),
            h('div', { class: 'c-6' }, f.prezzo_vendita_cent.el), h('div', { class: 'c-6' }, f.prezzo_acquisto_cent.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Parti'),
          h('div', { class: 'griglia-campi' }, h('div', { class: 'c-6' }, f.venditore.el), h('div', { class: 'c-6' }, f.acquirente.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Compensi di agenzia'),
          h('p', { class: 'descrizione' }, 'Scrivi quanto ha pagato ciascuna parte e come. I contanti sono già senza IVA; bonifico e assegno comprendono l\'IVA, che il programma toglie per calcolare il compenso su cui si fanno scaglioni e provvigioni.'),
          iniziali.daConvertire ? h('div', { class: 'nota', id: 'nota-pratica-vecchia', style: { marginBottom: '14px' } }, icona('info', { dimensione: 18 }), h('span', null, 'Questa pratica era stata inserita con il solo compenso senza IVA: qui è riportata come bonifico con IVA compresa. Correggi il modo di pagamento se serve e salva.')) : null,
          gruppoParte(PARTI[0]), gruppoParte(PARTI[1]),
          h('div', { class: 'griglia-campi' }, h('div', { class: 'c-4' }, f.aliquota_iva.el))),
        h('section', { class: 'card sezione-modulo' }, h('h2', null, 'Ripartizione tra i collaboratori'),
          h('p', { class: 'descrizione' }, 'Automatica: segue la zona, non c\'è niente da scegliere. Da qui si calcolano fatturato e provvigioni di ciascuno.'),
          boxRipartizione),
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
        h('p', null, modifica ? 'Cambia i dati e salva: provvigioni, cumulo e grafici si aggiornano subito.' : 'Inserisci la compravendita conclusa: scegli la zona e scrivi quanto ha pagato ciascuna parte. Numero, data e ripartizione tra i collaboratori sono automatici.'))),
    form);
  calcolaRipartizione();
  disegnaRipartizione();
  ricalcola();
  if (!modifica) f.zona_id.input.focus();
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
