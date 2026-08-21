import assert from "node:assert/strict";
import test from "node:test";

import {
  getWavDurationMs,
  transcriptionResponseToSrt,
} from "./wavespeed-transcription-srt";
import { parseSRT } from "./browser-caption-engine";

test("preserves real word timestamps from a transcription JSON response", () => {
  const result = transcriptionResponseToSrt(
    {
      words: [
        { word: "Hola", start: 0.42, end: 0.76 },
        { word: "mundo", start: 0.77, end: 1.28 },
      ],
    },
    2_000,
  );

  assert.deepEqual(result, {
    source: "word_timestamps",
    srt: "1\n00:00:00,420 --> 00:00:00,760\nHola\n\n2\n00:00:00,770 --> 00:00:01,280\nmundo",
  });
});

test("converts the proxy's JSON-only transcript into a usable SRT", () => {
  const result = transcriptionResponseToSrt(
    { text: "Hola mundo desde WaveSpeed" },
    4_000,
  );

  assert.equal(result?.source, "transcript");
  assert.deepEqual(parseSRT(result?.srt ?? ""), [
    { text: "Hola mundo desde WaveSpeed", startMs: 0, endMs: 4_000 },
  ]);
});

test("calculates the duration of the fixed PCM WAV extracted by the scheduler", () => {
  const wav = Buffer.alloc(44 + 32_000);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(32_000, 40);

  assert.equal(getWavDurationMs(wav), 1_000);
});