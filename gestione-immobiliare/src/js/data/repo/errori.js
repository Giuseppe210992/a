/** Errore di validazione: contiene un messaggio per ogni campo da correggere. */
export class ErroreValidazione extends Error {
  constructor(campi, messaggio) {
    super(messaggio || Object.values(campi)[0] || 'Dati non validi.');
    this.name = 'ErroreValidazione';
    this.campi = campi;
  }
}

/** Errore per operazioni non consentite (es. eliminare qualcosa che e' in uso). */
export class ErroreOperazione extends Error {
  constructor(messaggio, dettagli = null) {
    super(messaggio);
    this.name = 'ErroreOperazione';
    this.dettagli = dettagli;
  }
}
