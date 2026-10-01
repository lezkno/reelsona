import test from "node:test";
import assert from "node:assert/strict";
import {
  splitScriptIntoWan3Segments,
  wan3DurationForText,
  wan3LanguageLabel,
  buildWan3Prompt,
  buildWan3Payload,
  parseWan3Sentinel,
  buildWan3Sentinel,
  isWan3Enabled,
  WAN3_MAX_WORDS_PER_SEGMENT,
} from "./wan3-talking";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

// ~150-word script, like a 60 s reel.
const LONG_SCRIPT = Array.from({ length: 15 }, (_, i) =>
  `Esta es la frase número ${i + 1} del guion y explica una idea clara.`,
).join(" ");

test("short script stays in one segment", () => {
  const script = "Hola, hoy te cuento tres trucos para vender más. ¡Quédate hasta el final!";
  assert.deepEqual(splitScriptIntoWan3Segments(script), [script]);
});

test("long script is split into segments of at most 36 words", () => {
  const segments = splitScriptIntoWan3Segments(LONG_SCRIPT);
  assert.ok(segments.length > 1);
  for (const seg of segments) {
    assert.ok(words(seg).length <= WAN3_MAX_WORDS_PER_SEGMENT, `segment too long: ${seg}`);
  }
});

test("segments keep every word of the script in order", () => {
  const segments = splitScriptIntoWan3Segments(LONG_SCRIPT);
  assert.deepEqual(words(segments.join(" ")), words(LONG_SCRIPT));
});

test("segments cut at sentence boundaries when possible", () => {
  for (const seg of splitScriptIntoWan3Segments(LONG_SCRIPT)) {
    assert.match(seg, /\.$/);
  }
});

test("a single sentence longer than the limit is still split", () => {
  const sentence = Array.from({ length: 80 }, (_, i) => `palabra${i}`).join(" ") + ".";
  const segments = splitScriptIntoWan3Segments(sentence);
  assert.ok(segments.length >= 3);
  assert.deepEqual(words(segments.join(" ")), words(sentence));
  for (const seg of segments) assert.ok(words(seg).length <= WAN3_MAX_WORDS_PER_SEGMENT);
});

test("empty script yields no segments", () => {
  assert.deepEqual(splitScriptIntoWan3Segments("   "), []);
});

test("duration covers the dialogue and respects WAN limits (2–30 s)", () => {
  assert.equal(wan3DurationForText("Hola"), 2);
  const full = Array.from({ length: 36 }, () => "palabra").join(" ");
  assert.equal(wan3DurationForText(full), 18); // 36 / 2.2 + 1.5 = 17.9 → 18
});

test("duration never exceeds 30 s", () => {
  const huge = Array.from({ length: 200 }, () => "palabra").join(" ");
  assert.equal(wan3DurationForText(huge), 30);
});

test("language label is never hard-coded to Spanish", () => {
  assert.equal(wan3LanguageLabel("es"), "Spanish");
  assert.equal(wan3LanguageLabel("es-MX"), "Mexican Spanish");
  assert.equal(wan3LanguageLabel("en"), "English");
  assert.equal(wan3LanguageLabel("pt-BR"), "Brazilian Portuguese");
  assert.equal(wan3LanguageLabel("fr-CA"), "French");
  assert.equal(wan3LanguageLabel(null), "Spanish");
});

test("prompt contains the exact dialogue block, spoken once", () => {
  const prompt = buildWan3Prompt({ dialogue: 'Hola "amigos", empecemos.', language: "es" });
  assert.match(prompt, /EXACT DIALOGUE — spoken once, in order, without adding or repeating words: "Hola 'amigos', empecemos\."/);
  assert.match(prompt, /AUDIO LOCK/);
  assert.match(prompt, /Generate clear Spanish speech/);
  assert.match(prompt, /accent, /);
});

