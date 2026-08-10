/**
 * Unit tests — punch zoom helpers.
 *
 * Covers the two pure functions that drive the effect:
 *   • findPunchZoomTimestamps  (browser-caption-engine)
 *   • buildPunchZoomArgs       (caption-engine)
 *
 * No DB, no network, no FFmpeg — pure logic only.
 *
 * Run with:
 *   node --import tsx/esm --test src/lib/punch-zoom.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { findPunchZoomTimestamps } from "./browser-caption-engine.js";
import { buildPunchZoomArgs }      from "./caption-engine.js";
import type { WordTiming }          from "./browser-caption-engine.js";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal WordTiming array from a list of [word, startSec] pairs. */
function makeTimings(pairs: Array<[string, number]>): WordTiming[] {
  return pairs.map(([text, startSec]) => ({
    text,
    startMs: Math.round(startSec * 1000),
    endMs:   Math.round(startSec * 1000) + 400,
  }));
}

// ── findPunchZoomTimestamps ───────────────────────────────────────────────────

test("returns proportional fallback [30%, 65%] when wordTimings is empty", () => {
  const ts = findPunchZoomTimestamps("Normal sentence. Another one.", [], 60);
  assert.equal(ts.length, 2, "should produce 2 fallback timestamps");
  assert.ok(Math.abs(ts[0] - 18) < 1, `expected ~18s, got ${ts[0]}`);
  assert.ok(Math.abs(ts[1] - 39) < 1, `expected ~39s, got ${ts[1]}`);
});

test("detects a sentence ending with ! and maps to its SRT timestamp", () => {
  const script   = "This is an intro. Este es el punto más importante!";
  const timings  = makeTimings([
    ["This", 2], ["is", 2.4], ["an", 2.8], ["intro", 3.2],
    ["Este", 20], ["es", 20.5], ["el", 21], ["punto", 21.5],
    ["más", 22], ["importante", 22.5],
  ]);
  const ts = findPunchZoomTimestamps(script, timings, 60);
  assert.ok(ts.length >= 1, "must find at least one timestamp");
  // The first word of the exclamation sentence ("Este") is at 20s
  assert.ok(ts.includes(20), `expected timestamp 20 (found: ${ts.join(",")})`);
});

test("detects emphasis keywords (importante, recuerda, clave)", () => {
  const script  = "Introduction text here. Recuerda que esto es clave para tu vida.";
  const timings = makeTimings([
    ["Introduction", 1], ["text", 1.5], ["here", 2],
    ["Recuerda", 15], ["que", 15.5], ["esto", 16], ["es", 16.5],
    ["clave", 17], ["para", 17.5], ["tu", 18], ["vida", 18.5],
  ]);
  const ts = findPunchZoomTimestamps(script, timings, 60);
  assert.ok(ts.length >= 1, "must find at least one timestamp");
  // "Recuerda" at 15s should be picked
  assert.ok(ts.includes(15), `expected timestamp 15 (found: ${ts.join(",")})`);
});

test("enforces minimum 8-second spacing between timestamps", () => {
  // Two emphasis sentences very close together
  const script  = "Recuerda esto! Y también recuerda aquello!";
  const timings = makeTimings([
    ["Recuerda", 5], ["esto", 5.5],
    ["Y", 9], ["también", 9.5], ["recuerda", 10], ["aquello", 10.5],
  ]);
  const ts = findPunchZoomTimestamps(script, timings, 60, 3);
  for (let i = 1; i < ts.length; i++) {
    assert.ok(
      ts[i] - ts[i - 1] >= 8,
      `timestamps ${ts[i-1]} and ${ts[i]} are < 8 s apart`,
    );
  }
});

test("excludes timestamps in first 3 s or last 4 s of video", () => {
  const duration = 30;
  // Trigger proportional fallback (no word timings) so we can check clamping
  const ts = findPunchZoomTimestamps("Normal sentence.", [], duration);
  for (const t of ts) {
    assert.ok(t >= 3,            `timestamp ${t} is too early (< 3 s)`);
    assert.ok(t < duration - 4,  `timestamp ${t} is too close to end`);
  }
});

