import { strict as assert } from "node:assert"
import { test } from "node:test"
import { resolveVideoPreviewSources } from "../video-preview-source"

test("a cancelled video opens its WaveSpeed original even when a captioned URL remains", () => {
  const sources = resolveVideoPreviewSources({
    status: "cancelled",
    video_url: "https://media.example.test/raw-video.mp4",
    captioned_video_url: "https://media.example.test/partial-effects.mp4",
  })

  assert.deepEqual(sources, {
    videoSrc: "https://media.example.test/raw-video.mp4",
    fallbackSrc: null,
    showsOriginal: true,
  })
})

test("a ready video continues preferring the captioned render with raw fallback", () => {
  const sources = resolveVideoPreviewSources({
    status: "ready",
    video_url: "https://media.example.test/raw-video.mp4",
    captioned_video_url: "https://media.example.test/final-effects.mp4",
  })

  assert.deepEqual(sources, {
    videoSrc: "https://media.example.test/final-effects.mp4",
    fallbackSrc: "https://media.example.test/raw-video.mp4",
    showsOriginal: false,
  })
})