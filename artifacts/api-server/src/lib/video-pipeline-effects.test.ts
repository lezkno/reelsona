import assert from "node:assert/strict";
import test from "node:test";
import {
  captionsAreEnabled,
  normalizeVideoEffects,
  resolveVideoEffectsForCreation,
  resolveVideoEffectsForProcessing,
} from "./video-pipeline-effects";

const none = { zoom: false, ai_broll: false, text_cards: false };

test("manual creation snapshots all disabled effects explicitly", () => {
  assert.deepEqual(resolveVideoEffectsForCreation(null, null), none);
  assert.equal(captionsAreEnabled(false), false);
});

test("automatic creation treats only true as an enabled switch", () => {
  assert.deepEqual(
    normalizeVideoEffects({ zoom: true, ai_broll: "true", text_cards: 1 }),
    { zoom: true, ai_broll: false, text_cards: false },
  );
  assert.equal(captionsAreEnabled(true), true);
});

test("a partial item override changes only its explicit switch", () => {
  assert.deepEqual(
    resolveVideoEffectsForCreation(
      { zoom: true, ai_broll: true, text_cards: false },
      { zoom: false },
    ),
    { zoom: false, ai_broll: true, text_cards: false },
  );
});

test("each supported effect can be selected independently", () => {
  for (const key of ["zoom", "ai_broll", "text_cards"] as const) {
    assert.deepEqual(
      resolveVideoEffectsForCreation(none, { [key]: true }),
      { ...none, [key]: true },
    );
  }
});

test("current settings disable historical snapshot effects", () => {
  assert.deepEqual(
    resolveVideoEffectsForProcessing(
      { zoom: true, ai_broll: true, text_cards: true },
      { zoom: false, ai_broll: false, text_cards: false },
      true,
    ),
    none,
  );
});

test("a partial or null current configuration cannot revive old effects", () => {
  const snapshot = { zoom: true, ai_broll: true, text_cards: true };
  assert.deepEqual(
    resolveVideoEffectsForProcessing(snapshot, { zoom: false }, true),
    none,
  );
  assert.deepEqual(
    resolveVideoEffectsForProcessing(snapshot, null, true),
    none,
  );
});

test("legacy videos use their normalized snapshot only when settings are absent", () => {
  assert.deepEqual(
    resolveVideoEffectsForProcessing(
      { zoom: true, ai_broll: false, text_cards: true },
      undefined,
      false,
    ),
    { zoom: true, ai_broll: false, text_cards: true },
  );
});