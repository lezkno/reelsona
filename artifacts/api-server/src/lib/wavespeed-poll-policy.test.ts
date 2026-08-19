import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWaveSpeedPollingAge, isWaveSpeedTerminalFailure } from "./wavespeed-poll-policy";

test("WaveSpeed polling continues before timeout", () => {
  const now = new Date("2026-08-19T12:45:00Z");
  const startedAt = new Date("2026-08-19T12:00:00Z");
  assert.deepEqual(
    evaluateWaveSpeedPollingAge({ startedAt, now, timeoutMinutes: 60 }),
    { action: "continue" },
  );
});

test("WaveSpeed polling times out after configured maximum age", () => {
  const now = new Date("2026-08-19T13:01:00Z");
  const startedAt = new Date("2026-08-19T12:00:00Z");
  const result = evaluateWaveSpeedPollingAge({ startedAt, now, timeoutMinutes: 60 });
  assert.equal(result.action, "timeout");
});

test("only provider failed status is terminal", () => {
  assert.equal(isWaveSpeedTerminalFailure("failed"), true);
  assert.equal(isWaveSpeedTerminalFailure("queued"), false);
  assert.equal(isWaveSpeedTerminalFailure("processing"), false);
  assert.equal(isWaveSpeedTerminalFailure("completed"), false);
});
