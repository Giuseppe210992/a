// Dati di PROVA per i test nel browser: vengono inseriti dal test, non fanno parte del programma.
// Zone, scaglioni e pratiche sono inventati solo per verificare calcoli e grafici.

export async function inserisciDatiProva(page) {
  return page.evaluate(async () => {
    const { api, app } = window.__gi;
    const a = app.archivio;
    const E = 100;
    const zA = await api.creaZona(a, { nome: 'Centro' });
    const zB = await api.creaZona(a, { nome: 'Lungomare' });
    const zC = await api.creaZona(a, { nome: 'Collina' });
    await api.salvaTabellaScaglioni(a, null, [
      { da_cent: 0, percentuale: 30 }, { da_cent: 10000 * E, percentuale: 35 }, { da_cent: 20000 * E, percentuale: 40 },
    ]);
    const [luca, giuseppe] = api.elencoCollaboratori(a);
    const mk = async (n, mese, giorno, zona, indirizzo, prezzo, acquisto, cv, ca, quote, extra = {}) => {
      const anno = 2026;
      const rogito = `${anno}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
      const apertura = new Date(Date.UTC(anno, mese - 1, giorno - 40)).toISOString().slice(0, 10);
      return api.salvaPratica(a, {
        codice: `2026/${String(n).padStart(3, '0')}`, stato: 'conclusa', data_pratica: apertura, data_rogito: rogito, zona_id: zona,
        immobile_indirizzo: indirizzo, immobile_comune: 'Minturno', immobile_tipo: 'Appartamento',
        prezzo_vendita_cent: prezzo * E, prezzo_acquisto_cent: acquisto ? acquisto * E : null,
        venditore: `Venditore ${n}`, acquirente: `Acquirente ${n}`,
        compenso_venditore_cent: cv * E, compenso_acquirente_cent: ca * E, aliquota_iva: 22, ...extra,
      }, quote);
    };
    const ids = [];
    ids.push(await mk(1, 1, 14, zA, 'Via Roma 12', 140000, 110000, 2800, 2800, [{ collaboratore_id: luca.id, percentuale: 100 }]));
    ids.push(await mk(2, 2, 20, zB, 'Via Lungomare 3', 210000, null, 4200, 4200, [{ collaboratore_id: giuseppe.id, percentuale: 100 }]));
    ids.push(await mk(3, 3, 9, zA, 'Via Garibaldi 8', 95000, 100000, 1900, 1900, [{ collaboratore_id: luca.id, percentuale: 50 }, { collaboratore_id: giuseppe.id, percentuale: 50 }]));
    ids.push(await mk(4, 4, 22, zC, 'Via dei Pini 5', 180000, 150000, 3600, 3600, [{ collaboratore_id: luca.id, percentuale: 100 }]));
    ids.push(await mk(5, 5, 6, zB, 'Via del Mare 21', 260000, 200000, 5200, 5200, [{ collaboratore_id: giuseppe.id, percentuale: 100 }]));
    ids.push(await mk(6, 6, 18, zA, 'Corso Vittorio 40', 130000, null, 2600, 2600, [{ collaboratore_id: luca.id, percentuale: 60 }, { collaboratore_id: giuseppe.id, percentuale: 40 }]));
    ids.push(await mk(7, 7, 11, zA, 'Via Appia 100', 175000, 160000, 3500, 3500, [{ collaboratore_id: luca.id, percentuale: 100 }]));
    ids.push(await mk(8, 8, 25, zB, 'Lungomare Colombo 7', 320000, 250000, 6400, 6400, [{ collaboratore_id: giuseppe.id, percentuale: 100 }]));
    ids.push(await mk(9, 9, 15, zC, 'Via dei Colli 2', 88000, 90000, 1760, 1760, [{ collaboratore_id: luca.id, percentuale: 100 }]));
    ids.push(await mk(10, 10, 2, zA, 'Via Verdi 15', 150000, 120000, 3000, 3000, [{ collaboratore_id: luca.id, percentuale: 100 }]));
    ids.push(await mk(11, 10, 9, zA, 'Via Mazzini 9', 200000, 170000, 4000, 4000, [{ collaboratore_id: luca.id, percentuale: 100 }]));
    ids.push(await mk(12, 10, 12, zB, 'Via Pergolesi 1', 230000, null, 4600, 4600, [{ collaboratore_id: giuseppe.id, percentuale: 100 }]));
    // pratiche in corso e una incompleta
    await api.salvaPratica(a, { codice: '2026/013', stato: 'in_corso', data_pratica: '2026-10-05', zona_id: zA, immobile_indirizzo: 'Via Nuova 4', immobile_comune: 'Minturno', immobile_tipo: 'Villa / villetta', prezzo_vendita_cent: 310000 * E, compenso_venditore_cent: 6200 * E, compenso_acquirente_cent: 0, aliquota_iva: 22 }, [{ collaboratore_id: luca.id, percentuale: 100 }]);
    await api.salvaPratica(a, { codice: '2026/014', stato: 'in_corso', data_pratica: '2026-09-20', zona_id: null, immobile_indirizzo: 'Via Senza Zona 1', immobile_comune: 'Formia', immobile_tipo: 'Terreno', compenso_venditore_cent: 0, compenso_acquirente_cent: 0, aliquota_iva: 22 }, []);
    await api.salvaPratica(a, { codice: '2026/015', stato: 'conclusa', data_pratica: '2026-09-01', data_rogito: null, zona_id: zB, immobile_indirizzo: 'Via Incompleta 9', immobile_comune: 'Gaeta', immobile_tipo: 'Box / garage', compenso_venditore_cent: 800 * E, compenso_acquirente_cent: 0, aliquota_iva: 22 }, [{ collaboratore_id: giuseppe.id, percentuale: 100 }]);
    // incassi e liquidazioni
    await api.registraIncasso(a, { praticaId: ids[0], data: '2026-01-20', importoCent: 683200, pagante: 'Venditore', metodo: 'Bonifico' });
    await api.registraIncasso(a, { praticaId: ids[1], data: '2026-02-25', importoCent: 1024800, pagante: 'Acquirente', metodo: 'Bonifico' });
    await api.registraIncasso(a, { praticaId: ids[2], data: '2026-03-12', importoCent: 463600 });
    await api.registraIncasso(a, { praticaId: ids[9], data: '2026-10-05', importoCent: 366000 });
    await api.registraLiquidazione(a, { collaboratoreId: luca.id, data: '2026-02-05', metodo: 'Bonifico', righe: [{ praticaId: ids[0], importoCent: 168000 }] });
    await api.registraLiquidazione(a, { collaboratoreId: giuseppe.id, data: '2026-03-10', metodo: 'Bonifico', righe: [{ praticaId: ids[1], importoCent: 252000 }, { praticaId: ids[4], importoCent: 100000 }] });
    await api.registraLiquidazione(a, { collaboratoreId: luca.id, data: '2026-05-10', righe: [{ praticaId: ids[3], importoCent: 108000 }, { praticaId: ids[2], importoCent: 28500 }] });
    return { zone: [zA, zB, zC], luca: luca.id, giuseppe: giuseppe.id, ids };
  });
}
