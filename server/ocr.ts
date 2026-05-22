import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { InsertGuest } from "../drizzle/schema";

interface OCRResult {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // DD/MM/YYYY
  documentType: "id_card" | "passport" | "driving_license";
  documentNumber: string;
  gender?: "M" | "F" | "O";
  citizenship?: string;
}

/**
 * Estrae i dati da un documento d'identità usando LLM (vision)
 * Supporta: carta d'identità, passaporto, patente di guida
 */
export async function extractDocumentData(imageUrl: string): Promise<OCRResult> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert document recognition system. Extract identity document information and return ONLY valid JSON.
          
          Document types: id_card (carta d'identità), passport (passaporto), driving_license (patente di guida)
          
          Return JSON with these fields (all required except gender/citizenship):
          {
            "firstName": "string",
            "lastName": "string",
            "dateOfBirth": "DD/MM/YYYY",
            "documentType": "id_card" | "passport" | "driving_license",
            "documentNumber": "string",
            "gender": "M" | "F" | "O",
            "citizenship": "string"
          }
          
          If you cannot extract a field, use null. If you cannot determine document type, return error.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all identity information from this document image.",
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "document_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              dateOfBirth: { type: "string" },
              documentType: {
                type: "string",
                enum: ["id_card", "passport", "driving_license"],
              },
              documentNumber: { type: "string" },
              gender: { type: "string", enum: ["M", "F", "O"] },
              citizenship: { type: "string" },
            },
            required: [
              "firstName",
              "lastName",
              "dateOfBirth",
              "documentType",
              "documentNumber",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0].message.content;
    if (typeof content !== "string") {
      throw new Error("Invalid LLM response format");
    }

    const data = JSON.parse(content);
    return {
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      documentType: data.documentType,
      documentNumber: data.documentNumber,
      gender: data.gender,
      citizenship: data.citizenship,
    };
  } catch (error) {
    console.error("OCR extraction error:", error);
    throw new Error("Failed to extract document data");
  }
}

/**
 * Valida i dati estratti dal documento rispetto ai dati della prenotazione
 */
export async function validateDocumentAgainstBooking(
  documentData: OCRResult,
  bookingData: {
    guestName: string;
    guestSurname: string;
    bookingAmount?: string;
  }
): Promise<{
  match: boolean;
  discrepancies: string[];
  suggestedAmount: string | null;
}> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a hotel check-in validation expert. Compare document data with booking data and identify discrepancies.
          
          Return JSON with:
          {
            "match": boolean (true if names match substantially),
            "discrepancies": ["list of differences"],
            "suggestedAmount": "amount from booking or null"
          }`,
        },
        {
          role: "user",
          content: `Document data: ${JSON.stringify(documentData)}
          
          Booking data: ${JSON.stringify(bookingData)}
          
          Validate and return JSON.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "validation_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              match: { type: "boolean" },
              discrepancies: { type: "array", items: { type: "string" } },
              suggestedAmount: { type: ["string", "null"] },
            },
            required: ["match", "discrepancies", "suggestedAmount"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0].message.content;
    if (typeof content !== "string") {
      throw new Error("Invalid LLM response format");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Validation error:", error);
    return {
      match: false,
      discrepancies: ["Validation error"],
      suggestedAmount: null,
    };
  }
}

/**
 * Salva l'immagine del documento su cloud storage
 */
export async function saveDocumentImage(
  imageBuffer: Buffer,
  guestName: string,
  documentType: string
): Promise<{ url: string; key: string }> {
  const timestamp = Date.now();
  const fileKey = `documents/${guestName.replace(/\s+/g, "_")}_${documentType}_${timestamp}.jpg`;

  const { url, key } = await storagePut(fileKey, imageBuffer, "image/jpeg");
  return { url, key };
}
