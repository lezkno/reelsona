import assert from "node:assert/strict";
import test from "node:test";
import { getCaptionedObjectNameFromUrl } from "./objectStorage";

test("extracts a private raw video object from the app media proxy", () => {
  assert.equal(
    getCaptionedObjectNameFromUrl("https://reelsona.com/api/captioned-objects/raw-videos/16.mp4"),
    "raw-videos/16.mp4",
  );
});

test("extracts stored subtitles and captioned outputs without treating query data as a path", () => {
  assert.equal(
    getCaptionedObjectNameFromUrl("https://reelsona.com/api/captioned-objects/subtitles/16.srt?cache=1"),
    "subtitles/16.srt",
  );
  assert.equal(
    getCaptionedObjectNameFromUrl("https://reelsona.com/api/captioned-objects/captioned-videos/browser_123.mp4"),
    "captioned-videos/browser_123.mp4",
  );
});

test("leaves external and malformed media URLs untouched", () => {
  assert.equal(getCaptionedObjectNameFromUrl("https://files2.heygen.ai/video.mp4"), null);
  assert.equal(getCaptionedObjectNameFromUrl("not a URL"), null);
  assert.equal(
    getCaptionedObjectNameFromUrl("https://reelsona.com/api/captioned-objects/raw-videos/../private.mp4"),
    null,
  );
});