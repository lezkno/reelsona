import { db } from "@workspace/db";
import { contentPlanItemsTable, videosTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { releaseOpenVideoReservations, type ReleasedVideoReservation } from "./credits";
import { logger } from "./logger";

type CancellableVideo = Pick<
  typeof videosTable.$inferSelect,
  "status" | "captionStatus" | "videoUrl" | "captionProcessingLeaseId"
>;

export type VideoCancellationPlan =
  | { kind: "cancel"; includeGenerationReservation: boolean }
  | { kind: "already_cancelled"; includeGenerationReservation: boolean }
  | { kind: "not_cancellable" };

/**
 * Determines whether an existing row may be cancelled without guessing whether
 * a completed provider video has already earned its generation credit.
 */
export function getVideoCancellationPlan(video: CancellableVideo): VideoCancellationPlan {
  const sourceVideoCompleted = video.status === "ready" || Boolean(video.videoUrl);
  const includeGenerationReservation = !sourceVideoCompleted;

  if (video.status === "cancelled") {
    return { kind: "already_cancelled", includeGenerationReservation };
  }
  if (video.status === "generating" || (video.status === "ready" && video.captionStatus === "processing")) {
    return { kind: "cancel", includeGenerationReservation };
  }
  return { kind: "not_cancellable" };
}

/**
 * Mirrors the durable compare-and-set conditions used by caption completion.
 * A cancelled row never grants an old renderer authority to persist a result.
 */
export function captionWorkerStillOwnsLease(
  video: Pick<CancellableVideo, "status" | "captionStatus" | "captionProcessingLeaseId">,
  leaseId: string,
): boolean {
  return video.status !== "cancelled"
    && video.captionStatus === "processing"
    && video.captionProcessingLeaseId === leaseId;
}

export type CancelVideoResult =
  | {
      kind: "cancelled" | "already_cancelled";
      video: typeof videosTable.$inferSelect;
      leaseId: string | null;
      releasedReservations: ReleasedVideoReservation[];
      processAbort: "fenced_no_local_aborter";
    }
  | { kind: "not_found" | "not_cancellable" };

/**
 * Fences the video row before any credit release. Rendering/generation workers
 * use status and caption lease compare-and-set predicates, so they lose write
 * authority as soon as this transaction commits.
 */
export async function cancelVideoForUser(videoId: number, userId: number): Promise<CancelVideoResult> {
  const transition = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(videosTable)
      .where(and(eq(videosTable.id, videoId), eq(videosTable.userId, userId)))
      .for("update")
      .limit(1);

    if (!current) return { kind: "not_found" as const };

    const plan = getVideoCancellationPlan(current);
    if (plan.kind === "not_cancellable") return { kind: "not_cancellable" as const };

    if (plan.kind === "already_cancelled") {
      return {
        kind: "already_cancelled" as const,
        video: current,
        leaseId: current.captionProcessingLeaseId,
        includeGenerationReservation: plan.includeGenerationReservation,
      };
    }

    const [cancelled] = await tx
      .update(videosTable)
      .set({
        status: "cancelled",
        captionStatus: "cancelled",
        captionProcessingLeaseId: null,
        scheduledPublishAt: null,
        errorMessage: "Cancelado por el usuario",
        updatedAt: new Date(),
      })
      .where(and(
        eq(videosTable.id, videoId),
        eq(videosTable.userId, userId),
        or(
          eq(videosTable.status, "generating"),
          and(
            eq(videosTable.status, "ready"),
            eq(videosTable.captionStatus, "processing"),
          ),
        ),
      ))
      .returning();

    if (!cancelled) return { kind: "not_cancellable" as const };

    if (cancelled.contentPlanId) {
      await tx
        .update(contentPlanItemsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(
          eq(contentPlanItemsTable.id, cancelled.contentPlanId),
          eq(contentPlanItemsTable.userId, userId),
          eq(contentPlanItemsTable.videoId, cancelled.id),
        ));
    }

    return {
      kind: "cancelled" as const,
      video: cancelled,
      leaseId: current.captionProcessingLeaseId,
      includeGenerationReservation: plan.includeGenerationReservation,
    };
  });

  if (transition.kind === "not_found" || transition.kind === "not_cancellable") {
    return transition;
  }

  const releasedReservations = await releaseOpenVideoReservations({
    userId,
    videoId,
    includeGenerationReservation: transition.includeGenerationReservation,
    reason: `Cancelación de video ${videoId} por el usuario`,
  });

  const processAbort = "fenced_no_local_aborter" as const;
  logger.info(
    {
      userId,
      videoId,
      leaseId: transition.leaseId,
      releasedReservations,
      processAbort,
      alreadyCancelled: transition.kind === "already_cancelled",
    },
    "[VideoCancel] Video cancelado; el render anterior quedó sin autoridad para guardar resultados",
  );

  return { ...transition, releasedReservations, processAbort };
}