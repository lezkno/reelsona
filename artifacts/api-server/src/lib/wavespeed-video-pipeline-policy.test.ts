import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWavespeedVideoSentinel,
  recoveryStage,
  shouldMonitorWavespeedVideo,
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

test("a concurrent poller observes finalization but cannot start a second finalizer", () => {
  const sentinel = parseWavespeedVideoSentinel("wavespeed-th-finalizing:video_1");
  assert.equal(sentinel?.stage, "th-finalizing");
  assert.equal(shouldMonitorWavespeedVideo("generating", "wavespeed-th-finalizing:video_1"), true);
});