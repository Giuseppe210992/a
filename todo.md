# B&B Tracker - TODO

## Database & Schema
- [ ] Schema database: hotels, users, guests, checkins, signatures, documents
- [ ] Migrazioni database per multi-tenancy
- [ ] Relazioni e indici per performance

## Backend - Autenticazione & Autorizzazione
- [ ] Setup OAuth Manus con ruoli (admin_hotel, operator)
- [ ] Middleware multi-tenancy per isolamento dati
- [ ] Procedure tRPC protette per ruoli

## Backend - Modulo OCR
- [ ] Integrazione LLM per estrazione dati documento (nome, cognome, data nascita, numero documento, sesso, cittadinanza)
- [ ] Supporto OCR per carta d'identità, passaporto, patente di guida (internazionali)
- [ ] Validazione incrociata documento vs prenotazione
- [ ] Rilevamento automatico importo dalla prenotazione

## Backend - Firma GDPR
- [ ] API per salvare firma digitale (canvas base64)
- [ ] Archiviazione firma su cloud storage con riferimento nel database
- [ ] Associazione firma a check-in specifico

## Backend - Gestione Check-in
- [ ] Creazione check-in con ospite principale
- [ ] Aggiunta ospiti aggiuntivi con acquisizione documenti
- [ ] Validazione dati ospiti
- [ ] Salvataggio immagini documenti su cloud storage

## Backend - Generazione PDF
- [ ] Generazione PDF ricevuta check-in con dati ospiti e firma GDPR
- [ ] Salvataggio PDF su cloud storage

## Backend - Conformità Normativa
- [ ] Integrazione SOAP Alloggiati Web per invio dati check-in
- [ ] Generazione file ISTAT Ross1000
- [ ] Validazione dati per conformità normativa italiana

## Backend - Notifiche
- [ ] Sistema di notifiche automatiche al completamento check-in
- [ ] Invio notifica con nome ospite e importo all'admin struttura
- [ ] Logging notifiche inviate

## Backend - Reportistica
- [ ] Query per estrazione dati check-in mensili
- [ ] Generazione CSV report mensile
- [ ] Generazione PDF report mensile con statistiche

## Frontend - Autenticazione
- [ ] Login con OAuth Manus
- [ ] Selezione struttura per operatori multi-struttura
- [ ] Logout

## Frontend - Dashboard
- [ ] Panoramica camere (occupate/libere/in manutenzione)
- [ ] Elenco check-in recenti
- [ ] Statistiche mensili (numero check-in, importo totale, media)
- [ ] Accesso rapido a nuovo check-in

## Frontend - Flusso Check-in
- [ ] Pagina acquisizione foto documento principale
- [ ] Visualizzazione dati estratti OCR con possibilità di modifica
- [ ] Canvas per firma digitale GDPR
- [ ] Selezione numero ospiti
- [ ] Acquisizione documenti ospiti aggiuntivi
- [ ] Visualizzazione dati prenotazione
- [ ] Conferma e finalizzazione check-in

## Frontend - Gestione Strutture
- [ ] Profilo struttura (nome, indirizzo, contatti)
- [ ] Configurazione parametri (WSKEY Alloggiati, Codice Ross1000)
- [ ] Gestione utenti struttura (admin, operatori)
- [ ] Cronologia check-in struttura

## Frontend - Reportistica
- [ ] Visualizzazione report mensile
- [ ] Download CSV report
- [ ] Download PDF report
- [ ] Filtri per data, ospite, importo

## Frontend - UI/UX
- [ ] Design sistema con tema scuro professionale
- [ ] Layout responsive per desktop e tablet
- [ ] Componenti riutilizzabili (card, form, modal)
- [ ] Feedback visivi (loading, success, error)
- [ ] Accessibilità WCAG

## Testing
- [ ] Unit test backend (OCR, validazione, generazione PDF)
- [ ] Unit test frontend (componenti, hook)
- [ ] Test integrazione flusso check-in end-to-end
- [ ] Test conformità normativa (SOAP, Ross1000)

## Deployment & Ottimizzazione
- [ ] Configurazione per Oracle Cloud AMD
- [ ] Ottimizzazione performance database
- [ ] Caching strategico
- [ ] Monitoraggio e logging
- [ ] Documentazione deploy

## Documentazione
- [ ] README con istruzioni setup
- [ ] Guida utente operatore
- [ ] Guida amministratore struttura
- [ ] API documentation
- [ ] Architettura tecnica
