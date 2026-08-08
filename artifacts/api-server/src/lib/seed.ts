/**
 * Seeds the initial admin user from ADMIN_PASSWORD env var if no users exist.
 * Called once at server startup.
 */
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./password";
import { logger } from "./logger";

export async function seedAdminUser(): Promise<void> {
  // Ensure the users table exists (run CREATE TABLE IF NOT EXISTS)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     VARCHAR(64) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role         VARCHAR(32) NOT NULL DEFAULT 'admin',
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
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
  await db.insert(users).values({ username: "admin", passwordHash, role: "admin" });

  logger.info(
    adminPassword
      ? "Usuario admin creado con ADMIN_PASSWORD"
      : "Usuario admin creado con contraseña 'admin' (modo desarrollo)"
  );
}
