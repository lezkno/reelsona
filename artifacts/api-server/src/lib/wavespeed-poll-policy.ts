export type WaveSpeedPollingDecision =
  | { action: "continue" }
  | { action: "timeout"; reason: string };

/**
 * ≈63 min at the capped 30 s delay — just past the 60-minute age timeout, so
 * the age limit decides. 40 attempts (~19 min) failed long WAN 3.0 videos
 * (several segments queued at WaveSpeed) that were still running and billed.
 */
export const WAVESPEED_POLL_MAX_ATTEMPTS = 130;
export const WAVESPEED_POLL_INITIAL_DELAY_MS = 3_000;
export const WAVESPEED_POLL_MAX_DELAY_MS = 30_000;

/** Exponential backoff used by long-lived monitors (without unbounded retries). */
export function getWaveSpeedPollDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    WAVESPEED_POLL_INITIAL_DELAY_MS * 2 ** (safeAttempt - 1),
    WAVESPEED_POLL_MAX_DELAY_MS,
  );
}

export function hasExceededWaveSpeedPollAttempts(attempt: number): boolean {
  return attempt >= WAVESPEED_POLL_MAX_ATTEMPTS;
}

export function evaluateWaveSpeedPollingAge(input: {
  startedAt: Date;
  now?: Date;
  timeoutMinutes?: number;
}): WaveSpeedPollingDecision {
  const now = input.now ?? new Date();
  const timeoutMinutes = Math.max(1, input.timeoutMinutes ?? 60);
  const ageMs = Math.max(0, now.getTime() - input.startedAt.getTime());
  const timeoutMs = timeoutMinutes * 60_000;

  if (ageMs >= timeoutMs) {
    return {
      action: "timeout",
      reason: `WaveSpeed no completó la generación en ${timeoutMinutes} minutos`,
    };
  }
  return { action: "continue" };
}

/**
 * Polling transport/API errors are not proof that the remote prediction failed.
 * The remote job may still be running, so callers must keep the local video in
 * generating state and retry polling later. Only a provider terminal state
 * (normalized by getJobStatus() to status="failed") may fail the generation.
 */
export function isWaveSpeedTerminalFailure(status: string): boolean {
  return status === "failed";
}
