import app, { markApplicationReady } from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/run-migrations";
import { startScheduler } from "./lib/scheduler";
import { seedAdminUser } from "./lib/seed";
import { migrateInstagramTokensAtRest } from "./lib/instagram-token-crypto";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Open the port immediately so Replit Autoscale health checks can reach the
// process during a cold DB start. app.ts keeps every application API route
// behind a readiness gate until migrations and security data migrations finish.
app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening; waiting for database readiness");
});

async function initialize(): Promise<void> {
  await runMigrations();

  // Existing Instagram rows may predate at-rest encryption. Migrate them before
  // any route or background worker can read the token column.
  await migrateInstagramTokensAtRest();

  markApplicationReady();
  logger.info("Database ready; application traffic enabled");

  // Background workers must never run against a stale/partially migrated schema.
  startScheduler();

  // Seeding is not schema-critical and may run after readiness.
  seedAdminUser().catch((err) => {
    logger.error({ err }, "Error seeding admin user (non-fatal)");
  });
}

initialize().catch((err) => {
  logger.fatal({ err }, "Database migration/startup failed");
  process.exit(1);
});