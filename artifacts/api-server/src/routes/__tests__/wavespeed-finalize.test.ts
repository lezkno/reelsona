import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mergeFinalLookConfig } from "../wavespeed-finalize.js";
import { computePersonaPlanEnabled, isBlockedPersonaConfigUpdate } from "../../lib/planLimits.js";

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

  test("Basic keeps the oldest persona and blocks the rest", () => {
    const enabled = computePersonaPlanEnabled(
      [{ id: 10 }, { id: 20 }, { id: 30 }],
      1,
    );
    assert.equal(enabled.get(10), true);
    assert.equal(enabled.get(20), false);
    assert.equal(enabled.get(30), false);
  });

  test("restoring the Pro limit re-enables previously blocked personas", () => {
    const enabled = computePersonaPlanEnabled(
      [{ id: 10 }, { id: 20 }, { id: 30 }],
      3,
    );
    assert.deepEqual([...enabled.values()], [true, true, true]);
  });

  test("blocked look config cannot change selection or voice, but can be cleared by name/deletion flows", () => {
    assert.equal(isBlockedPersonaConfigUpdate(false, { selected: true }), true);
    assert.equal(isBlockedPersonaConfigUpdate(false, { voiceId: null }), true);
    assert.equal(isBlockedPersonaConfigUpdate(false, { selected: false }), true);
    assert.equal(isBlockedPersonaConfigUpdate(false, { generationStatus: "ready" }), false);
    assert.equal(isBlockedPersonaConfigUpdate(true, { selected: true, voiceId: 77 }), false);
    assert.equal(isBlockedPersonaConfigUpdate(false, undefined), false);
  });
});
