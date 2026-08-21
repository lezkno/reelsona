import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptionTrackManifest } from "./hybrid-canvas-renderer.js";

test("builds one transparent Canvas track across caption gaps", () => {
  const manifest = buildCaptionTrackManifest({
    blankPngPath: "/tmp/blank.png",
    durationSeconds: 3,
    segments: [
      { pngPath: "/tmp/first.png", startSec: 0.5, endSec: 1.25 },
      { pngPath: "/tmp/second.png", startSec: 2, endSec: 2.5 },
    ],
  });

  assert.match(manifest, /^ffconcat version 1.0/m);
  assert.match(manifest, /file '\/tmp\/blank\.png'\nduration 0\.500000/);
  assert.match(manifest, /file '\/tmp\/first\.png'\nduration 0\.750000/);
  assert.match(manifest, /file '\/tmp\/blank\.png'\nduration 0\.750000/);
  assert.match(manifest, /file '\/tmp\/second\.png'\nduration 0\.500000/);
  assert.match(manifest, /file '\/tmp\/blank\.png'\nduration 0\.500000/);
  assert.match(manifest, /file '\/tmp\/blank\.png'\n$/);
});

test("preserves a transparent source for an empty caption track", () => {
  const manifest = buildCaptionTrackManifest({
    blankPngPath: "/tmp/blank.png",
    durationSeconds: 2,
    segments: [],
  });

  assert.equal(
    manifest,
    "ffconcat version 1.0\n" +
      "file '/tmp/blank.png'\n" +
      "duration 2.000000\n" +
      "file '/tmp/blank.png'\n",
  );
});