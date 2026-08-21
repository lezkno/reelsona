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
    "ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS max_width_percent REAL NOT NULL DEFAULT 88.9",
    "ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS x_position REAL NOT NULL DEFAULT 50",
    "ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS layout_customized BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name     VARCHAR(128)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email         VARCHAR(256)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(32)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notes         TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP NOT NULL DEFAULT NOW()",
    // Migration 011: activation token columns (post-purchase "set your password" flow)
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_token            TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_token_expires_at TIMESTAMP",
    // Card template column — stores the user's saved hook/stat/CTA card configuration (MultiCardConfig JSON)
    "ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS card_template JSONB",
    // Business-profile columns on settings — used to personalize script generation prompts
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS offer              TEXT",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS ideal_audience     TEXT",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS unique_value_prop  TEXT",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS voice_style        TEXT",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS common_objections  TEXT",
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS custom_cta         TEXT",
  ];
  for (const stmt of alterations) {
    await db.execute(sql.raw(stmt));
  }

  // Migration 012: heygen_cloned_voices — tracks per-user voice clone ownership
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS heygen_cloned_voices (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      voice_id     TEXT    NOT NULL UNIQUE,
      display_name TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Migration 011: user_entitlements table (access/license layer)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_entitlements (
      id                    SERIAL PRIMARY KEY,
      user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      course_access         BOOLEAN NOT NULL DEFAULT FALSE,
      tool_access_status    VARCHAR(16) NOT NULL DEFAULT 'disabled'
                              CHECK (tool_access_status IN ('active', 'trialing', 'expired', 'disabled')),
      tool_access_starts_at TIMESTAMP,
      tool_access_ends_at   TIMESTAMP,
      source                VARCHAR(64),
      created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

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
