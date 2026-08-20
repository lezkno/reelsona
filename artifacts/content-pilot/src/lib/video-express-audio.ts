export const MAX_VIDEO_EXPRESS_ORDER_SECONDS = 180
const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const

export function getVideoExpressElapsedSeconds(startedAtMs: number, nowMs = Date.now()): number {
  return Math.min(
    MAX_VIDEO_EXPRESS_ORDER_SECONDS,
    Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)),
  )
}

export function exceedsVideoExpressAudioLimit(durationSeconds: number | null): boolean {
  return durationSeconds !== null
    && Number.isFinite(durationSeconds)
    && durationSeconds > MAX_VIDEO_EXPRESS_ORDER_SECONDS
}

/** Pick a container the current browser explicitly says it can record. */
export function getSupportedVideoExpressRecordingMime(
  isTypeSupported: (mimeType: string) => boolean,
): string | undefined {
  return RECORDING_MIME_CANDIDATES.find(isTypeSupported)
}

/** Never let an embedded browser's invalid recorder MIME turn audio into text/plain. */
export function normalizeVideoExpressRecordingMime(rawMime: string | null | undefined): string {
  return rawMime?.startsWith("audio/") ? rawMime : "audio/webm"
}

export function getVideoExpressAudioExtension(mimeType: string): "webm" | "ogg" | "m4a" {
  if (mimeType.startsWith("audio/ogg")) return "ogg"
  if (mimeType.startsWith("audio/mp4")) return "m4a"
  return "webm"
}