import assert from "node:assert/strict";
import test from "node:test";

import { buildRenderFastV2Graph, isRenderFastV2Failure } from "./render-fast-v2.js";

const assPath = "/tmp/contentpilot-captioned/test/captions.ass";

test("Render Fast V2 creates one graph with ASS captions and no intermediate MP4 paths", () => {
  const graph = buildRenderFastV2Graph({
    duration: 60,
    fps: 30,
    hasAudio: true,
    rotation: 0,
    zoomTimestamps: [12, 32, 48],
    brollAssets: [],
    assPath,
  });

  assert.match(graph.filterComplex, /ass='.*captions\.ass'/);
  assert.match(graph.filterComplex, /concat=n=7:v=1:a=1/);
  assert.match(graph.filterComplex, /\[normalizedv\]split=7\[base0\]\[base1\]/);
  assert.match(graph.filterComplex, /crop=1080:1920:216:230,setsar=1\[segv1\]/);
  assert.equal(graph.inputArgs.length, 0);
  assert.equal(graph.videoMap, "[renderedv]");
  assert.equal(graph.audioMap, "[zooma]");
  assert.doesNotMatch(graph.filterComplex, /zoomed\.mp4|broll_composited\.mp4|normalized\.mp4/);
});

test("Render Fast V2 puts B-roll stills and timed motion overlays in the same graph", () => {
  const graph = buildRenderFastV2Graph({
    duration: 60,
    fps: 30,
    hasAudio: true,
    rotation: 0,
    zoomTimestamps: [20],
    assPath,
    brollAssets: [
      {
        tmpPath: "/tmp/contentpilot-captioned/test/broll_0.png",
        segment: { startSec: 10, durationSec: 3.5, imagePrompt: "test" },
      },
      {
        tmpPath: "/tmp/contentpilot-captioned/test/broll_1.png",
        segment: { startSec: 40, durationSec: 4.5, imagePrompt: "test" },
      },
    ],
  });

  assert.deepEqual(
    graph.inputArgs.filter((arg) => arg === "-i").length,
    2,
    "each B-roll still is an FFmpeg input, not an MP4 intermediate",
  );
  assert.match(graph.filterComplex, /fade=t=in:st=10\.000:d=0\.3/);
  assert.match(graph.filterComplex, /overlay=0:0:eof_action=pass:shortest=1/);
  assert.match(graph.filterComplex, /scale=1080:1920:force_original_aspect_ratio=decrease/);
});

test("Render Fast V2 emits silent synchronized audio when the source has no audio stream", () => {
  const graph = buildRenderFastV2Graph({
    duration: 20,
    fps: 30,
    hasAudio: false,
    rotation: 0,
    zoomTimestamps: [],
    brollAssets: [],
    assPath,
  });

  assert.match(graph.filterComplex, /anullsrc=channel_layout=stereo:sample_rate=48000/);
  assert.equal(graph.audioMap, "[zooma]");
});

test("Render Fast V2 failure marker is explicit and can block raw-source publishing", () => {
  assert.equal(isRenderFastV2Failure("Render Fast V2: ffmpeg exited with code 1"), true);
  assert.equal(isRenderFastV2Failure("Caption engine: ffmpeg exited with code 1"), false);
  assert.equal(isRenderFastV2Failure(null), false);
});