import assert from "node:assert/strict";
import test from "node:test";

import { buildHybridCaptionCompositePlan } from "./hybrid-caption-compositor.js";

test("builds one FFmpeg graph and copies picture-lock audio", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    outputPath: "final.mp4",
    width: 1080,
    height: 1920,
    segments: [
      { pngPath: "a.png", startSec: 0.5, endSec: 1.5 },
      { pngPath: "b.png", startSec: 1.5, endSec: 2.5 },
    ],
  });

  assert.equal(plan.overlapFixes, 0);
  assert.ok(plan.filterComplex.includes("between(t,0.500000,1.500000)"));
  assert.ok(plan.filterComplex.includes("between(t,1.500000,2.500000)"));
  assert.deepEqual(plan.args.slice(-8), [
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-shortest", "-y", "final.mp4",
  ]);
  assert.equal(plan.args.filter((arg) => arg === "-filter_complex").length, 1);
});

test("repairs overlapping Canvas frames before they reach FFmpeg", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    outputPath: "final.mp4",
    width: 1080,
    height: 1920,
    segments: [
      { pngPath: "old.png", startSec: 1, endSec: 4 },
      { pngPath: "new.png", startSec: 2, endSec: 3 },
    ],
  });

  assert.equal(plan.overlapFixes, 1);
  assert.ok(plan.segments[0].endSec < plan.segments[1].startSec);
});

test("uses the original MP4 when no captions were generated", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    outputPath: "final.mp4",
    width: 1080,
    height: 1920,
    segments: [],
  });

  assert.equal(plan.filterComplex, "[0:v]null[captionedv]");
  assert.ok(plan.args.includes("0:a?"));
  assert.ok(plan.args.includes("copy"));
});
