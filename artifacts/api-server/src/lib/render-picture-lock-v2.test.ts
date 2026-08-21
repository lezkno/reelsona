import assert from "node:assert/strict";
import test from "node:test";

import { buildPictureLockGraph } from "./render-picture-lock-v2.js";

test("picture lock keeps Fast V2 effects graph but removes terminal ASS", () => {
  const graph = buildPictureLockGraph({
    duration: 10,
    fps: 30,
    hasAudio: true,
    rotation: 0,
    zoomTimestamps: [3],
    brollAssets: [],
    assPath: "/tmp/captions.ass",
    fontsDir: "/tmp/fonts",
  });

  assert.match(graph.filterComplex, /scale=1080:1920/);
  assert.match(graph.filterComplex, /crop=1080:1920/);
  assert.doesNotMatch(graph.filterComplex, /ass='/);
  assert.match(graph.filterComplex, /null\[picturelockv\]$/);
  assert.equal(graph.videoMap, "[picturelockv]");
  assert.equal(graph.audioMap, "[zooma]");
});
