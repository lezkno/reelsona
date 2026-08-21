import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenerationStartClaim,
  buildGenerationStartRollback,
  isManualTargetedGenerationStart,
} from "./generation-start-schedule";

const plannedForFuture = new Date("2030-06-15T15:00:00.000Z");
const startedNow = new Date("2030-06-01T10:30:00.000Z");

test("a manual future item moves to its actual start time when its claim succeeds", () => {
  assert.equal(isManualTargetedGenerationStart(42, true), true);
  const claim = buildGenerationStartClaim({
    isManualTargetedStart: true,
    startedAt: startedNow,
  });

  assert.equal(claim.status, "generating");
  assert.equal(claim.scheduledAt?.getTime(), startedNow.getTime());
});

test("a manual item that cannot start restores its original planned time", () => {
  const rollback = buildGenerationStartRollback({
    isManualTargetedStart: true,
    startedAt: startedNow,
    originalScheduledAt: plannedForFuture,
  });

  assert.equal(rollback.status, "scripted");
  assert.equal(rollback.scheduledAt?.getTime(), plannedForFuture.getTime());
});

test("an AutoPilot claim preserves its planned time", () => {
  // The global trigger has no target item, even when initiated from a button.
  assert.equal(isManualTargetedGenerationStart(undefined, true), false);
  const claim = buildGenerationStartClaim({
    isManualTargetedStart: false,
    startedAt: startedNow,
  });
  const rollback = buildGenerationStartRollback({
    isManualTargetedStart: false,
    startedAt: startedNow,
    originalScheduledAt: plannedForFuture,
  });

  assert.equal("scheduledAt" in claim, false);
  assert.equal("scheduledAt" in rollback, false);
});