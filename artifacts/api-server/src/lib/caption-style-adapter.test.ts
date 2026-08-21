import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserTemplateStyleOverrides,
  getBrowserTemplateVisualOverrides,
} from "./caption-style-adapter.js";

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