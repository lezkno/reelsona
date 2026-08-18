import app from "./app";
import { logger } from "./lib/logger";
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

// Start listening immediately so health checks succeed during cold start.
// Do NOT wait for seedAdminUser() — that requires a DB connection which
// can take several seconds in production, and the health check would fail.
app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  startScheduler();
});

// Seed in the background — non-blocking, non-fatal on failure.
seedAdminUser().catch((err) => {
  logger.error({ err }, "Error seeding admin user (non-fatal)");
});
