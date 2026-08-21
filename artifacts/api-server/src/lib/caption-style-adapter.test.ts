import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserTemplateStyleOverrides,
  getBrowserTemplateVisualOverrides,
} from "./caption-style-adapter.js";
import { buildCaptionArtifactsFromSrt, type CaptionStyle } from "./caption-engine.js";
import {
  BROWSER_CAPTION_TEMPLATES,
  getFastV2TemplatePreview,
} from "@workspace/caption-templates";

test("Fast V2 uses the active Browser template's 1920px typography", () => {
  const style = getBrowserTemplateStyleOverrides("neon_glow");

  assert.ok(style);
  assert.equal(style.fontFamily, "Bangers");
  assert.equal(style.fontSize, 115);
  assert.equal(style.wordsPerLine, 3);
});

test("Fast V2 ignores legacy geometric template overrides in favor of the canonical layout", () => {
  const style = getBrowserTemplateStyleOverrides("neon_glow", { fontSize: 148, yPercent: 20 }, 92);

  assert.ok(style);
  assert.equal(style.fontSize, 92);
});

test("Fast V2 carries visual overrides including inactive opacity", () => {
  const style = getBrowserTemplateStyleOverrides("authority_bold", {
    inactiveOpacity: 0.25,
    primaryColor: "#123456",
    activeWordColor: "#abcdef",
    outlineColor: "#fedcba",
    wordsPerLine: 2,
  });

  assert.ok(style);
  assert.equal(style.inactiveOpacity, 0.25);
  assert.equal(style.primaryColor, "#123456");
  assert.equal(style.activeWordColor, "#abcdef");
  assert.equal(style.outlineColor, "#fedcba");
  assert.equal(style.wordsPerLine, 2);
});

test("an unknown Browser template does not alter the configured ASS style", () => {
  assert.equal(getBrowserTemplateStyleOverrides("not-a-template"), null);
});

test("Browser Engine receives only visual overrides and the canonical font size", () => {
  const overrides = getBrowserTemplateVisualOverrides(
    { fontSize: 148, xPercent: 10, marginXPercent: 30, primaryColor: "#123456" },
    92,
  );
  assert.deepEqual(overrides, { fontSize: 92, primaryColor: "#123456" });
});

test("every shipped template declares its exact Fast V2-compatible preview contract", () => {
  const expectedControls: Record<string, string[]> = {
    authority_bold: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    viral_stack: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    clean_coach: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    hormozi: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    dimidium_mix: ["outlineWidth", "primaryColor", "activeWordColor", "outlineColor"],
    zoom_in: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    bold_stack: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    bangers_comic: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    neon_glow: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    cinematic: ["wordsPerLine", "outlineWidth", "inactiveOpacity", "primaryColor", "activeWordColor", "outlineColor"],
    scale_pop: ["outlineWidth", "primaryColor", "outlineColor"],
    broadcast: ["wordsPerLine", "inactiveOpacity", "primaryColor", "activeWordColor"],
    hot_box: ["primaryColor"],
    dimigium: ["wordsPerLine", "inactiveOpacity", "primaryColor", "activeWordColor"],
  };

  assert.equal(BROWSER_CAPTION_TEMPLATES.length, 14);
  for (const template of BROWSER_CAPTION_TEMPLATES) {
    const preview = getFastV2TemplatePreview(template.id);
    const style = getBrowserTemplateStyleOverrides(template.id);
    assert.ok(preview, `${template.id} has a Fast V2 preview contract`);
    assert.ok(style, `${template.id} resolves to a CaptionStyle`);
    assert.equal(preview.template.id, style.presetId);
    assert.equal(preview.template.fontFamily, style.fontFamily);
    assert.equal(preview.template.fontSize, style.fontSize);
    assert.equal(preview.wordsPerLine, style.wordsPerLine);
    assert.deepEqual(
      Object.entries(preview.controls)
        .filter(([, enabled]) => enabled)
        .map(([control]) => control),
      expectedControls[template.id],
      `${template.id} exposes only controls that change Fast V2 output`,
    );
  }
});

test("Fast V2 uses ASS constraints instead of Browser-only glow, pills and scale", () => {
  const hormozi = getFastV2TemplatePreview("hormozi");
  const neon = getFastV2TemplatePreview("neon_glow");
  const hotBox = getFastV2TemplatePreview("hot_box");
  const dimidium = getFastV2TemplatePreview("dimidium_mix");

  assert.equal(hormozi?.assFontFamily, "DejaVu Sans");
  assert.equal(neon?.shadowDepth, 0, "ASS cannot reproduce a blur-only neon glow");
  assert.equal(hotBox?.hasDialogueBox, true);
  assert.equal(hotBox?.outlineWidth, 0, "opaque ASS boxes suppress outlines");
  assert.equal(hotBox?.renderMode, "pop");
  assert.equal(dimidium?.renderMode, "mixed");
  assert.equal(dimidium?.assLetterSpacing, 0);
  assert.equal(dimidium?.shadowDepth, 2);
  assert.equal(dimidium?.controls.wordsPerLine, false);
  assert.equal(dimidium?.controls.inactiveOpacity, false);
  assert.equal(
    getFastV2TemplatePreview("dimigium")?.assBackgroundColor,
    "rgba(0,0,0,0.5)",
    "the preview mirrors libass's rgba-only box-color conversion",
  );
});

test("every Fast V2 preview contract matches its generated ASS style header", () => {
  const srt = "1\n00:00:00,000 --> 00:00:01,000\nmarca crece";

  for (const template of BROWSER_CAPTION_TEMPLATES) {
    const preview = getFastV2TemplatePreview(template.id);
    const style = getBrowserTemplateStyleOverrides(template.id);
    assert.ok(preview, `${template.id} resolves a preview contract`);
    assert.ok(style, `${template.id} resolves an ASS style`);

    const ass = buildCaptionArtifactsFromSrt(srt, style as CaptionStyle).ass;
    const styleLine = ass.split("\n").find((line) => line.startsWith("Style: Caption,"));
    assert.ok(styleLine, `${template.id} emits an ASS style header`);
    const fields = styleLine.replace("Style: ", "").split(",");

    assert.equal(fields[1], preview.assFontFamily, `${template.id} resolves the same libass font`);
    assert.equal(Number(fields[13]), preview.assLetterSpacing, `${template.id} resolves the same ASS spacing`);
    assert.equal(Number(fields[15]), preview.hasDialogueBox ? 3 : 1, `${template.id} resolves the same ASS border style`);
    assert.equal(Number(fields[16]), preview.outlineWidth, `${template.id} resolves the same ASS outline`);
    assert.equal(Number(fields[17]), preview.shadowDepth, `${template.id} resolves the same ASS shadow`);

    const expectedMode = template.highlightMode === "mixed"
      ? "mixed"
      : template.highlightMode === "color"
        ? "highlight"
        : "pop";
    assert.equal(preview.renderMode, expectedMode, `${template.id} follows the ASS dispatcher`);
  }
});