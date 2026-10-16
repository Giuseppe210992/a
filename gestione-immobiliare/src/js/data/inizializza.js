// Contenuto iniziale di un archivio vuoto. Nessun dato dimostrativo: solo i due collaboratori
// indicati nella specifica (Luca e Giuseppe), modificabili o eliminabili da Impostazioni.
import { creaCollaboratore } from './repo/anagrafiche.js';
import { registra } from './repo/impostazioni.js';

export const COLLABORATORI_INIZIALI = ['Luca', 'Giuseppe'];

export async function seedPrimoAvvio(archivio) {
  await archivio.transazione(() => {
    for (const nome of COLLABORATORI_INIZIALI) creaCollaboratore(archivio, { nome });
    registra(archivio, 'archivio_creato', 'Archivio creato al primo avvio');
  }, { silenzioso: true });
}
