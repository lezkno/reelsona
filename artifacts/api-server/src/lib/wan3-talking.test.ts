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
  assert.match(prompt, /part 2 of 3/);
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
