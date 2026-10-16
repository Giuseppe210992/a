// Contenuto iniziale di un archivio vuoto. Nessun dato dimostrativo: i due collaboratori indicati nella
// specifica (Luca e Giuseppe), modificabili o eliminabili da Impostazioni, e la tabella degli scaglioni dell'agenzia.
import { creaCollaboratore, salvaTabellaScaglioni } from './repo/anagrafiche.js';
import { registra } from './repo/impostazioni.js';

export const COLLABORATORI_INIZIALI = ['Luca', 'Giuseppe'];

// Scaglioni indicati dall'agenzia, uguali per Luca e Giuseppe e per tutte le zone (percentuale sul cumulo mensile):
//   5% fino a 2.600 €, 8% fino a 5.200 €, 11% fino a 7.800 €, 15% fino a 13.000 €, 20% oltre 13.000 €.
// Ogni soglia vale «da» (inclusa) e «fino a» comprende il suo estremo: per questo lo scaglione successivo parte
// da un centesimo dopo (2.600,00 € precisi sono ancora al 5%; da 2.600,01 € si passa all'8%).
export const SCAGLIONI_INIZIALI = [
  { da_cent: 0, percentuale: 5 },
  { da_cent: 260001, percentuale: 8 },
  { da_cent: 520001, percentuale: 11 },
  { da_cent: 780001, percentuale: 15 },
  { da_cent: 1300001, percentuale: 20 },
];

export async function seedPrimoAvvio(archivio) {
  await archivio.transazione(() => {
    for (const nome of COLLABORATORI_INIZIALI) creaCollaboratore(archivio, { nome });
    salvaTabellaScaglioni(archivio, null, SCAGLIONI_INIZIALI);
    registra(archivio, 'archivio_creato', 'Archivio creato al primo avvio');
  }, { silenzioso: true });
}