test("prompt omits accent for non-Spanish and marks multi-part videos", () => {
  const prompt = buildWan3Prompt({ dialogue: "Hi there.", language: "en", segmentIndex: 1, segmentCount: 3 });
  assert.match(prompt, /Generate clear English speech/);
  assert.doesNotMatch(prompt, /accent, /);
  assert.match(prompt, /SHOT 2 OF 3/);
});

test("payload puts the look image in reference_images[0] and never sends `image`", () => {
  const payload = buildWan3Payload({
    imageUrl: "https://cdn.example/look.jpg",
    voiceReferenceUrl: "https://cdn.example/voice.mp3",
    dialogue: "Hola a todos.",
    resolution: "720p",
  });
  assert.deepEqual(payload.reference_images, ["https://cdn.example/look.jpg"]);
  assert.deepEqual(payload.reference_audios, ["https://cdn.example/voice.mp3"]);
  assert.equal("image" in payload, false);
  assert.equal(payload.aspect_ratio, "9:16");
  assert.equal(payload.resolution, "720p");
  assert.equal(payload.enable_prompt_expansion, false);
  assert.equal(payload.enable_audio, true);
  assert.equal(payload.seed, -1);
  assert.equal(typeof payload.duration, "number");
});

test("sentinel round-trips multiple request ids", () => {
  const sentinel = buildWan3Sentinel(["abc", "def", "ghi"]);
  assert.equal(sentinel, "wavespeed-wan:abc,def,ghi");
  assert.deepEqual(parseWan3Sentinel(sentinel), ["abc", "def", "ghi"]);
  assert.deepEqual(parseWan3Sentinel("wavespeed-th:abc"), []);
});

test("WAN 3.0 is on by default and can be switched back to InfiniteTalk", () => {
  const prev = process.env.WAVESPEED_TALKING_MODEL;
  try {
    delete process.env.WAVESPEED_TALKING_MODEL;
    assert.equal(isWan3Enabled(), true);
    process.env.WAVESPEED_TALKING_MODEL = "infinitetalk";
    assert.equal(isWan3Enabled(), false);
    process.env.WAVESPEED_TALKING_MODEL = "wan3";
    assert.equal(isWan3Enabled(), true);
  } finally {
    if (prev === undefined) delete process.env.WAVESPEED_TALKING_MODEL;
    else process.env.WAVESPEED_TALKING_MODEL = prev;
  }
});

// ── Submission (WaveSpeed HTTP stubbed — no real or paid calls) ───────────────

import { submitWan3Segments, isWavespeedRejection } from "./wan3-talking";

function stubWavespeed(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.WAVESPEED_API_KEY;
  process.env.WAVESPEED_API_KEY = "test-key";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.WAVESPEED_API_KEY;
      else process.env.WAVESPEED_API_KEY = prevKey;
    },
  };
}

const ok = (id: string) => ({ status: 200, body: { code: 200, data: { id, status: "created" } } });

test("isWavespeedRejection: 4xx is a rejection, 429/5xx/timeouts are not", () => {
  assert.equal(isWavespeedRejection(new Error("WaveSpeed POST /x → HTTP 400: bad resolution")), true);
  assert.equal(isWavespeedRejection(new Error("WaveSpeed POST /x → API code 422: invalid")), true);
  assert.equal(isWavespeedRejection(new Error("WaveSpeed POST /x → HTTP 429: slow down")), false);
  assert.equal(isWavespeedRejection(new Error("WaveSpeed POST /x → HTTP 502: bad gateway")), false);
  assert.equal(isWavespeedRejection(new Error("WaveSpeed POST /x → timeout after 30000ms")), false);
});

test("submits every segment to wan-3.0/reference-to-video in order", async () => {
  const stub = stubWavespeed([ok("a"), ok("b")]);
  try {
    const accepted: string[] = [];
    const result = await submitWan3Segments({
      imageUrl: "https://cdn/look.jpg",
      voiceReferenceUrl: "https://cdn/voice.mp3",
      segments: ["Uno.", "Dos."],
      onAccepted: async (id) => { accepted.push(id); },
    });
    assert.deepEqual(result.requestIds, ["a", "b"]);
    assert.equal(result.error, null);
    assert.deepEqual(accepted, ["a", "b"]);
    assert.ok(stub.calls.every((c) => c.url.endsWith("/api/v3/alibaba/wan-3.0/reference-to-video")));
  } finally {
    stub.restore();
  }
});

