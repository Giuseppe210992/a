// Avvisi automatici (non invasivi): dati mancanti, provvigioni da liquidare, scaglioni vicini,
// backup non recente, integrita' del database, configurazione incompleta.
import { app, modello, impostazioni } from '../core/app.js';
import { chiaveMese, oggi } from '../core/dates.js';
import { eur, num } from '../core/format.js';
import { verificaIntegrita } from '../data/integrity.js';
import { ultimoBackup, creaBackup } from '../data/backup.js';

const ORDINE = { critico: 0, avviso: 1, info: 2 };
let cacheIntegrita = { v: -1, esito: null };

export function integritaCorrente() {
  if (cacheIntegrita.v !== app.archivio.versione) {
    cacheIntegrita = { v: app.archivio.versione, esito: verificaIntegrita(app.archivio, modello()) };
  }
  return cacheIntegrita.esito;
}

function giorniDa(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)); // mai negativo, anche se l'orologio del computer è stato spostato
}

/** Restituisce l'elenco degli avvisi, dal piu' urgente. */
export async function calcolaAvvisi() {
  const m = modello();
  const imp = impostazioni();
  const lista = [];

  // 1) integrita' del database
  const ig = integritaCorrente();
  if (ig.errori > 0) {
    lista.push({
      id: 'integrita', livello: 'critico', icona: 'shield-alert',
      titolo: 'Problemi di integrità del database',
      testo: `${ig.errori === 1 ? '1 errore' : `${ig.errori} errori`} da correggere${ig.avvisi ? ` e ${ig.avvisi} da controllare` : ''}. Apri la verifica per vedere i dettagli.`,
      azione: { etichetta: 'Vai alla verifica', href: '#/backup?sezione=integrita' },
    });
  } else if (ig.avvisi > 0) {
    lista.push({
      id: 'integrita-avvisi', livello: 'avviso', icona: 'shield-check',
      titolo: 'Incongruenze da controllare nei dati',
      testo: `${ig.avvisi === 1 ? '1 situazione' : `${ig.avvisi} situazioni`} (incassi o liquidazioni fuori misura). I dati sono integri, ma conviene verificarli.`,
      azione: { etichetta: 'Vedi dettagli', href: '#/backup?sezione=integrita' },
    });
  }

  // 2) backup
  const archivioVuoto = m.pratiche.length === 0 && m.zone.length === 0;
  if (!archivioVuoto) {
    let ultimo = null;
    try { ultimo = await ultimoBackup(app); } catch { /* elenco non disponibile */ }
    const soglia = Number(imp['avvisi.giorniBackup']) || 7;
    if (!ultimo) {
      lista.push({
        id: 'backup', livello: 'avviso', icona: 'database-backup',
        titolo: 'Nessun backup eseguito',
        testo: 'Non risulta nessuna copia di sicurezza dei tuoi dati. Creane una ora: richiede pochi secondi.',
        azione: { etichetta: 'Crea backup ora', esegui: async () => { await creaBackup(app, 'manuale'); } },
      });
    } else if (giorniDa(ultimo) >= soglia) {
      const g = giorniDa(ultimo);
      lista.push({
        id: 'backup', livello: 'avviso', icona: 'database-backup',
        titolo: 'Backup non recente',
        testo: `L'ultimo backup risale a ${g} giorni fa (soglia: ${soglia} giorni).`,
        azione: { etichetta: 'Crea backup ora', esegui: async () => { await creaBackup(app, 'manuale'); } },
      });
    }
  }

  // 3) pratiche con dati mancanti
  const incomplete = m.pratiche.filter((p) => p.incompleta && !p.annullata);
  if (incomplete.length) {
    lista.push({
      id: 'mancanti', livello: 'avviso', icona: 'list-checks',
      titolo: incomplete.length === 1 ? '1 pratica con dati mancanti' : `${incomplete.length} pratiche con dati mancanti`,
      testo: 'Completa i dati per avere calcoli e statistiche corretti.',
      dettagli: incomplete.slice(0, 3).map((p) => `${p.codice}: ${p.mancanti.map((x) => x.testo).join(', ')}`),
      azione: { etichetta: 'Vedi le pratiche', href: '#/pratiche?incomplete=1' },
    });
  }

  // 4) provvigioni da liquidare
  const daLiq = m.collaboratori.filter((c) => c.daLiquidareCent > 0);
  const totaleDaLiq = daLiq.reduce((s, c) => s + c.daLiquidareCent, 0);
  if (totaleDaLiq > 0) {
    lista.push({
      id: 'liquidare', livello: 'info', icona: 'hand-coins',
      titolo: `Provvigioni da liquidare: ${eur(totaleDaLiq)}`,
      testo: daLiq.map((c) => `${c.nome} ${eur(c.daLiquidareCent)}`).join(' · '),
      azione: { etichetta: 'Registra liquidazione', href: '#/provvigioni?registra=liquidazione' },
    });
  }

  // 5) scaglioni prossimi al raggiungimento (mese corrente)
  const soglia = Number(imp['avvisi.sogliaScaglionePct']) || 20;
  const meseOggi = chiaveMese(oggi());
  const vicini = m.cumuli.filter((c) => c.mese === meseOggi && c.prossimo && c.fatturatoCent > 0
    && c.prossimo.mancanteCent > 0 && c.prossimo.mancanteCent <= (c.prossimo.da * soglia) / 100);
  for (const c of vicini) {
    const chi = [c.collaboratoreNome, c.zonaNome].filter(Boolean).join(' · ') || 'Cumulo del mese';
    lista.push({
      id: `scaglione-${c.chiave}`, livello: 'info', icona: 'target',
      titolo: `Scaglione vicino: ${chi}`,
      testo: `Mancano ${eur(c.prossimo.mancanteCent)} per lo scaglione ${c.prossimo.indice + 1} (${num(c.prossimo.percentuale)}%).`,
      azione: { etichetta: 'Apri il cumulo', href: '#/cumulo' },
    });
  }

  // 6) configurazione incompleta che falserebbe i calcoli
  const concluse = m.pratiche.filter((p) => p.conclusa).length;
  if (concluse > 0 && m.tabellaPredefinita.length === 0) {
    lista.push({
      id: 'config-scaglioni', livello: 'avviso', icona: 'sliders-horizontal',
      titolo: 'Scaglioni non configurati',
      testo: 'Senza scaglioni le provvigioni risultano a zero. Imposta le soglie e le percentuali.',
      azione: { etichetta: 'Vai alle impostazioni', href: '#/impostazioni?sezione=scaglioni' },
    });
  }

  return lista.sort((a, b) => ORDINE[a.livello] - ORDINE[b.livello]);
}

const nascosti = new Set();
const ascoltatoriNascosti = new Set();
const avvisaCambio = () => { for (const f of [...ascoltatoriNascosti]) f(); };
export const avvisiNascosti = {
  ha: (a) => nascosti.has(`${a.id}|${a.testo}`),
  nascondi: (a) => { nascosti.add(`${a.id}|${a.testo}`); avvisaCambio(); },
  ripristinaTutti: () => { nascosti.clear(); avvisaCambio(); },
  quanti: () => nascosti.size,
  /** Chiama f ogni volta che un avviso viene nascosto o ripristinato (serve a tenere aggiornato il numero sulla campanella). */
  alCambio: (f) => { ascoltatoriNascosti.add(f); return () => ascoltatoriNascosti.delete(f); },
};
