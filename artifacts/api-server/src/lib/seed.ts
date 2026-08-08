/**
 * Seeds the initial admin user from ADMIN_PASSWORD env var if no users exist.
 * Called once at server startup. Also applies any missing columns to existing tables.
 */
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./password";
import { logger } from "./logger";

export async function seedAdminUser(): Promise<void> {
  // Create the table if it doesn't exist (full schema)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(64)  NOT NULL UNIQUE,
      password_hash TEXT         NOT NULL,
      full_name     VARCHAR(128),
      email         VARCHAR(256),
      phone         VARCHAR(32),
      role          VARCHAR(32)  NOT NULL DEFAULT 'admin',
      is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
      notes         TEXT,
      last_login_at TIMESTAMP,
      created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `);

  // Apply any missing columns to tables that were created with the old schema
  const alterations: string[] = [
    // Caption Engine feature flag (browser_experimental vs standard)
    "ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS caption_engine TEXT NOT NULL DEFAULT 'standard'",
    "ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS template_id   TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name     VARCHAR(128)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email         VARCHAR(256)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(32)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notes         TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP NOT NULL DEFAULT NOW()",
  ];
  for (const stmt of alterations) {
    await db.execute(sql.raw(stmt));
  }

  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) return; // already seeded

  const adminPassword = process.env.ADMIN_PASSWORD;
  const password =
    adminPassword ??
    (process.env.NODE_ENV !== "production" ? "admin" : null);

  if (!password) {
    logger.warn(
      "No hay usuarios en la DB y ADMIN_PASSWORD no está configurada. " +
        "El login estará deshabilitado hasta que se configure."
    );
    return;
  }

  const passwordHash = hashPassword(password);
  await db.insert(users).values({
    username: "admin",
    passwordHash,
    fullName: "Administrador",
    role: "admin",
  });

  logger.info(
    adminPassword
      ? "Usuario admin creado con ADMIN_PASSWORD"
      : "Usuario admin creado con contraseña 'admin' (modo desarrollo)"
  );
}