test("first segment rejected at 720p → whole video retried once at 480p", async () => {
  const stub = stubWavespeed([
    { status: 400, body: { code: 400, message: "resolution not supported" } },
    ok("a"),
    ok("b"),
  ]);
  try {
    const result = await submitWan3Segments({
      imageUrl: "https://cdn/look.jpg",
      voiceReferenceUrl: "https://cdn/voice.mp3",
      segments: ["Uno.", "Dos."],
    });
    assert.deepEqual(result.requestIds, ["a", "b"]);
    assert.equal(result.resolution, "480p");
    assert.deepEqual(stub.calls.map((c) => c.body.resolution), ["720p", "480p", "480p"]);
  } finally {
    stub.restore();
  }
});

test("ambiguous errors (timeout / 5xx) are never retried — a job may have been accepted", async () => {
  const stub = stubWavespeed([{ status: 502, body: {} }]);
  try {
    const result = await submitWan3Segments({
      imageUrl: "https://cdn/look.jpg",
      voiceReferenceUrl: "https://cdn/voice.mp3",
      segments: ["Uno.", "Dos."],
    });
    assert.deepEqual(result.requestIds, []);
    assert.ok(result.error);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("a later segment failing stops submission and reports the accepted ids", async () => {
  const stub = stubWavespeed([ok("a"), { status: 400, body: { code: 400, message: "bad" } }]);
  try {
    const result = await submitWan3Segments({
      imageUrl: "https://cdn/look.jpg",
      voiceReferenceUrl: "https://cdn/voice.mp3",
      segments: ["Uno.", "Dos.", "Tres."],
    });
    assert.deepEqual(result.requestIds, ["a"]);
    assert.ok(result.error);
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

// ── Review fixes ──────────────────────────────────────────────────────────────

import { trimAudioToFile, concatWan3Clips } from "./wan3-talking";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";

test("a cancelled video stops submitting further segments", async () => {
  const stub = stubWavespeed([ok("a"), ok("b"), ok("c")]);
  try {
    let checks = 0;
    const result = await submitWan3Segments({
      imageUrl: "https://cdn/look.jpg",
      voiceReferenceUrl: "https://cdn/voice.mp3",
      segments: ["Uno.", "Dos.", "Tres."],
      shouldContinue: async () => { checks++; return false; },
    });
    assert.deepEqual(result.requestIds, ["a"]);
    assert.ok(result.error);
    assert.equal(stub.calls.length, 1, "no billable job after cancellation");
    assert.equal(checks, 1);
  } finally {
    stub.restore();
  }
});

test("the delivery style (Voice Director preset) reaches the prompt", () => {
  const prompt = buildWan3Prompt({ dialogue: "Hola.", delivery: "high-energy and upbeat." });
  assert.match(prompt, /Delivery style: high-energy and upbeat\./);
  assert.doesNotMatch(buildWan3Prompt({ dialogue: "Hola." }), /Delivery style/);
});

test("provider media is only fetched over HTTPS", async () => {
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "wan3-test-"));
  try {
    await assert.rejects(trimAudioToFile("http://169.254.169.254/latest", nodePath.join(dir, "a.mp3")), /non-HTTPS/);
    await assert.rejects(trimAudioToFile("file:///etc/passwd", nodePath.join(dir, "b.mp3")), /non-HTTPS/);
    await assert.rejects(concatWan3Clips(["http://127.0.0.1/a.mp4"], nodePath.join(dir, "out.mp4")), /non-HTTPS/);
    // The per-call work dir is always cleaned up.
    assert.deepEqual(nodeFs.readdirSync(dir), []);
  } finally {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Dynamic camera (same location, different shot per segment) ───────────────

import { wan3ShotFor } from "./wan3-talking";

test("long reels get a different shot per segment: opening, varied middles, closing", () => {
  const names = Array.from({ length: 6 }, (_, i) => wan3ShotFor(i, 6).name);
  assert.equal(names[0], "OPENING HANDHELD MEDIUM SHOT");
  assert.equal(names[5], "CLOSING MEDIUM SHOT");
  // consecutive segments never repeat the same shot
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1]);
  assert.ok(new Set(names).size >= 4);
});

test("segment prompts are active, change the shot and stay in the same place", () => {
  const prompt = buildWan3Prompt({ dialogue: "Hola a todos.", segmentIndex: 1, segmentCount: 4 });
  assert.match(prompt, /ACTIVE PERFORMANCE/);
  assert.match(prompt, /SHOT 2 OF 4 — INTIMATE CLOSE-UP/);
  assert.match(prompt, /inside that same place/);
  assert.doesNotMatch(prompt, /same pose, framing and location/);
  assert.doesNotMatch(prompt, /Prioritize lip synchronization over cinematic movement/);
  assert.match(prompt, /AUDIO LOCK/);
});

test("a single-segment reel moves through three shot sizes in one take", () => {
  const prompt = buildWan3Prompt({ dialogue: "Hola a todos, hoy te cuento algo.", segmentIndex: 0, segmentCount: 1 });
  assert.match(prompt, /THREE SHOT SIZES IN ONE CONTINUOUS HANDHELD TAKE/);
  assert.match(prompt, /\[0\.0-/);
});

// ── Trailing-silence trim between shots ───────────────────────────────────────

import { trailingSilenceCut } from "./wan3-talking";

test("trailing silence after the last word is cut (keeps a short tail)", () => {
  const stderr = "  Duration: 00:00:18.00, start: 0.000000\n[silencedetect] silence_start: 3.1\n[silencedetect] silence_end: 3.6 | silence_duration: 0.5\n[silencedetect] silence_start: 16.2\n";
  assert.equal(trailingSilenceCut(stderr, 0.3), 16.5);
});

test("silence that ends exactly at the end of the file also counts as trailing", () => {
  const stderr = "Duration: 00:00:10.00,\nsilence_start: 8.0\nsilence_end: 10.0 | silence_duration: 2\n";
  assert.equal(trailingSilenceCut(stderr, 0.3), 8.3);
});

test("no trailing silence, mid-clip pauses only, or tiny clips are left untouched", () => {
  assert.equal(trailingSilenceCut("Duration: 00:00:10.00,\nsilence_start: 3\nsilence_end: 4\n", 0.3), null);
  assert.equal(trailingSilenceCut("Duration: 00:00:10.00,\n", 0.3), null);
  assert.equal(trailingSilenceCut("Duration: 00:00:02.00,\nsilence_start: 0.2\n", 0.3), null);
  assert.equal(trailingSilenceCut("no duration here", 0.3), null);
});

test("never trims more than the generation headroom (a quiet closing phrase is kept)", () => {
  // Detector claims silence from 12 s in an 18 s clip: at most 2.5 s may go.
  const stderr = "Duration: 00:00:18.00,\nsilence_start: 12.0\nsize=N/A time=00:00:18.00 bitrate=N/A\n";
  assert.equal(trailingSilenceCut(stderr, 0.3), 15.5);
});

test("uses the audio stream end (last time=) when audio is shorter than the video", () => {
  const stderr = [
    "Duration: 00:00:12.00, start: 0.000000",
    "size=N/A time=00:00:05.00 bitrate=N/A",
    "silence_start: 8.0",
    "silence_end: 10.0 | silence_duration: 2",
    "size=N/A time=00:00:10.00 bitrate=N/A",
  ].join("\n");
  assert.equal(trailingSilenceCut(stderr, 0.3), 8.3);
});
