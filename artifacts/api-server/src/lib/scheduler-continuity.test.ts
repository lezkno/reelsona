import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const schedulerSource = fs.readFileSync(
  path.join(import.meta.dirname, "scheduler.ts"),
  "utf8",
);

test("continuity creates a draft for a recently due configured slot", () => {
  assert.match(schedulerSource, /createContinuityItemForDueSlot/);
  assert.match(schedulerSource, /CONTINUITY_LOOKBACK_MS = 6 \* 60 \* 1000/);
  assert.match(schedulerSource, /scheduledAt: slot/);
  assert.match(schedulerSource, /status: "draft"/);
});

test("continuity serializes and rechecks the exact slot before inserting", () => {
  assert.match(schedulerSource, /continuityInFlight\.has\(userId\)/);
  assert.match(schedulerSource, /pg_advisory_xact_lock\(hashtext\(\$\{"continuity:"/);
  assert.match(schedulerSource, /Slot already covered/);
  assert.match(schedulerSource, /gte\(contentPlanItemsTable\.scheduledAt, slotStart\)/);
  assert.match(schedulerSource, /lt\(contentPlanItemsTable\.scheduledAt, slotEnd\)/);
});

test("scheduler invokes the normal targeted cycle after filling an empty slot", () => {
  assert.match(schedulerSource, /if \(cycleItemId === undefined\) \{/);
  assert.match(schedulerSource, /createContinuityItemForDueSlot\(/);
  assert.match(schedulerSource, /runAutomationCycle\(config\.userId, cycleItemId\)/);
});