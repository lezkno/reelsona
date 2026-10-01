import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWavespeedVideoSentinel,
  recoveryStage,
  shouldMonitorWavespeedVideo,
  finalizingSourceStage,
  isHandoffLeaseExpired,
  WAVESPEED_HANDOFF_LEASE_MS,
} from "./wavespeed-video-pipeline-policy";

test("accepts all durable WaveSpeed pipeline stages", () => {
  assert.deepEqual(parseWavespeedVideoSentinel("wavespeed-tts:tts_1"), { stage: "tts", requestId: "tts_1" });
  assert.deepEqual(parseWavespeedVideoSentinel("wavespeed-th:video_1"), { stage: "th", requestId: "video_1" });
  assert.deepEqual(parseWavespeedVideoSentinel("wavespeed-th-finalizing:video_1"), { stage: "th-finalizing", requestId: "video_1" });
});

test("does not adopt unrelated or malformed provider ids", () => {
  assert.equal(parseWavespeedVideoSentinel("heygen-123"), null);
  assert.equal(parseWavespeedVideoSentinel("wavespeed-th"), null);
  assert.equal(parseWavespeedVideoSentinel("wavespeed-unknown:req"), null);
  assert.equal(shouldMonitorWavespeedVideo("ready", "wavespeed-th:req"), false);
});

test("monitor remains responsible across TTS, talking-head and finalization", () => {
  for (const sentinel of [
    "wavespeed-tts:req",
    "wavespeed-th:req",
    "wavespeed-th-finalizing:req",
  ]) {
    assert.equal(shouldMonitorWavespeedVideo("generating", sentinel), true);
  }
});

test("restart resumes an already-submitted talking-head without another submission", () => {
  assert.equal(recoveryStage("th"), "resume");
  assert.equal(recoveryStage("th-finalizing"), "resume");
});

test("an interrupted handoff fails safely instead of submitting a duplicate talking-head", () => {
  assert.equal(recoveryStage("tts-handoff"), "fail_safely");
});

test("a cancelled TTS video is not eligible for a talking-head handoff", () => {
  assert.equal(shouldMonitorWavespeedVideo("cancelled", "wavespeed-tts:req"), false);
});

test("a concurrent poller observes finalization but cannot start a second finalizer", () => {
  const sentinel = parseWavespeedVideoSentinel("wavespeed-th-finalizing:video_1");
  assert.equal(sentinel?.stage, "th-finalizing");
  assert.equal(shouldMonitorWavespeedVideo("generating", "wavespeed-th-finalizing:video_1"), true);
});
test("WAN 3.0 stages keep every comma-separated segment id", () => {
  assert.deepEqual(parseWavespeedVideoSentinel("wavespeed-wan:a1,b2,c3"), { stage: "wan", requestId: "a1,b2,c3" });
  assert.deepEqual(parseWavespeedVideoSentinel("wavespeed-wan-finalizing:a1,b2"), { stage: "wan-finalizing", requestId: "a1,b2" });
  assert.equal(shouldMonitorWavespeedVideo("generating", "wavespeed-wan:a1,b2"), true);
  assert.equal(shouldMonitorWavespeedVideo("generating", "wavespeed-wan-finalizing:a1"), true);
});

test("restart resumes submitted WAN segments without resubmitting", () => {
  assert.equal(recoveryStage("wan"), "resume");
  assert.equal(recoveryStage("wan-finalizing"), "resume");
  assert.equal(finalizingSourceStage("wan-finalizing"), "wan");
  assert.equal(finalizingSourceStage("th-finalizing"), "th");
  assert.equal(finalizingSourceStage("wan"), null);
});

test("a live handoff (recent heartbeat) is NOT failed by another worker", () => {
  const now = new Date("2026-10-01T12:05:00Z");
  assert.equal(isHandoffLeaseExpired(new Date("2026-10-01T12:04:30Z"), now), false);
  assert.equal(isHandoffLeaseExpired(new Date(now.getTime() - WAVESPEED_HANDOFF_LEASE_MS + 1_000), now), false);
});

test("a handoff without heartbeat for longer than the lease fails safely", () => {
  const now = new Date("2026-10-01T12:30:00Z");
  assert.equal(isHandoffLeaseExpired(new Date("2026-10-01T12:00:00Z"), now), true);
  assert.equal(isHandoffLeaseExpired(null, now), true);
});
