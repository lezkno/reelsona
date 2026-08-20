import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  exceedsVideoExpressAudioLimit,
  getVideoExpressElapsedSeconds,
  MAX_VIDEO_EXPRESS_ORDER_SECONDS,
} from "../video-express-audio"

test("Video Express measures elapsed wall-clock time instead of counting timer ticks", () => {
  const startedAt = 1_000

  assert.equal(getVideoExpressElapsedSeconds(startedAt, startedAt + 61_900), 61)
  assert.equal(getVideoExpressElapsedSeconds(startedAt, startedAt + 62_100), 62)
})

test("Video Express never displays a duration beyond the recording limit", () => {
  assert.equal(
    getVideoExpressElapsedSeconds(1_000, 1_000 + (MAX_VIDEO_EXPRESS_ORDER_SECONDS + 20) * 1_000),
    MAX_VIDEO_EXPRESS_ORDER_SECONDS,
  )
})

test("Video Express rejects only audio whose real metadata duration exceeds the limit", () => {
  assert.equal(exceedsVideoExpressAudioLimit(null), false)
  assert.equal(exceedsVideoExpressAudioLimit(MAX_VIDEO_EXPRESS_ORDER_SECONDS), false)
  assert.equal(exceedsVideoExpressAudioLimit(MAX_VIDEO_EXPRESS_ORDER_SECONDS + 0.01), true)
})