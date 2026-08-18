import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/run-migrations";
import { startScheduler } from "./lib/scheduler";
import { seedAdminUser } from "./lib/seed";

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

async function start(): Promise<void> {
  // Fail closed: never accept application traffic or start background workers
  // against a database whose required schema has not been applied.
  await runMigrations();

  app.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    startScheduler();
  });

  // Seeding is not schema-critical and may run after the server becomes ready.
  seedAdminUser().catch((err) => {
    logger.error({ err }, "Error seeding admin user (non-fatal)");
  });
}

start().catch((err) => {
  logger.fatal({ err }, "Database migration/startup failed");
  process.exit(1);
});