test("respects maxZooms cap", () => {
  const script  = "Importante! Clave! Fundamental! Recuerda! Esencial!";
  const timings = makeTimings([
    ["Importante",  5],
    ["Clave",       15],
    ["Fundamental", 25],
    ["Recuerda",    35],
    ["Esencial",    45],
  ]);
  const ts = findPunchZoomTimestamps(script, timings, 80, 2);
  assert.ok(ts.length <= 2, `expected ≤ 2 timestamps, got ${ts.length}`);
});

// ── buildPunchZoomArgs ────────────────────────────────────────────────────────

test("returns null for an empty timestamps array", () => {
  const result = buildPunchZoomArgs([], 60, 720, 1280);
  assert.equal(result, null, "must return null when no timestamps given");
});

test("returns an array containing -filter_complex, -map [vout], -map [aout]", () => {
  const args = buildPunchZoomArgs([20], 60, 720, 1280);
  assert.ok(Array.isArray(args), "must return an array");
  assert.ok(args!.includes("-filter_complex"),  "must include -filter_complex");
  assert.ok(args!.includes("-map"),             "must include -map");
  assert.ok(args!.includes("[vout]"),           "must map [vout]");
  assert.ok(args!.includes("[aout]"),           "must map [aout]");
});

test("filter_complex interleaves labels as v0,a0,v1,a1 not v0,v1,a0,a1", () => {
  const args = buildPunchZoomArgs([20], 60, 720, 1280);
  const fc   = args![args!.indexOf("-filter_complex") + 1];
  // The concat line must have interleaved pairs, not all-v then all-a
  const concatLine = fc.split(";").find(p => p.includes("concat="));
  assert.ok(concatLine, "must have a concat line");
  const labels = [...concatLine!.matchAll(/\[(v|a)(\d+)\]/g)].map(m => m[1]);
  // pattern should alternate: v, a, v, a  (not v, v, …, a, a)
  for (let i = 0; i < labels.length - 1; i++) {
    assert.notEqual(labels[i], labels[i + 1],
      `labels[${i}] and labels[${i+1}] are both "${labels[i]}" — not interleaved`);
  }
});

test("zoom segments include scale and crop; normal segments do not", () => {
  const args = buildPunchZoomArgs([20], 60, 720, 1280);
  const fc   = args![args!.indexOf("-filter_complex") + 1];
  const parts = fc.split(";");

  const zoomPart   = parts.find(p => p.includes("scale=") && p.includes("crop="));
  const normalPart = parts.find(p => !p.includes("scale=") && p.includes("trim="));

  assert.ok(zoomPart,   "must have at least one zoom segment with scale+crop");
  assert.ok(normalPart, "must have at least one normal segment without scale/crop");
});

test("scaled dimensions are even (H.264 requirement)", () => {
  // Use odd source dimensions to force even-rounding
  const args = buildPunchZoomArgs([10], 40, 719, 1279);
  const fc   = args![args!.indexOf("-filter_complex") + 1];
  const m    = fc.match(/scale=(\d+):(\d+)/);
  assert.ok(m, "must have a scale filter");
  const [, w, h] = m!.map(Number);
  assert.equal(w % 2, 0, `scaled width ${w} must be even`);
  assert.equal(h % 2, 0, `scaled height ${h} must be even`);
});

test("punch zoom clamped at video end does not produce segments past duration", () => {
  // Timestamp very close to end — the zoom should be clamped
  const duration = 30;
  const args = buildPunchZoomArgs([28], duration, 720, 1280);
  const fc   = args![args!.indexOf("-filter_complex") + 1];
  // Extract all end= values from trim/atrim
  const ends = [...fc.matchAll(/end=(\d+\.\d+)/g)].map(m => parseFloat(m[1]));
  for (const end of ends) {
    assert.ok(end <= duration + 0.01,
      `segment end ${end} exceeds video duration ${duration}`);
  }
});

test("multiple timestamps produce correct segment count", () => {
  // 2 punch zooms → 5 segments: normal, zoom, normal, zoom, normal
  const args = buildPunchZoomArgs([10, 30], 60, 720, 1280);
  const fc   = args![args!.indexOf("-filter_complex") + 1];
  const parts = fc.split(";").filter(p => p.trim());
  // N zoom events = 2N+1 segments, each has video+audio parts = 2*(2N+1)+1 (concat)
  // So with 2 zooms: 5 segments × 2 streams + 1 concat = 11 parts
  assert.equal(parts.length, 11,
    `expected 11 filter parts for 2 zooms (5 seg × 2 + concat), got ${parts.length}`);
});
