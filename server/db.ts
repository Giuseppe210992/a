import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, hotels, guests, checkins, signatures, notifications, InsertGuest, InsertCheckin, InsertSignature, InsertNotification } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUsersByHotelId(hotelId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.hotelId, hotelId));
}

// Hotel queries
export async function getHotelsByAdminId(adminUserId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hotels).where(eq(hotels.adminUserId, adminUserId));
}

export async function getHotelById(hotelId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(hotels).where(eq(hotels.id, hotelId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Guest queries
export async function createGuest(guest: InsertGuest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(guests).values(guest);
  return result;
}

export async function getGuestById(guestId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(guests).where(eq(guests.id, guestId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Check-in queries
export async function createCheckin(checkin: InsertCheckin) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(checkins).values(checkin);
  return result;
}

export async function getCheckinById(checkinId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(checkins).where(eq(checkins.id, checkinId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCheckinsByHotelId(hotelId: number, limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(checkins).where(eq(checkins.hotelId, hotelId)).limit(limit).offset(offset);
}

// Signature queries
export async function createSignature(signature: InsertSignature) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(signatures).values(signature);
  return result;
}

// Notification queries
export async function createNotification(notification: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(notifications).values(notification);
  return result;
}

export async function markNotificationAsSent(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(notifications).set({ sent: true, sentAt: new Date() }).where(eq(notifications.id, notificationId));
}
