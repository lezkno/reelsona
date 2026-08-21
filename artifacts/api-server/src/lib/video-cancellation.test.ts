import assert from "node:assert/strict";
import test from "node:test";
import { GetContentPlanResponseItem } from "@workspace/api-zod";
import { canUseBRollCredits, shouldReleaseCancelledVideoReservation } from "./credits";
import {
  captionWorkerStillOwnsLease,
  getVideoCancellationPlan,
} from "./video-cancellation";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "generating",
    captionStatus: null,
    videoUrl: null,
    captionProcessingLeaseId: null,
    ...overrides,
  } as any;
}

test("cancelling before WaveSpeed completes releases the still-open generation reservation", () => {
  const plan = getVideoCancellationPlan(snapshot({
    status: "generating",
    videoUrl: null,
  }));

  assert.deepEqual(plan, {
    kind: "cancel",
    includeGenerationReservation: true,
  });
  assert.equal(shouldReleaseCancelledVideoReservation(null, plan.includeGenerationReservation), true);
});

test("cancelling Render Fast V2 post-production keeps consumed video credits and releases B-roll", () => {
  const plan = getVideoCancellationPlan(snapshot({
    status: "ready",
    captionStatus: "processing",
    videoUrl: "https://storage.example/video.mp4",
    captionProcessingLeaseId: "active-render-lease",
  }));

  assert.deepEqual(plan, {
    kind: "cancel",
    includeGenerationReservation: false,
  });
  assert.equal(
    shouldReleaseCancelledVideoReservation(null, plan.includeGenerationReservation),
    false,
    "the video-generation reservation must not be released after the source video completed",
  );
  assert.equal(
    shouldReleaseCancelledVideoReservation("broll", plan.includeGenerationReservation),
    true,
    "open B-roll reservations remain eligible for idempotent release",
  );
});

test("a cancelled video can never reserve or consume B-roll credits", () => {
  assert.equal(canUseBRollCredits("cancelled"), false);
  assert.equal(canUseBRollCredits("ready"), true);
});

test("a second cancel request is idempotent and preserves the original credit decision", () => {
  const plan = getVideoCancellationPlan(snapshot({
    status: "cancelled",
    captionStatus: "cancelled",
    videoUrl: "https://storage.example/video.mp4",
  }));

  assert.deepEqual(plan, {
    kind: "already_cancelled",
    includeGenerationReservation: false,
  });
});

test("an old caption worker loses authority immediately after cancellation fences its lease", () => {
  const leaseId = "lease-owned-by-old-worker";

  assert.equal(
    captionWorkerStillOwnsLease(snapshot({
      status: "ready",
      captionStatus: "processing",
      captionProcessingLeaseId: leaseId,
    }), leaseId),
    true,
  );
  assert.equal(
    captionWorkerStillOwnsLease(snapshot({
      status: "cancelled",
      captionStatus: "cancelled",
      captionProcessingLeaseId: null,
    }), leaseId),
    false,
  );
});

test("a linked cancelled video remains serializable in the content-plan response", () => {
  const item = GetContentPlanResponseItem.parse({
    id: 42,
    topic: "Video detenido",
    status: "failed",
    video_id: 101,
    video_status: "cancelled",
    caption_status: "cancelled",
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  });

  assert.equal(item.caption_status, "cancelled");
  assert.equal(item.video_status, "cancelled");
});