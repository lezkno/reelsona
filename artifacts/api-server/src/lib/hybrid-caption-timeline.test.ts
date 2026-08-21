import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCaptionOverlayTimelineIsExclusive,
  normalizeCaptionOverlayTimeline,
} from "./hybrid-caption-timeline.js";

test("keeps already-exclusive caption segments unchanged", () => {
  const source = [
    { pngPath: "a.png", startSec: 0.5, endSec: 1.0 },
    { pngPath: "b.png", startSec: 1.2, endSec: 1.8 },
  ];

  const result = normalizeCaptionOverlayTimeline(source);

  assert.deepEqual(result.segments, source);
  assert.equal(result.issues.length, 0);
  assert.doesNotThrow(() => assertCaptionOverlayTimelineIsExclusive(result.segments));
});

test("cuts a previous caption before the next caption begins", () => {
  const result = normalizeCaptionOverlayTimeline([
    { pngPath: "old.png", startSec: 1.0, endSec: 3.0 },
    { pngPath: "new.png", startSec: 2.0, endSec: 4.0 },
  ]);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.reason, "overlap");
  assert.ok(result.segments[0].endSec < result.segments[1].startSec);
  assert.doesNotThrow(() => assertCaptionOverlayTimelineIsExclusive(result.segments));
});

test("sorts out-of-order frames and prevents accumulated building-mode overlays", () => {
  const result = normalizeCaptionOverlayTimeline([
    { pngPath: "word-3.png", startSec: 1.8, endSec: 3.5 },
    { pngPath: "word-1.png", startSec: 1.0, endSec: 3.5 },
    { pngPath: "word-2.png", startSec: 1.4, endSec: 3.5 },
  ]);

  assert.deepEqual(result.segments.map((segment) => segment.pngPath), [
    "word-1.png",
    "word-2.png",
    "word-3.png",
  ]);
  assert.ok(result.issues.filter((issue) => issue.reason === "overlap").length >= 2);
  assert.doesNotThrow(() => assertCaptionOverlayTimelineIsExclusive(result.segments));
});

test("drops invalid zero-length caption windows", () => {
  const result = normalizeCaptionOverlayTimeline([
    { pngPath: "bad.png", startSec: 2, endSec: 2 },
    { pngPath: "good.png", startSec: 2.1, endSec: 2.5 },
  ]);

  assert.deepEqual(result.segments, [
    { pngPath: "good.png", startSec: 2.1, endSec: 2.5 },
  ]);
  assert.equal(result.issues[0]?.reason, "invalid");
});
