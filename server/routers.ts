import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  getHotelsByAdminId,
  getHotelById,
  createGuest,
  getGuestById,
  createCheckin,
  getCheckinById,
  getCheckinsByHotelId,
  createSignature,
  createNotification,
  getUsersByHotelId,
} from "./db";
import { extractDocumentData, validateDocumentAgainstBooking } from "./ocr";
import { generateCheckinPDF } from "./pdf-generator";
import { generateAlloggiatiXML, generateRoss1000CSV, validateComplianceData } from "./compliance";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  hotel: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user) throw new Error("Unauthorized");
      return getHotelsByAdminId(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const hotel = await getHotelById(input.id);
        if (!hotel) throw new Error("Hotel not found");
        return hotel;
      }),
  }),

  checkin: router({
    extractDocument: protectedProcedure
      .input(z.object({ imageUrl: z.string() }))
      .mutation(async ({ input }) => {
        return extractDocumentData(input.imageUrl);
      }),

    validateDocument: protectedProcedure
      .input(
        z.object({
          documentData: z.object({
            firstName: z.string(),
            lastName: z.string(),
            dateOfBirth: z.string(),
            documentType: z.enum(["id_card", "passport", "driving_license"]),
            documentNumber: z.string(),
            gender: z.enum(["M", "F", "O"]).optional(),
            citizenship: z.string().optional(),
          }),
          bookingData: z.object({
            guestName: z.string(),
            guestSurname: z.string(),
            bookingAmount: z.string().optional(),
          }),
        })
      )
      .mutation(async ({ input }) => {
        const documentData = input.documentData as any;
        return validateDocumentAgainstBooking(documentData, input.bookingData);
      }),

    list: protectedProcedure
      .input(
        z.object({
          hotelId: z.number(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        return getCheckinsByHotelId(input.hotelId, input.limit, input.offset);
      }),
  }),

  compliance: router({
    generateAlloggiatiXML: protectedProcedure
      .input(z.object({ checkinId: z.number() }))
      .mutation(async ({ input }) => {
        return { xml: "" };
      }),

    generateRoss1000: protectedProcedure
      .input(
        z.object({
          hotelId: z.number(),
          month: z.number(),
          year: z.number(),
        })
      )
      .mutation(async ({ input }) => {
        return { csv: "" };
      }),
  }),

  reports: router({
    monthlyReport: protectedProcedure
      .input(
        z.object({
          hotelId: z.number(),
          month: z.number(),
          year: z.number(),
        })
      )
      .query(async ({ input }) => {
        return { url: "", key: "" };
      }),
  }),
});

export type AppRouter = typeof appRouter;
