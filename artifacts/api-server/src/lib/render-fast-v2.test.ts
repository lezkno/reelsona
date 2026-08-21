import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRenderFastV2Graph,
  formatRenderFastV2Error,
  getRenderFastV2TimeoutMs,
  isRenderFastV2Failure,
  shouldUseRenderFastV2,
} from "./render-fast-v2.js";
import { buildCaptionArtifactsFromSrt, type CaptionStyle } from "./caption-engine.js";
import { getBrowserTemplateStyleOverrides } from "./caption-style-adapter.js";
import {
  marginXFromMaxWidthPercent,
  maxWidthPercentFromMarginX,
} from "@workspace/caption-templates";

const assPath = "/tmp/contentpilot-captioned/test/captions.ass";

const captionStyle: CaptionStyle = {
  presetId: "test",
  position: "bottom",
  yPosition: 75,
  marginX: 60,
  maxWidthPercent: 80,
  wordsPerLine: 3,
  primaryColor: "#FFFFFF",
  activeWordColor: "#FFE600",
  outlineColor: "#000000",
  backgroundColor: null,
  fontFamily: "Oswald",
  fontSize: 72,
  lineSpacingFactor: 1.1,
  activeWordScale: 1,
  highlightMode: "color",
  autoScale: false,
  autoMovement: false,
  subtleRotation: false,
};

function styleColumns(ass: string): string[] {
  const line = ass.split("\n").find((value) => value.startsWith("Style: Caption,"));
  assert.ok(line, "generated ASS contains a Caption style");
  return line.split(",");
}

test("Render Fast V2 passes the saved font size to libass without auto-scaling", () => {
  const { ass } = buildCaptionArtifactsFromSrt(
    "1\n00:00:00,000 --> 00:00:01,000\npalabra extraordinariamente larga\n",
    captionStyle,
  );
  assert.equal(styleColumns(ass)[2], "72", "ASS Fontsize exactly matches font_size=72");
});

test("switching browser templates preserves the saved canonical size unless an explicit override exists", () => {
  const hormozi = getBrowserTemplateStyleOverrides("hormozi", undefined, 72);
  const anotherTemplate = getBrowserTemplateStyleOverrides("authority_bold", undefined, 72);
  const explicitOverride = getBrowserTemplateStyleOverrides("hormozi", { fontSize: 115 }, 72);

  assert.equal(hormozi?.fontSize, 72);
  assert.equal(anotherTemplate?.fontSize, 72);
  assert.equal(explicitOverride?.fontSize, 115);
});

test("canonical layout maps proportionally to the 1080×1920 ASS canvas", () => {
  const { ass } = buildCaptionArtifactsFromSrt(
    "1\n00:00:00,000 --> 00:00:01,000\ntexto de prueba\n",
    captionStyle,
    1080,
    1920,
  );
  const columns = styleColumns(ass);
  assert.equal(columns[19], "108", "80% max width leaves 108px on the left");
  assert.equal(columns[20], "108", "80% max width leaves 108px on the right");
  assert.equal(columns[21], "480", "75% from the top becomes a 480px bottom margin");
});

test("preview and ASS derive identical safe margins from the canonical width", () => {
  const maxWidthPercent = maxWidthPercentFromMarginX(108);
  assert.equal(Math.round(maxWidthPercent), 80);
  assert.equal(marginXFromMaxWidthPercent(maxWidthPercent, 1080), 108);
  assert.equal(
    Math.round(marginXFromMaxWidthPercent(maxWidthPercent, 250)),
    25,
    "the phone preview uses the same proportional edge inset",
  );
});

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
  assert.match(graph.filterComplex, /loop=loop=-1:size=1:start=0,setpts=N\/\(30\*TB\),crop=1080:1920/);
  assert.doesNotMatch(graph.inputArgs.join(" "), /(?:^|\s)-loop(?:\s|$)/);
  assert.doesNotMatch(graph.inputArgs.join(" "), /(?:^|\s)-t(?:\s|$)/);
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

test("Render Fast V2 turns a killed FFmpeg process into an actionable timeout message", () => {
  assert.equal(
    formatRenderFastV2Error({ killed: true, signal: "SIGKILL" }),
    "Render Fast V2: El render tardó demasiado y se detuvo. Intenta de nuevo; no se publicará el video sin los efectos.",
  );
});

test("Render Fast V2 is the default in every environment", () => {
  assert.equal(shouldUseRenderFastV2(undefined), true);
  assert.equal(shouldUseRenderFastV2("fast_v2"), true);
  assert.equal(shouldUseRenderFastV2(" LEGACY "), false);
});

test("Render Fast V2 final encoding has a hard six-minute ceiling", () => {
  assert.equal(getRenderFastV2TimeoutMs(0), 3 * 60_000);
  assert.equal(getRenderFastV2TimeoutMs(20), 5 * 60_000);
  assert.equal(getRenderFastV2TimeoutMs(30), 6 * 60_000);
  assert.equal(getRenderFastV2TimeoutMs(120), 6 * 60_000);
});