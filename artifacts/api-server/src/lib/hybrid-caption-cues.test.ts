import assert from "node:assert/strict";
import test from "node:test";

import { getBrowserTemplate } from "@workspace/caption-templates";
import { buildHybridCaptionCues, clampHybridCueWindows } from "./hybrid-caption-cues.js";

test("phrase SRT is split into sequential wordsPerLine chunks without accumulation", () => {
  const base = getBrowserTemplate("dimigium");
  assert.ok(base);
  const template = { ...base, wordsPerLine: 2, buildingMode: false };
  const plan = buildHybridCaptionCues([
    { text: "marketing su función real es", startMs: 0, endMs: 2000 },
  ], template);

  assert.equal(plan.sourceMode, "phrase");
  assert.deepEqual(plan.cues.map((cue) => cue.words.map((word) => word.text)), [
    ["marketing", "su"],
    ["función", "real"],
    ["es"],
  ]);

  const clamped = clampHybridCueWindows(plan.cues);
  for (let i = 0; i < clamped.length - 1; i++) {
    assert.ok(clamped[i].endMs <= clamped[i + 1].startMs);
  }
});

test("invalid and overlapping source timings cannot create overlapping cue windows", () => {
  const base = getBrowserTemplate("clean_coach");
  assert.ok(base);
  const template = { ...base, wordsPerLine: 2, buildingMode: false };
  const plan = buildHybridCaptionCues([
    { text: "uno", startMs: 0, endMs: 1000 },
    { text: "dos", startMs: 700, endMs: 1500 },
    { text: "malo", startMs: 1000, endMs: 900 },
  ], template);
  const clamped = clampHybridCueWindows(plan.cues);

  for (let i = 0; i < clamped.length - 1; i++) {
    assert.ok(clamped[i].endMs <= clamped[i + 1].startMs);
  }
});
