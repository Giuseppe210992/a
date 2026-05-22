import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, json, longtext } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  hotelId: int("hotelId"),
  userRole: mysqlEnum("userRole", ["admin_hotel", "operator"]).default("operator"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Hotels table for multi-tenancy
export const hotels = mysqlTable("hotels", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  province: varchar("province", { length: 2 }),
  postalCode: varchar("postalCode", { length: 10 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  adminUserId: int("adminUserId").notNull(),
  wsKeyAlloggiati: varchar("wsKeyAlloggiati", { length: 255 }),
  rossCode: varchar("rossCode", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Hotel = typeof hotels.$inferSelect;
export type InsertHotel = typeof hotels.$inferInsert;

// Guests table
export const guests = mysqlTable("guests", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  dateOfBirth: varchar("dateOfBirth", { length: 10 }),
  documentType: mysqlEnum("documentType", ["id_card", "passport", "driving_license"]).notNull(),
  documentNumber: varchar("documentNumber", { length: 50 }).notNull(),
  gender: mysqlEnum("gender", ["M", "F", "O"]),
  citizenship: varchar("citizenship", { length: 100 }),
  documentImageUrl: varchar("documentImageUrl", { length: 500 }),
  documentImageKey: varchar("documentImageKey", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Guest = typeof guests.$inferSelect;
export type InsertGuest = typeof guests.$inferInsert;

// Check-ins table
export const checkins = mysqlTable("checkins", {
  id: int("id").autoincrement().primaryKey(),
  hotelId: int("hotelId").notNull(),
  mainGuestId: int("mainGuestId").notNull(),
  checkInDate: timestamp("checkInDate").defaultNow().notNull(),
  checkOutDate: timestamp("checkOutDate"),
  roomNumber: varchar("roomNumber", { length: 10 }),
  numberOfGuests: int("numberOfGuests").default(1),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("EUR"),
  bookingReference: varchar("bookingReference", { length: 100 }),
  status: mysqlEnum("status", ["pending", "completed", "cancelled"]).default("pending"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Checkin = typeof checkins.$inferSelect;
export type InsertCheckin = typeof checkins.$inferInsert;

// Check-in guests (for multi-guest support)
export const checkinGuests = mysqlTable("checkinGuests", {
  id: int("id").autoincrement().primaryKey(),
  checkinId: int("checkinId").notNull(),
  guestId: int("guestId").notNull(),
  guestOrder: int("guestOrder").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CheckinGuest = typeof checkinGuests.$inferSelect;
export type InsertCheckinGuest = typeof checkinGuests.$inferInsert;

// Signatures table for GDPR
export const signatures = mysqlTable("signatures", {
  id: int("id").autoincrement().primaryKey(),
  checkinId: int("checkinId").notNull(),
  guestId: int("guestId").notNull(),
  signatureImageUrl: varchar("signatureImageUrl", { length: 500 }),
  signatureImageKey: varchar("signatureImageKey", { length: 255 }),
  gdprConsent: boolean("gdprConsent").default(true),
  consentTimestamp: timestamp("consentTimestamp").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Signature = typeof signatures.$inferSelect;
export type InsertSignature = typeof signatures.$inferInsert;

// Documents table for tracking uploaded documents
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  checkinId: int("checkinId").notNull(),
  documentType: mysqlEnum("documentType", ["receipt_pdf", "ross1000", "alloggiati_xml"]),
  documentUrl: varchar("documentUrl", { length: 500 }),
  documentKey: varchar("documentKey", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// Notifications log
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  hotelId: int("hotelId").notNull(),
  checkinId: int("checkinId").notNull(),
  recipientUserId: int("recipientUserId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  sent: boolean("sent").default(false),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;