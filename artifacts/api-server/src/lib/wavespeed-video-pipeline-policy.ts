export type WavespeedVideoStage = "tts" | "tts-handoff" | "th" | "th-finalizing";

export interface WavespeedVideoSentinel {
  stage: WavespeedVideoStage;
  requestId: string;
}

const SENTINEL_PREFIX = "wavespeed-";
const STAGES = new Set<WavespeedVideoStage>(["tts", "tts-handoff", "th", "th-finalizing"]);

/**
 * The provider request id lives in videos.heygenVideoId for historical
 * compatibility. Keep parsing in one place so recovery never accidentally
 * treats an unknown provider value as a WaveSpeed video.
 */
export function parseWavespeedVideoSentinel(value: string | null | undefined): WavespeedVideoSentinel | null {
  if (!value?.startsWith(SENTINEL_PREFIX)) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;

  const stage = value.slice(SENTINEL_PREFIX.length, separator) as WavespeedVideoStage;
  const requestId = value.slice(separator + 1);
  return STAGES.has(stage) && requestId ? { stage, requestId } : null;
}

/** Targeted monitors only own a video while it remains in the provider pipeline. */
export function shouldMonitorWavespeedVideo(status: string, sentinel: string | null | undefined): boolean {
  return status === "generating" && parseWavespeedVideoSentinel(sentinel) !== null;
}

/**
 * A finalizer can be resumed after a process restart because the remote
 * prediction id is already durable. In contrast, a TTS handoff had claimed the
 * local row before a talking-head submission was durably recorded; retrying it
 * could create a second billable prediction, so it must fail explicitly.
 */
export function recoveryStage(stage: WavespeedVideoStage): "resume" | "fail_safely" {
  return stage === "tts-handoff" ? "fail_safely" : "resume";
}