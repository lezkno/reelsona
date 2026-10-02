/**
 * tts → tts-handoff → th (InfiniteTalk) | wan (WAN 3.0) → *-finalizing → ready.
 * wan → wan-retry → wan: one failed WAN segment is resubmitted once.
 * For `wan` the request id is the comma-separated list of segment job ids.
 */
export type WavespeedVideoStage =
  | "tts"
  | "tts-handoff"
  | "th"
  | "th-finalizing"
  | "wan"
  | "wan-retry"
  | "wan-finalizing";

export interface WavespeedVideoSentinel {
  stage: WavespeedVideoStage;
  requestId: string;
}

const SENTINEL_PREFIX = "wavespeed-";
const STAGES = new Set<WavespeedVideoStage>([
  "tts", "tts-handoff", "th", "th-finalizing", "wan", "wan-retry", "wan-finalizing",
]);

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
  // `wan-retry` is the same kind of lease: one failed WAN segment is being
  // resubmitted and the new id may not be recorded yet.
  return stage === "tts-handoff" || stage === "wan-retry" ? "fail_safely" : "resume";
}

/** Polling stage a finalizing lease returns to after a restart (`th` / `wan`), else null. */
export function finalizingSourceStage(stage: WavespeedVideoStage): "th" | "wan" | null {
  if (stage === "th-finalizing") return "th";
  if (stage === "wan-finalizing") return "wan";
  return null;
}

/**
 * How long a `tts-handoff` lease stays valid without a heartbeat. The worker
 * that owns the handoff refreshes the TTS job row's updated_at when it starts
 * and before every WAN segment it submits (a WAN handoff can take a minute or
 * more: voice reference upload + several sequential submissions). Until the
 * lease expires, other workers (cron, monitors, startup recovery) must WAIT:
 * failing it early killed live multi-segment WAN submissions after segment 1.
 */
export const WAVESPEED_HANDOFF_LEASE_MS = 10 * 60_000;

/** True when a tts-handoff lease has no heartbeat within the lease window. */
export function isHandoffLeaseExpired(
  heartbeatAt: Date | null | undefined,
  now: Date = new Date(),
  leaseMs: number = WAVESPEED_HANDOFF_LEASE_MS,
): boolean {
  if (!heartbeatAt) return true;
  return now.getTime() - heartbeatAt.getTime() > leaseMs;
}
