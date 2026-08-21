import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHybridCaptionCompositePlan,
  buildHybridCaptionVideoOnlyPlan,
} from "./hybrid-caption-compositor.js";

test("builds one FFmpeg graph and copies picture-lock audio", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    captionTrackManifestPath: "captions.ffconcat",
    outputPath: "final.mp4",
    segments: [
      { pngPath: "a.png", startSec: 0.5, endSec: 1.5 },
      { pngPath: "b.png", startSec: 1.5, endSec: 2.5 },
    ],
  });

  assert.equal(plan.overlapFixes, 0);
  assert.ok(plan.filterComplex.includes("[0:v]format=rgba[captions]"));
  assert.ok(plan.filterComplex.includes("[1:v][captions]overlay=0:0"));
  assert.deepEqual(plan.args.slice(0, 8), [
    "-f", "concat",
    "-safe", "0",
    "-i", "captions.ffconcat",
    "-i", "picture-lock.mp4",
  ]);
  assert.deepEqual(plan.args.slice(-14), [
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-y", "final.mp4",
  ]);
  assert.equal(plan.args.filter((arg) => arg === "-filter_complex").length, 1);
  assert.equal(plan.args.includes("-loop"), false);
  assert.equal(plan.args.includes("-shortest"), false);
  assert.ok(plan.args.includes("1:a?"));
});

test("repairs overlapping Canvas frames before they reach FFmpeg", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    captionTrackManifestPath: "captions.ffconcat",
    outputPath: "final.mp4",
    segments: [
      { pngPath: "old.png", startSec: 1, endSec: 4 },
      { pngPath: "new.png", startSec: 2, endSec: 3 },
    ],
  });

  assert.equal(plan.overlapFixes, 1);
  assert.ok(plan.segments[0].endSec < plan.segments[1].startSec);
});

test("keeps a transparent caption stream when no captions were generated", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    captionTrackManifestPath: "captions.ffconcat",
    outputPath: "final.mp4",
    segments: [],
  });

  assert.ok(plan.filterComplex.includes("overlay=0:0"));
  assert.ok(plan.args.includes("1:a?"));
  assert.ok(plan.args.includes("copy"));
});

test("uses one caption stream for 61 Canvas frames", () => {
  const plan = buildHybridCaptionCompositePlan({
    pictureLockPath: "picture-lock.mp4",
    captionTrackManifestPath: "captions.ffconcat",
    outputPath: "final.mp4",
    segments: Array.from({ length: 61 }, (_, index) => ({
      pngPath: `caption-${index}.png`,
      startSec: index * 0.1,
      endSec: (index + 1) * 0.1,
    })),
  });

  assert.equal(plan.segments.length, 61);
  assert.equal(plan.args.filter((arg) => arg === "-i").length, 2);
  assert.equal(plan.filterComplex.match(/overlay=/g)?.length, 1);
});

test("extreme batch fallback renders video-only before a single final audio mux", () => {
  const plan = buildHybridCaptionVideoOnlyPlan({
    videoPath: "picture-lock.mp4",
    outputPath: "caption-batch.mp4",
    width: 1080,
    height: 1920,
    segments: [{ pngPath: "a.png", startSec: 0.5, endSec: 1.5 }],
  });

  assert.ok(plan.args.includes("-an"));
  assert.equal(plan.args.includes("-c:a"), false);
  assert.equal(plan.args.includes("0:a?"), false);
});
