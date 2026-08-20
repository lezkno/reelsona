import app, { markApplicationReady } from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/run-migrations";
import { startSchedulerLeaderElection } from "./lib/scheduler-leader";
import { resumePendingWavespeedTtsHandoffs } from "./lib/scheduler";
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

  // Resume only the second phase of WaveSpeed jobs that were already submitted
  // before a process restart. Unlike cron, this never starts queued automation.
  await resumePendingWavespeedTtsHandoffs().catch((err) => {
    logger.error({ err }, "Could not resume pending WaveSpeed TTS handoffs");
  });

  // Scheduler jobs can trigger billable provider calls. Never run cron
  // automatically from a development process unless explicitly opted in.
  const schedulerAllowed =
    process.env.NODE_ENV === "production" ||
    process.env.ALLOW_SCHEDULER_IN_DEV === "true";

  if (schedulerAllowed) {
    // Only the PostgreSQL-elected leader starts cron. Follower Autoscale instances
    // continue serving HTTP and periodically retry leadership if the leader exits.
    await startSchedulerLeaderElection();
  } else {
    logger.warn(
      "Scheduler disabled outside production. Set ALLOW_SCHEDULER_IN_DEV=true only for intentional live-provider testing.",
    );
  }

  seedAdminUser().catch((err) => {
    logger.error({ err }, "Error seeding admin user (non-fatal)");
  });
}

initialize().catch((err) => {
  logger.fatal({ err }, "Database migration/startup failed");
  process.exit(1);
});