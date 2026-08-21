import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCaptionLayout, canonicalCaptionXPosition } from "./caption-config-layout.js";

test("caption X persistence clamps the center to the selected width", () => {
  assert.equal(canonicalCaptionXPosition(0, 80), 40);
  assert.equal(canonicalCaptionXPosition(100, 80), 60);
  assert.equal(canonicalCaptionXPosition(55, 80), 55);
});

test("changing width also canonicalizes an existing X center", () => {
  assert.equal(canonicalCaptionXPosition(30, 60), 30);
  assert.equal(canonicalCaptionXPosition(30, 40), 30);
  assert.equal(canonicalCaptionXPosition(30, 80), 40);
});

test("a partial width update projects its legacy margin so Browser and Fast V2 share width", () => {
  assert.deepEqual(
    canonicalCaptionLayout(
      { maxWidthPercent: 80 },
      { maxWidthPercent: 88.9, marginX: 60, xPosition: 50 },
    ),
    { maxWidthPercent: 80, marginX: 108, xPosition: 50 },
  );
});