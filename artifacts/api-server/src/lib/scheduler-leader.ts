import { pool } from "@workspace/db";
import { logger } from "./logger";
import { startScheduler } from "./scheduler";

const SCHEDULER_LOCK_KEY = 1732050819;
const RETRY_MS = 30_000;

let schedulerStarted = false;
let retryTimer: NodeJS.Timeout | null = null;
let leaderClient: LeaderClient | null = null;

type LeaderClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
  on(event: "error", listener: (error: Error) => void): void;
};

async function connectLeaderClient(): Promise<LeaderClient> {
  const connect = pool.connect as unknown as () => Promise<LeaderClient>;
  return connect.call(pool);
}

async function attemptLeadership(): Promise<void> {
  if (schedulerStarted || leaderClient) return;

  const client = await connectLeaderClient();
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [SCHEDULER_LOCK_KEY],
  );

  if (!result.rows[0]?.acquired) {
    client.release();
    logger.info("Scheduler leadership held by another instance; retrying later");
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        attemptLeadership().catch((err) => {
          logger.error({ err }, "Scheduler leader election retry failed");
        });
      }, RETRY_MS);
      retryTimer.unref?.();
    }
    return;
  }

  leaderClient = client;
  schedulerStarted = true;

  // The advisory lock is session-scoped. If this dedicated DB connection dies,
  // PostgreSQL releases the lock. Exit this process so a follower can take over
  // without leaving this instance's in-memory cron running in parallel.
  client.on("error", (err) => {
    logger.fatal({ err }, "Scheduler leader DB connection lost — exiting to prevent duplicate cron execution");
    process.exit(1);
  });

  startScheduler();
  logger.info("Scheduler leadership acquired; automation scheduler active on this instance");
}

/**
 * Start distributed leader election after DB readiness. Resolves after the first
 * leadership attempt; follower instances keep retrying in the background.
 */
export async function startSchedulerLeaderElection(): Promise<void> {
  await attemptLeadership();
}
