import assert from "node:assert/strict";
import test from "node:test";

import { getBrowserTemplateStyleOverrides } from "./caption-style-adapter.js";

test("Fast V2 uses the active Browser template's 1920px typography", () => {
  const style = getBrowserTemplateStyleOverrides("neon_glow");

  assert.ok(style);
  assert.equal(style.fontFamily, "Bangers");
  assert.equal(style.fontSize, 115);
  assert.equal(style.wordsPerLine, 3);
});

test("Fast V2 honors a saved Browser template font-size override", () => {
  const style = getBrowserTemplateStyleOverrides("neon_glow", { fontSize: 148 });

  assert.ok(style);
  assert.equal(style.fontSize, 148);
});

test("an unknown Browser template does not alter the configured ASS style", () => {
  assert.equal(getBrowserTemplateStyleOverrides("not-a-template"), null);
});