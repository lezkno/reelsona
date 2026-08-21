/**
 * The only time a manually targeted item is rescheduled is when its
 * scripted -> generating claim succeeds. AutoPilot calls never opt in.
 */
export interface GenerationStartScheduleOptions {
  isManualTargetedStart: boolean;
  startedAt: Date;
}

export function isManualTargetedGenerationStart(
  targetItemId: number | undefined,
  rescheduleOnManualStart: boolean | undefined,
): boolean {
  return targetItemId !== undefined && rescheduleOnManualStart === true;
}

export function buildGenerationStartClaim(
  options: GenerationStartScheduleOptions,
): { status: "generating"; scheduledAt?: Date; updatedAt: Date } {
  return {
    status: "generating",
    ...(options.isManualTargetedStart ? { scheduledAt: options.startedAt } : {}),
    updatedAt: options.startedAt,
  };
}

/**
 * A claim can still be rolled back when a later pre-submission step fails
 * (for example a competing video slot or an unavailable credit reservation).
 * Restore the planned date only when this was a manually targeted start.
 */
export function buildGenerationStartRollback(
  options: GenerationStartScheduleOptions & { originalScheduledAt: Date | null },
  status: "scripted" | "failed" = "scripted",
): { status: "scripted" | "failed"; scheduledAt?: Date | null; updatedAt: Date } {
  return {
    status,
    ...(options.isManualTargetedStart ? { scheduledAt: options.originalScheduledAt } : {}),
    updatedAt: options.startedAt,
  };
}