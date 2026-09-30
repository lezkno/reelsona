import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWaveSpeedPollingAge,
  getWaveSpeedPollDelayMs,
  hasExceededWaveSpeedPollAttempts,
  isWaveSpeedTerminalFailure,
} from "./wavespeed-poll-policy";

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

test("WaveSpeed poll delay backs off and is capped", () => {
  assert.equal(getWaveSpeedPollDelayMs(1), 3_000);
  assert.equal(getWaveSpeedPollDelayMs(3), 12_000);
  assert.equal(getWaveSpeedPollDelayMs(20), 30_000);
});

test("WaveSpeed polling has a hard attempt ceiling", () => {
  assert.equal(hasExceededWaveSpeedPollAttempts(129), false);
  assert.equal(hasExceededWaveSpeedPollAttempts(130), true);
});

test("attempt limit outlasts the 60-minute age timeout (long WAN 3.0 videos)", () => {
  let totalMs = 0;
  for (let attempt = 1; attempt < 130; attempt++) totalMs += getWaveSpeedPollDelayMs(attempt);
  assert.ok(totalMs > 60 * 60_000, `only ${Math.round(totalMs / 60_000)} min of polling`);
});
