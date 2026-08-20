import assert from "node:assert/strict"
import test from "node:test"
import {
  getVideoToolsSummaryState,
  resolveVideoToolsEffects,
} from "../VideoToolsSummary.logic"

const allEnabled = { zoom: true, ai_broll: true, text_cards: true }
const allDisabled = { zoom: false, ai_broll: false, text_cards: false }
const enabledTools = { zoom: true, ai_broll: true, text_cards: false }

test("tool summary starts from global settings when there is no override", () => {
  assert.deepEqual(
    resolveVideoToolsEffects({ zoom: true, ai_broll: false, text_cards: true }, null),
    { zoom: true, ai_broll: false, text_cards: false },
  )
})

test("a partial video override changes only the switch it specifies", () => {
  for (const key of ["zoom", "ai_broll"] as const) {
    assert.deepEqual(
      resolveVideoToolsEffects(allEnabled, { [key]: false }),
      { ...enabledTools, [key]: false },
      `override for ${key} must preserve the other tools`,
    )
  }
})

test("text card settings stay disabled while that tool is not part of the product surface", () => {
  assert.equal(resolveVideoToolsEffects(allEnabled, { text_cards: true }).text_cards, false)
})

test("a video snapshot is authoritative over global settings and overrides", () => {
  assert.deepEqual(
    resolveVideoToolsEffects(allEnabled, { zoom: false }, { zoom: false, ai_broll: true, text_cards: false }),
    { zoom: false, ai_broll: true, text_cards: false },
  )
})

test("the summary reports captions as active when done", () => {
  assert.deepEqual(getVideoToolsSummaryState(allDisabled, true, "done").captions, {
    label: "Captions · listos",
    enabled: true,
  })
})

test("the summary reports captions as off when disabled", () => {
  assert.deepEqual(getVideoToolsSummaryState(allDisabled, false, "disabled").captions, {
    label: "Captions · apagados",
    enabled: false,
  })
})

test("the summary reports captions as processing", () => {
  assert.deepEqual(getVideoToolsSummaryState(allDisabled, true, "processing").captions, {
    label: "Captions · procesando",
    enabled: true,
  })
})

test("the summary reports caption errors without changing other tools", () => {
  const summary = getVideoToolsSummaryState({ zoom: true, ai_broll: false, text_cards: true }, true, "failed")
  assert.deepEqual(summary.captions, {
    label: "Captions · error",
    enabled: true,
    status: "fallaron",
  })
  assert.deepEqual(
    { zoom: summary.zoom.enabled, ai_broll: summary.ai_broll.enabled, text_cards: summary.text_cards.enabled },
    { zoom: true, ai_broll: false, text_cards: false },
  )
})