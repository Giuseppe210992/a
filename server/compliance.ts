import { Checkin, Guest } from "../drizzle/schema";

/**
 * Genera il file XML per l'invio ad Alloggiati Web (SOAP)
 * Conforme alle specifiche della Questura italiana
 */
export function generateAlloggiatiXML(
  hotelCode: string,
  checkin: Checkin,
  mainGuest: Guest,
  additionalGuests: Guest[]
): string {
  const checkInDate = new Date(checkin.checkInDate);
  const dateStr = checkInDate.toISOString().split("T")[0];

  let guestsXML = generateGuestXML(mainGuest, 1);
  additionalGuests.forEach((guest, index) => {
    guestsXML += generateGuestXML(guest, index + 2);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<Schedina xmlns="http://www.alloggiati.gov.it/schedina">
  <CodiceStruttura>${escapeXml(hotelCode)}</CodiceStruttura>
  <DataArrivo>${dateStr}</DataArrivo>
  <NumeroOspiti>${checkin.numberOfGuests}</NumeroOspiti>
  <Ospiti>
    ${guestsXML}
  </Ospiti>
  <NumeroCamera>${escapeXml(checkin.roomNumber || "")}</NumeroCamera>
  <Importo>${checkin.amount || 0}</Importo>
  <DataInvio>${new Date().toISOString().split("T")[0]}</DataInvio>
</Schedina>`;
}

function generateGuestXML(guest: Guest, order: number): string {
  const documentTypeMap: Record<string, string> = {
    id_card: "CI",
    passport: "P",
    driving_license: "PA",
  };

  const docType = documentTypeMap[guest.documentType] || guest.documentType;

  return `
    <Ospite>
      <Ordine>${order}</Ordine>
      <Nome>${escapeXml(guest.firstName)}</Nome>
      <Cognome>${escapeXml(guest.lastName)}</Cognome>
      <DataNascita>${guest.dateOfBirth || ""}</DataNascita>
      <Sesso>${guest.gender || ""}</Sesso>
      <Cittadinanza>${escapeXml(guest.citizenship || "")}</Cittadinanza>
      <TipoDocumento>${docType}</TipoDocumento>
      <NumeroDocumento>${escapeXml(guest.documentNumber)}</NumeroDocumento>
    </Ospite>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Genera il file ISTAT Ross1000 per la comunicazione statistica
 * Formato CSV conforme alle specifiche ISTAT
 */
export function generateRoss1000CSV(
  checkins: Array<{
    checkin: Checkin;
    mainGuest: Guest;
    additionalGuests: Guest[];
  }>
): string {
  const headers = [
    "DATA_ARRIVO",
    "COGNOME",
    "NOME",
    "DATA_NASCITA",
    "SESSO",
    "CITTADINANZA",
    "TIPO_DOCUMENTO",
    "NUMERO_DOCUMENTO",
    "NUMERO_CAMERA",
    "NUMERO_OSPITI",
    "IMPORTO",
  ];

  const rows: string[] = [headers.join(";")];

  checkins.forEach(({ checkin, mainGuest, additionalGuests }) => {
    const dateStr = new Date(checkin.checkInDate)
      .toISOString()
      .split("T")[0];

    // Main guest
    rows.push(
      [
        dateStr,
        mainGuest.lastName,
        mainGuest.firstName,
        mainGuest.dateOfBirth || "",
        mainGuest.gender || "",
        mainGuest.citizenship || "",
        mainGuest.documentType,
        mainGuest.documentNumber,
        checkin.roomNumber || "",
        checkin.numberOfGuests,
        checkin.amount || "",
      ].join(";")
    );

    // Additional guests
    additionalGuests.forEach((guest) => {
      rows.push(
        [
          dateStr,
          guest.lastName,
          guest.firstName,
          guest.dateOfBirth || "",
          guest.gender || "",
          guest.citizenship || "",
          guest.documentType,
          guest.documentNumber,
          checkin.roomNumber || "",
          "",
          "",
        ].join(";")
      );
    });
  });

  return rows.join("\n");
}

/**
 * Valida i dati del check-in per la conformità normativa
 */
export function validateComplianceData(
  checkin: Checkin,
  mainGuest: Guest,
  additionalGuests: Guest[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validazione ospite principale
  if (!mainGuest.firstName) errors.push("Nome ospite principale mancante");
  if (!mainGuest.lastName) errors.push("Cognome ospite principale mancante");
  if (!mainGuest.documentType) errors.push("Tipo documento mancante");
  if (!mainGuest.documentNumber)
    errors.push("Numero documento mancante");
  if (!mainGuest.dateOfBirth)
    errors.push("Data di nascita ospite principale mancante");

  // Validazione ospiti aggiuntivi
  additionalGuests.forEach((guest, index) => {
    if (!guest.firstName) errors.push(`Nome ospite ${index + 2} mancante`);
    if (!guest.lastName) errors.push(`Cognome ospite ${index + 2} mancante`);
    if (!guest.documentType) errors.push(`Tipo documento ospite ${index + 2} mancante`);
    if (!guest.documentNumber)
      errors.push(`Numero documento ospite ${index + 2} mancante`);
  });

  // Validazione check-in
  if (!checkin.roomNumber) errors.push("Numero camera mancante");
  if (!checkin.numberOfGuests || checkin.numberOfGuests < 1)
    errors.push("Numero ospiti non valido");
  if (checkin.numberOfGuests !== additionalGuests.length + 1)
    errors.push("Numero ospiti non corrisponde ai dati inseriti");

  return {
    valid: errors.length === 0,
    errors,
  };
}
