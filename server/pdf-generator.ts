import PDFDocument from "pdfkit";
import { storagePut } from "./storage";
import { Checkin, Guest } from "../drizzle/schema";

interface CheckinPDFData {
  checkin: Checkin;
  mainGuest: Guest;
  additionalGuests: Guest[];
  signatureImageUrl?: string;
  hotelName: string;
  hotelAddress: string;
}

/**
 * Genera un PDF di ricevuta check-in con firma GDPR
 */
export async function generateCheckinPDF(data: CheckinPDFData): Promise<{
  url: string;
  key: string;
}> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", async () => {
        const pdfBuffer = Buffer.concat(chunks);
        const timestamp = Date.now();
        const fileKey = `receipts/checkin_${data.checkin.id}_${timestamp}.pdf`;
        const { url, key } = await storagePut(fileKey, pdfBuffer, "application/pdf");
        resolve({ url, key });
      });

      // Header
      doc.fontSize(16).font("Helvetica-Bold").text("CHECK-IN RICEVUTA", { align: "center" });
      doc.moveDown(0.5);

      // Hotel info
      doc.fontSize(12).font("Helvetica-Bold").text(data.hotelName);
      doc.fontSize(10).font("Helvetica").text(data.hotelAddress);
      doc.moveDown(0.5);

      // Check-in details
      doc.fontSize(11).font("Helvetica-Bold").text("DETTAGLI CHECK-IN");
      doc.fontSize(10).font("Helvetica");

      const checkInDate = new Date(data.checkin.checkInDate).toLocaleDateString("it-IT");
      doc.text(`Data Check-in: ${checkInDate}`);

      if (data.checkin.roomNumber) {
        doc.text(`Camera: ${data.checkin.roomNumber}`);
      }

      doc.text(`Numero Ospiti: ${data.checkin.numberOfGuests}`);

      if (data.checkin.amount) {
        doc.text(`Importo: ${data.checkin.amount} ${data.checkin.currency}`);
      }

      doc.moveDown(0.5);

      // Guest info
      doc.fontSize(11).font("Helvetica-Bold").text("OSPITI");
      doc.fontSize(10).font("Helvetica-Bold").text(`${data.mainGuest.firstName} ${data.mainGuest.lastName}`);
      doc.fontSize(9).font("Helvetica");
      doc.text(`Documento: ${data.mainGuest.documentType} - ${data.mainGuest.documentNumber}`);

      if (data.mainGuest.dateOfBirth) {
        doc.text(`Data Nascita: ${data.mainGuest.dateOfBirth}`);
      }

      if (data.mainGuest.citizenship) {
        doc.text(`Cittadinanza: ${data.mainGuest.citizenship}`);
      }

      doc.moveDown(0.3);

      // Additional guests
      data.additionalGuests.forEach((guest) => {
        doc.fontSize(10).font("Helvetica-Bold").text(`${guest.firstName} ${guest.lastName}`);
        doc.fontSize(9).font("Helvetica");
        doc.text(`Documento: ${guest.documentType} - ${guest.documentNumber}`);

        if (guest.dateOfBirth) {
          doc.text(`Data Nascita: ${guest.dateOfBirth}`);
        }

        doc.moveDown(0.3);
      });

      // GDPR section
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica-Bold").text("CONSENSO GDPR");
      doc.fontSize(9).font("Helvetica");
      doc.text(
        "Il sottoscritto/a autorizza il trattamento dei propri dati personali secondo la normativa GDPR (Regolamento UE 2016/679) per le finalità di gestione della prenotazione e conformità normativa italiana.",
        { align: "left", width: 500 }
      );

      // Signature
      if (data.signatureImageUrl) {
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica-Bold").text("Firma Ospite:");
        doc.fontSize(9).font("Helvetica").text("[Firma digitale acquisita]");
      }

      doc.moveDown(1);
      doc.fontSize(8).font("Helvetica").text(`Generato il: ${new Date().toLocaleString("it-IT")}`, {
        align: "center",
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Genera un report mensile in PDF
 */
export async function generateMonthlyReportPDF(
  hotelName: string,
  month: number,
  year: number,
  checkins: Array<{
    date: string;
    guestName: string;
    amount: string;
    status: string;
  }>
): Promise<{ url: string; key: string }> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", async () => {
        const pdfBuffer = Buffer.concat(chunks);
        const timestamp = Date.now();
        const fileKey = `reports/monthly_${year}_${month}_${timestamp}.pdf`;
        const { url, key } = await storagePut(fileKey, pdfBuffer, "application/pdf");
        resolve({ url, key });
      });

      // Header
      doc.fontSize(16).font("Helvetica-Bold").text(`REPORT MENSILE - ${hotelName}`, { align: "center" });
      const monthName = new Date(year, month - 1).toLocaleDateString("it-IT", {
        month: "long",
        year: "numeric",
      });
      doc.fontSize(10).font("Helvetica").text(monthName, { align: "center" });
      doc.moveDown(0.5);

      // Table header
      const tableTop = doc.y;
      const col1 = 50;
      const col2 = 150;
      const col3 = 300;
      const col4 = 400;

      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Data", col1, tableTop);
      doc.text("Ospite", col2, tableTop);
      doc.text("Importo", col3, tableTop);
      doc.text("Stato", col4, tableTop);

      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      doc.moveDown(1);

      // Table data
      doc.fontSize(9).font("Helvetica");
      let totalAmount = 0;
      let y = doc.y;

      checkins.forEach((checkin) => {
        doc.text(checkin.date, col1, y);
        doc.text(checkin.guestName, col2, y);
        doc.text(checkin.amount, col3, y);
        doc.text(checkin.status, col4, y);

        const amount = parseFloat(checkin.amount.replace(/[^0-9.-]+/g, ""));
        if (!isNaN(amount)) totalAmount += amount;

        y += 20;
      });

      // Summary
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text(`Totale Check-in: ${checkins.length}`);
      doc.text(`Importo Totale: € ${totalAmount.toFixed(2)}`);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
