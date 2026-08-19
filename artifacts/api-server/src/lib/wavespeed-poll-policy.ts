export type WaveSpeedPollingDecision =
  | { action: "continue" }
  | { action: "timeout"; reason: string };

export function evaluateWaveSpeedPollingAge(input: {
  startedAt: Date;
  now?: Date;
  timeoutMinutes?: number;
}): WaveSpeedPollingDecision {
  const now = input.now ?? new Date();
  const timeoutMinutes = Math.max(1, input.timeoutMinutes ?? 60);
  const ageMs = Math.max(0, now.getTime() - input.startedAt.getTime());
  const timeoutMs = timeoutMinutes * 60_000;

  if (ageMs > timeoutMs) {
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
