import assert from "node:assert/strict";
import test from "node:test";
import { resolveBRollImageReservation } from "./broll-engine";
import { recoverCaptionProcessing } from "./scheduler";

interface RecoveredCaptionOutcome {
  brollGenerated: boolean;
  settledNewReservation: boolean;
}

async function recoverInterruptedCaption(
  priorReservation: number | "already_paid" | null,
): Promise<RecoveredCaptionOutcome> {
  const outcome: RecoveredCaptionOutcome = {
    brollGenerated: false,
    settledNewReservation: false,
  };

  await recoverCaptionProcessing(
    {
      id: 101,
      videoUrl: "https://example.test/video.mp4",
      contentPlanId: 202,
      durationSeconds: 30,
    },
    async (_id, _url, _contentPlanId, _subtitleUrl, _durationSeconds, receivedSkipBroll) => {
      if (receivedSkipBroll) return;

      // Mirrors generateBRollImages: a recovery must rebuild temporary assets,
      // while the per-segment ledger decides whether that work needs settlement.
      const reservation = resolveBRollImageReservation(priorReservation);
      outcome.brollGenerated = reservation.shouldGenerate;
      outcome.settledNewReservation = reservation.reservationId !== null;
    },
  );
  return outcome;
}

test("recovery generates B-roll for a video with no prior image", async () => {
  const outcome = await recoverInterruptedCaption(301);

  assert.deepEqual(outcome, {
    brollGenerated: true,
    settledNewReservation: true,
  });
});

test("recovery regenerates B-roll after an interrupted reserved image without a second charge", async () => {
  const outcome = await recoverInterruptedCaption("already_paid");

  assert.deepEqual(outcome, {
    brollGenerated: true,
    settledNewReservation: false,
  });
});

test("recovery preserves B-roll after an image was consumed before captions finished", async () => {
  // A consumed segment returns "already_paid" on its idempotent next reserve:
  // regenerate the temporary asset, but do not charge or settle it twice.
  const outcome = await recoverInterruptedCaption("already_paid");

  assert.deepEqual(outcome, {
    brollGenerated: true,
    settledNewReservation: false,
  });
});