import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "@workspace/db";
import { logger } from "./logger";

const MIGRATION_LOCK_KEY = 1732050807;
const MIGRATION_TABLE = "reelsona_schema_migrations";

// The repository's SQL history began after these original tables had already
// been created with drizzle-kit push. They must exist before migration 001/003
// can run. Check them explicitly so a fresh/incorrect database fails before any
// partial migration is applied.
const LEGACY_BASE_TABLES = [
  "settings",
  "avatar_config",
  "content_plan_items",
  "videos",
  "automation_config",
  "caption_config",
  "instagram_accounts",
] as const;

function migrationsDir(): string {
  // build.mjs copies lib/db/migrations into dist/migrations. Because this module
  // is bundled into dist/index.mjs, import.meta.url resolves to dist/index.mjs.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "migrations");
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

async function assertLegacyBaseSchema(client: Awaited<ReturnType<typeof pool.connect>>): Promise<void> {
  const missing: string[] = [];
  for (const table of LEGACY_BASE_TABLES) {
    const result = await client.query<{ relation: string | null }>(
      "SELECT to_regclass($1) AS relation",
      [`public.${table}`],
    );
    if (!result.rows[0]?.relation) missing.push(table);
  }

  if (missing.length > 0) {
    throw new Error(
      "Database is missing Reelsona legacy base tables: " +
        missing.join(", ") +
        ". This SQL migration history is an upgrade path, not a fresh-database bootstrap. " +
        "Bootstrap the base schema with @workspace/db before starting the API.",
    );
  }
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await assertLegacyBaseSchema(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir = migrationsDir();
    const files = (await readdir(dir))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b));

    if (files.length === 0) {
      throw new Error(`No SQL migrations found in ${dir}`);
    }

    for (const filename of files) {
      const sql = await readFile(path.join(dir, filename), "utf8");
      const hash = checksum(sql);
      const existing = await client.query<{ checksum: string }>(
        `SELECT checksum FROM ${MIGRATION_TABLE} WHERE filename = $1`,
        [filename],
      );

      if (existing.rowCount) {
        if (existing.rows[0].checksum !== hash) {
          throw new Error(
            `Migration checksum mismatch for ${filename}. ` +
              "Applied migrations must never be edited; create a new migration instead.",
          );
        }
        continue;
      }

      logger.info({ filename }, "Applying database migration");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATION_TABLE} (filename, checksum) VALUES ($1, $2)`,
          [filename, hash],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    logger.info({ count: files.length }, "Database migrations are up to date");
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch (error) {
      logger.warn({ err: error }, "Failed to release database migration advisory lock");
    }
    client.release();
  }
}
