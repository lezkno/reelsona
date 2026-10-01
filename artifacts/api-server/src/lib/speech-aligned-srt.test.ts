import test from "node:test";
import assert from "node:assert/strict";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { execFileSync } from "node:child_process";
import {
  alignTranscriptToSpeech,
  detectSpeechIntervals,
  speechAlignedSrt,
  speechIntervalsFromSilencedetect,
  syllableWeight,
} from "./speech-aligned-srt";

test("silencedetect output becomes the complementary speech intervals", () => {
  const stderr = [
    "[silencedetect] silence_start: 0",
    "[silencedetect] silence_end: 0.62 | silence_duration: 0.62",
    "[silencedetect] silence_start: 3.1",
    "[silencedetect] silence_end: 3.9 | silence_duration: 0.8",
    "[silencedetect] silence_start: 7.5",
  ].join("\n");
  assert.deepEqual(speechIntervalsFromSilencedetect(stderr, 8_000), [
    { startMs: 620, endMs: 3_100 },
    { startMs: 3_900, endMs: 7_500 },
  ]);
});

test("no silence at all → one interval covering the whole audio", () => {
  assert.deepEqual(speechIntervalsFromSilencedetect("", 5_000), [{ startMs: 0, endMs: 5_000 }]);
});

test("syllable weights approximate speaking time, not letters", () => {
  assert.equal(syllableWeight("emprendedores"), 5);
  assert.equal(syllableWeight("y"), 1);
  assert.equal(syllableWeight("¿Sabes?"), 2);
  assert.equal(syllableWeight("90%"), 2);
  assert.ok(syllableWeight("fuerte") < syllableWeight("ahorita"));
});

test("leading silence and pauses never receive captions; blocks start when the voice resumes", () => {
  // Voice from 0.8–3.0 s, pause, voice again 4.0–6.0 s.
  const intervals = [
    { startMs: 800, endMs: 3_000 },
    { startMs: 4_000, endMs: 6_000 },
  ];
  const blocks = alignTranscriptToSpeech("Hola a todos. Hoy te cuento un secreto. Quédate hasta el final.", intervals)!;
  assert.ok(blocks.length >= 2);
  assert.equal(blocks[0]!.startMs, 800, "first caption waits for the voice");
  for (const b of blocks) {
    const inside = intervals.some((iv) => b.startMs >= iv.startMs && b.endMs <= iv.endMs);
    assert.ok(inside, `block "${b.text}" spans a pause (${b.startMs}-${b.endMs})`);
  }
  // Some block starts exactly when speech resumes after the pause.
  assert.ok(blocks.some((b) => b.startMs === 4_000));
  // Every word is kept, in order.
  assert.equal(
    blocks.map((b) => b.text).join(" "),
    "Hola a todos. Hoy te cuento un secreto. Quédate hasta el final.",
  );
});

test("blocks have at most 5 words and the SRT is well formed", () => {
  const srt = speechAlignedSrt(
    "uno dos tres cuatro cinco seis siete ocho nueve diez once",
    [{ startMs: 0, endMs: 5_000 }],
  )!;
  const blocks = srt.split("\n\n");
  assert.equal(blocks.length, 3);
  for (const block of blocks) {
    const [index, timing, text] = block.split("\n");
    assert.match(index!, /^\d+$/);
    assert.match(timing!, /^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/);
    assert.ok(text!.split(" ").length <= 5);
  }
  assert.match(srt, /00:00:05,000/);
});

test("nothing to align → null (caller falls back to the even spread)", () => {
  assert.equal(alignTranscriptToSpeech("", [{ startMs: 0, endMs: 1_000 }]), null);
  assert.equal(alignTranscriptToSpeech("hola", []), null);
});

test("detects real speech intervals in an audio file with FFmpeg", async (t) => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    t.skip("ffmpeg not installed");
    return;
  }
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "speech-align-"));
  const wav = nodePath.join(dir, "a.wav");
  try {
    // 0.5 s silence, 1 s tone, 1 s silence, 1 s tone, 0.5 s silence
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i",
      "aevalsrc=if(between(t\\,0.5\\,1.5)+between(t\\,2.5\\,3.5)\\,0.5*sin(2*PI*440*t)\\,0):s=16000:d=4",
      "-ac", "1", wav,
    ]);
    const intervals = await detectSpeechIntervals(wav, 4_000);
    assert.ok(intervals, "detection failed");
    assert.equal(intervals!.length, 2);
    assert.ok(Math.abs(intervals![0]!.startMs - 500) < 60);
    assert.ok(Math.abs(intervals![1]!.startMs - 2_500) < 60);
    assert.ok(Math.abs(intervals![1]!.endMs - 3_500) < 60);
  } finally {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the split between speech runs snaps to punctuation (the word after a period goes after the pause)", () => {
  const blocks = alignTranscriptToSpeech(
    "Hoy te cuento el error que más cometen. Y cómo evitarlo desde mañana mismo.",
    [{ startMs: 1_000, endMs: 4_000 }, { startMs: 5_500, endMs: 8_500 }],
  )!;
  const firstAfterPause = blocks.find((b) => b.startMs >= 5_500)!;
  assert.match(firstAfterPause.text, /^Y cómo/);
  assert.ok(blocks.filter((b) => b.endMs <= 4_000).every((b) => !/\bY\b/.test(b.text)));
});

import { segmentTimeRanges } from "./speech-aligned-srt";

test("each text segment maps to the time range where the audio says it", () => {
  // Three sentences spoken in three runs of speech separated by pauses.
  const intervals = [
    { startMs: 300, endMs: 2_300 },
    { startMs: 3_000, endMs: 5_000 },
    { startMs: 5_800, endMs: 7_800 },
  ];
  const ranges = segmentTimeRanges(
    ["Hola a todos, bienvenidos.", "Hoy te cuento un secreto.", "Quédate hasta el final."],
    intervals,
  )!;
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0]!.startMs, 300);
  assert.equal(ranges[1]!.startMs, 3_000);
  assert.equal(ranges[2]!.startMs, 5_800);
  assert.equal(ranges[2]!.endMs, 7_800);
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i]!.startMs >= ranges[i - 1]!.endMs);
});

test("segment ranges are null when there is nothing to align", () => {
  assert.equal(segmentTimeRanges(["hola"], []), null);
  assert.equal(segmentTimeRanges(["hola", "   "], [{ startMs: 0, endMs: 1_000 }]), null);
});
