/**
 * Unit tests — WaveSpeed Voice Director video generation engine
 *
 * Covers pure functions:
 *   • buildInfiniteTalkPrompt
 *   • buildVideoJobInputPayload
 *   • extractVideoUrl
 *
 * No DB, no network, no FFmpeg, no WaveSpeed or GCS calls.
 *
 * Run with:
 *   node --import tsx/esm --test src/lib/wavespeed-voice-director-video.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildInfiniteTalkPrompt,
  buildVideoJobInputPayload,
  extractVideoUrl,
} from "./wavespeed-voice-director-video.js";

// ── buildInfiniteTalkPrompt ───────────────────────────────────────────────────

describe("buildInfiniteTalkPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildInfiniteTalkPrompt();
    assert.ok(typeof prompt === "string" && prompt.length > 0, "prompt must be a non-empty string");
  });

  test("mentions natural/realistic presenter quality", () => {
    const p = buildInfiniteTalkPrompt().toLowerCase();
    assert.ok(
      p.includes("natural") || p.includes("realistic"),
      "prompt should mention natural or realistic quality",
    );
  });

  test("specifies no extreme movement", () => {
    const p = buildInfiniteTalkPrompt().toLowerCase();
    assert.ok(
      p.includes("no extreme") || p.includes("subtle"),
      "prompt should discourage extreme movement",
    );
  });

  test("references Spanish presenter", () => {
    const p = buildInfiniteTalkPrompt().toLowerCase();
    assert.ok(p.includes("spanish"), "prompt should reference Spanish delivery");
  });

  test("references vertical or 9:16 framing", () => {
    const p = buildInfiniteTalkPrompt().toLowerCase();
    assert.ok(
      p.includes("9:16") || p.includes("vertical"),
      "prompt should specify vertical framing",
    );
  });

  test("mentions lip sync", () => {
    const p = buildInfiniteTalkPrompt().toLowerCase();
    assert.ok(p.includes("lip sync"), "prompt should mention lip sync for realism");
  });

  test("is deterministic — returns same string every call", () => {
    assert.equal(buildInfiniteTalkPrompt(), buildInfiniteTalkPrompt());
  });
});

// ── buildVideoJobInputPayload ─────────────────────────────────────────────────

describe("buildVideoJobInputPayload", () => {
  const BASE_OPTS = {
    lookImageUrl:   "https://example.com/look.jpg",
    audioSignedUrl: "https://storage.googleapis.com/bucket/audio.mp3",
    presetId:       "energetico",
    voiceId:        "voice-abc-123",
    segmentCount:   4,
    userId:         99,
  };

  test("returns a valid JSON string", () => {
    const payload = buildVideoJobInputPayload(BASE_OPTS);
    assert.doesNotThrow(() => JSON.parse(payload), "payload must be valid JSON");
  });

  test("includes source=voice_director_video_preview", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.source, "voice_director_video_preview");
  });

  test("includes lookImageUrl", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.lookImageUrl, BASE_OPTS.lookImageUrl);
  });

  test("includes audioSignedUrl", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.audioSignedUrl, BASE_OPTS.audioSignedUrl);
  });

  test("includes presetId", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.presetId, BASE_OPTS.presetId);
  });

  test("includes voiceId", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.voiceId, BASE_OPTS.voiceId);
  });

  test("includes segmentCount", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.segmentCount, BASE_OPTS.segmentCount);
  });

  test("includes userId", () => {
    const parsed = JSON.parse(buildVideoJobInputPayload(BASE_OPTS));
    assert.equal(parsed.userId, BASE_OPTS.userId);
  });

  test("different inputs produce different payloads", () => {
    const a = buildVideoJobInputPayload({ ...BASE_OPTS, presetId: "natural" });
    const b = buildVideoJobInputPayload({ ...BASE_OPTS, presetId: "dramatico" });
    assert.notEqual(a, b);
  });
});

// ── extractVideoUrl ───────────────────────────────────────────────────────────

describe("extractVideoUrl", () => {
  const URL = "https://cdn.wavespeed.ai/outputs/video.mp4";

  test("extracts URL from string array (primary WaveSpeed shape)", () => {
    assert.equal(extractVideoUrl([URL]), URL);
  });

  test("extracts URL from string array with multiple items", () => {
    assert.equal(extractVideoUrl([URL, "https://other.com/video2.mp4"]), URL);
  });

  test("extracts URL from object with video_url key", () => {
    assert.equal(extractVideoUrl({ video_url: URL }), URL);
  });

  test("extracts URL from object with video key", () => {
    assert.equal(extractVideoUrl({ video: URL }), URL);
  });

  test("extracts URL from object with url key", () => {
    assert.equal(extractVideoUrl({ url: URL }), URL);
  });

  test("prefers video_url over video when both present", () => {
    const result = extractVideoUrl({ video_url: URL, video: "https://other.com/v.mp4" });
    assert.equal(result, URL);
  });

  test("returns null for null", () => {
    assert.equal(extractVideoUrl(null), null);
  });

  test("returns null for undefined", () => {
    assert.equal(extractVideoUrl(undefined), null);
  });

  test("returns null for empty array", () => {
    assert.equal(extractVideoUrl([]), null);
  });

  test("returns null for array with non-string first element", () => {
    assert.equal(extractVideoUrl([{ url: URL }]), null);
  });

  test("returns null for empty object", () => {
    assert.equal(extractVideoUrl({}), null);
  });

  test("returns null for object with non-string video_url", () => {
    assert.equal(extractVideoUrl({ video_url: 42 }), null);
  });
});
