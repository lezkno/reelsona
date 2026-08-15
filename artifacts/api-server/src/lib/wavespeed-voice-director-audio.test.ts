/**
 * Unit tests — WaveSpeed Voice Director audio engine
 *
 * Covers the pure (I/O-free) functions:
 *   • buildSpeechInputs
 *   • extractAudioUrl
 *   • buildConcatFilterComplex
 *
 * No DB, no network, no FFmpeg, no WaveSpeed calls.
 *
 * Run with:
 *   node --import tsx/esm --test src/lib/wavespeed-voice-director-audio.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildSpeechInputs,
  extractAudioUrl,
  buildConcatFilterComplex,
} from "./wavespeed-voice-director-audio.js";

import type { WavespeedSegmentParams } from "./wavespeed-voice-director.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeParams(overrides: Partial<WavespeedSegmentParams> = {}): WavespeedSegmentParams {
  return {
    speed: 1.0,
    emotion: "happy",
    languageBoost: "Spanish",
    ...overrides,
  };
}

// ── buildSpeechInputs ─────────────────────────────────────────────────────────

describe("buildSpeechInputs", () => {
  test("always includes text, voice_id and language_boost", () => {
    const inputs = buildSpeechInputs("Hello world.", "voice-abc", makeParams());
    assert.equal(inputs["text"], "Hello world.");
    assert.equal(inputs["voice_id"], "voice-abc");
    assert.equal(inputs["language_boost"], "Spanish");
  });

  test("omits speed when it is exactly 1.0 (neutral default)", () => {
    const inputs = buildSpeechInputs("Text.", "vid", makeParams({ speed: 1.0 }));
    assert.ok(!("speed" in inputs), "speed should be omitted at 1.0");
  });

  test("includes speed when it differs from 1.0", () => {
    const inputs = buildSpeechInputs("Text.", "vid", makeParams({ speed: 1.1 }));
    assert.equal(inputs["speed"], 1.1);
  });

  test("speed is rounded to 2 decimal places", () => {
    const inputs = buildSpeechInputs("Text.", "vid", makeParams({ speed: 1.05000001 }));
    const speedStr = String(inputs["speed"]);
    assert.ok(
      speedStr.replace(".", "").replace(/^0+/, "").length <= 4,
      `speed ${inputs["speed"]} should have at most 2 decimal places`,
    );
  });

  test("always includes emotion in API inputs", () => {
    const inputs = buildSpeechInputs("Text.", "vid", makeParams({ emotion: "happy" }));
    assert.equal(inputs["emotion"], "happy");
  });

  test("forwards the emotion value as-is to the API", () => {
    for (const emotion of ["neutral", "happy", "sad", "angry", "fearful", "surprised"]) {
      const inputs = buildSpeechInputs("Text.", "vid", makeParams({ emotion }));
      assert.equal(inputs["emotion"], emotion, `emotion "${emotion}" not forwarded correctly`);
    }
  });

  test("never includes pitch in API inputs", () => {
    const inputs = buildSpeechInputs("Text.", "vid", makeParams());
    assert.ok(!("pitch" in inputs), "pitch must never be sent — it distorts cloned voice identity");
  });
});

// ── extractAudioUrl ───────────────────────────────────────────────────────────

describe("extractAudioUrl", () => {
  const URL = "https://cdn.wavespeed.ai/outputs/audio.mp3";

  test("extracts URL from string array (primary WaveSpeed shape)", () => {
    assert.equal(extractAudioUrl([URL]), URL);
  });

  test("extracts URL from string array with multiple items", () => {
    assert.equal(extractAudioUrl([URL, "https://other.com/file.mp3"]), URL);
  });

  test("extracts URL from object with audio_url key", () => {
    assert.equal(extractAudioUrl({ audio_url: URL }), URL);
  });

  test("extracts URL from object with audio key", () => {
    assert.equal(extractAudioUrl({ audio: URL }), URL);
  });

  test("extracts URL from object with url key", () => {
    assert.equal(extractAudioUrl({ url: URL }), URL);
  });

  test("prefers audio_url over audio when both present", () => {
    const result = extractAudioUrl({ audio_url: URL, audio: "https://other.com/x.mp3" });
    assert.equal(result, URL);
  });

  test("returns null for null input", () => {
    assert.equal(extractAudioUrl(null), null);
  });

  test("returns null for undefined input", () => {
    assert.equal(extractAudioUrl(undefined), null);
  });

  test("returns null for empty array", () => {
    assert.equal(extractAudioUrl([]), null);
  });

  test("returns null for array with non-string first element", () => {
    assert.equal(extractAudioUrl([{ url: URL }]), null);
  });

  test("returns null for empty object", () => {
    assert.equal(extractAudioUrl({}), null);
  });

  test("returns null for object with non-string audio_url", () => {
    assert.equal(extractAudioUrl({ audio_url: 42 }), null);
  });
});

// ── buildConcatFilterComplex ──────────────────────────────────────────────────

describe("buildConcatFilterComplex", () => {
  test("returns null for a single segment (no concatenation needed)", () => {
    assert.equal(buildConcatFilterComplex(1, [0.4]), null);
  });

  test("returns null for zero segments", () => {
    assert.equal(buildConcatFilterComplex(0, []), null);
  });

  test("two segments produce correct filter string", () => {
    const result = buildConcatFilterComplex(2, [0.4, 0.0]);
    assert.ok(result, "should produce a non-null filter");
    assert.ok(result!.includes("apad=pad_dur=0.4"), "first segment should have apad=pad_dur=0.4");
    assert.ok(result!.includes("concat=n=2:v=0:a=1"), "should use concat with n=2");
    assert.ok(result!.includes("[out]"), "should produce [out] label");
    assert.ok(result!.includes("aresample=44100"), "should normalize sample rate");
  });

  test("three segments with mixed pauses produce correct filter string", () => {
    const result = buildConcatFilterComplex(3, [0.4, 0.3, 0.0]);
    assert.ok(result!.includes("concat=n=3:v=0:a=1"), "concat must reference all 3 segments");
    assert.ok(result!.includes("apad=pad_dur=0.4"), "first segment must have 0.4s padding");
    assert.ok(result!.includes("apad=pad_dur=0.3"), "second segment must have 0.3s padding");
    // Third segment (pauseAfter=0) should NOT have apad
    const thirdPart = result!.split(";").find((p) => p.includes("[2:a]"));
    assert.ok(thirdPart, "must have a part for stream [2:a]");
    assert.ok(
      !thirdPart!.includes("apad"),
      "last segment with pauseAfter=0 should not have apad",
    );
  });

  test("all segment labels [a0]…[aN] appear in the concat line", () => {
    const n = 4;
    const result = buildConcatFilterComplex(n, [0.3, 0.2, 0.4, 0.0]);
    const concatLine = result!.split(";").find((p) => p.includes("concat="));
    assert.ok(concatLine, "must have a concat line");
    for (let i = 0; i < n; i++) {
      assert.ok(
        concatLine!.includes(`[a${i}]`),
        `concat line must reference [a${i}]`,
      );
    }
  });

  test("segment count in concat filter matches segmentCount argument", () => {
    for (const n of [2, 3, 5]) {
      const pauses = Array(n).fill(0.2);
      const result = buildConcatFilterComplex(n, pauses);
      assert.ok(result!.includes(`concat=n=${n}`), `concat must use n=${n} for ${n} segments`);
    }
  });

  test("zero pause after a segment (not last) still includes aresample", () => {
    // Middle segment with pauseAfter=0 should still have aresample but no apad
    const result = buildConcatFilterComplex(3, [0.0, 0.4, 0.0]);
    const firstPart = result!.split(";").find((p) => p.includes("[0:a]"));
    assert.ok(firstPart!.includes("aresample=44100"), "aresample must always be present");
    assert.ok(!firstPart!.includes("apad"), "zero-pause segment must not have apad");
  });
});
