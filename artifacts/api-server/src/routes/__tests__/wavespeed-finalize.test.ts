import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mergeFinalLookConfig } from "../wavespeed-finalize.js";

describe("RC1 WaveSpeed avatar finalization", () => {
  test("selected look keeps generation metadata and persists voice + selected", () => {
    const raw = JSON.stringify({ requestId: "req_1", generationStatus: "ready", outputUrl: "https://img" });
    const merged = JSON.parse(mergeFinalLookConfig(raw, true, 77));
    assert.equal(merged.requestId, "req_1");
    assert.equal(merged.generationStatus, "ready");
    assert.equal(merged.outputUrl, "https://img");
    assert.equal(merged.selected, true);
    assert.equal(merged.voiceId, 77);
  });

  test("unselected look is explicitly disabled and cannot retain a stale voice", () => {
    const raw = JSON.stringify({ generationStatus: "ready", selected: true, voiceId: 55 });
    const merged = JSON.parse(mergeFinalLookConfig(raw, false, 77));
    assert.equal(merged.generationStatus, "ready");
    assert.equal(merged.selected, false);
    assert.equal(merged.voiceId, null);
  });

  test("invalid legacy config still produces a valid persisted final config", () => {
    const merged = JSON.parse(mergeFinalLookConfig("not-json", true, 88));
    assert.deepEqual(merged, { selected: true, voiceId: 88 });
  });
});
