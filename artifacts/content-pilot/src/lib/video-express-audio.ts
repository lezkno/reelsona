export const MAX_VIDEO_EXPRESS_ORDER_SECONDS = 120

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