import app, { markApplicationReady } from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/run-migrations";
import { startSchedulerLeaderElection } from "./lib/scheduler-leader";
import { seedAdminUser } from "./lib/seed";
import { migrateInstagramTokensAtRest } from "./lib/instagram-token-crypto";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — terminating process");
  process.exit(1);
});

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

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening; waiting for database readiness");
});

async function initialize(): Promise<void> {
  await runMigrations();
  await migrateInstagramTokensAtRest();

  markApplicationReady();
  logger.info("Database ready; application traffic enabled");

  // Only the PostgreSQL-elected leader starts cron. Follower Autoscale instances
  // continue serving HTTP and periodically retry leadership if the leader exits.
  await startSchedulerLeaderElection();

  seedAdminUser().catch((err) => {
    logger.error({ err }, "Error seeding admin user (non-fatal)");
  });
}

initialize().catch((err) => {
  logger.fatal({ err }, "Database migration/startup failed");
  process.exit(1);
});