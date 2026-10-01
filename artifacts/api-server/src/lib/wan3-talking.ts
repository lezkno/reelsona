/**
 * WAN 3.0 talking-head pipeline (WaveSpeed `alibaba/wan-3.0/reference-to-video`).
 *
 * Replaces InfiniteTalk for the avatar video step while keeping the rest of the
 * pipeline identical (script → MiniMax cloned-voice TTS → video → Whisper SRT →
 * captions → publish):
 *
 *   • The persona look image goes in `reference_images[0]` (start frame AND
 *     identity anchor). The endpoint silently drops an `image` field.
 *   • A ≤10 s clip of the MiniMax TTS audio goes in `reference_audios` as the
 *     voice identity. WAN generates the speech itself from the EXACT DIALOGUE
 *     block of the prompt, so captions keep working: they are transcribed from
 *     the final MP4 audio track.
 *   • WAN renders at most 30 s per job, and long dialogues make it repeat
 *     phrases, so the script is split into ≤36-word segments, one job each.
 *     The finished clips are concatenated with FFmpeg.
 *
 * Set WAVESPEED_TALKING_MODEL=infinitetalk to go back to the previous model.
 * Any WAN submission error or failed segment falls back to InfiniteTalk so the
 * reel is never lost. Accepted jobs are NEVER resubmitted (WaveSpeed bills each
 * submission).
 */

import nodeFs from "fs";
import nodePath from "path";
import os from "os";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { submitJob, WAVESPEED_MODELS } from "./wavespeed";
import { detectSpeechIntervals, probeDurationMs, segmentTimeRanges } from "./speech-aligned-srt";

const execFileAsync = promisify(execFile);

// ── Config ─────────────────────────────────────────────────────────────────────

/** Sentinel stage stored in videos.heygenVideoId: `wavespeed-wan:{id1},{id2},…` */
export const WAN3_SENTINEL_PREFIX = "wavespeed-wan:";

/** Max words per WAN segment (≈19 s at 2.2 words/s — beyond this WAN repeats phrases). */
export const WAN3_MAX_WORDS_PER_SEGMENT = 36;
/** Average speaking rate used to size each segment's duration. */
const WAN3_WORDS_PER_SECOND = 2.2;
const WAN3_MIN_DURATION_SEC = 2;
const WAN3_MAX_DURATION_SEC = 30;
/** WaveSpeed recommends a 3–10 s voice reference. */
export const WAN3_VOICE_REFERENCE_SECONDS = 10;
/** Final concatenated resolution (9:16). */
const WAN3_OUTPUT_WIDTH = 720;
const WAN3_OUTPUT_HEIGHT = 1280;

/** True unless WAVESPEED_TALKING_MODEL=infinitetalk. */
export function isWan3Enabled(): boolean {
  return (process.env.WAVESPEED_TALKING_MODEL ?? "wan3").trim().toLowerCase() !== "infinitetalk";
}

/** WAN output resolution: WAN3_RESOLUTION env (480p | 720p | 1080p), default 720p. */
export function getWan3Resolution(): string {
  const value = (process.env.WAN3_RESOLUTION ?? "720p").trim().toLowerCase();
  return ["480p", "720p", "1080p"].includes(value) ? value : "720p";
}

// ── Pure helpers (unit-testable) ───────────────────────────────────────────────

const LANGUAGE_LABELS: Record<string, string> = {
  es: "Spanish",
  "es-es": "Castilian Spanish from Spain",
  "es-mx": "Mexican Spanish",
  "es-419": "neutral Latin American Spanish",
  "es-ar": "Argentine Spanish (rioplatense, voseo)",
  "es-co": "Colombian Spanish",
  en: "English",
  "en-us": "American English",
  "en-gb": "British English",
  pt: "Portuguese",
  "pt-br": "Brazilian Portuguese",
  "pt-pt": "European Portuguese",
  fr: "French",
  "fr-fr": "French",
  it: "Italian",
  "it-it": "Italian",
  de: "German",
  "de-de": "German",
};

/** English name of the speech language for the WAN prompt. Never hard-coded to Spanish. */
export function wan3LanguageLabel(code: string | null | undefined): string {
  const normalized = (code ?? "es").trim().toLowerCase();
  return (
    LANGUAGE_LABELS[normalized] ??
    LANGUAGE_LABELS[normalized.split("-")[0]!] ??
    "Spanish"
  );
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Split a long sentence at commas, then at word boundaries, to fit maxWords. */
function splitLongSentence(sentence: string, maxWords: number): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
    const words = clause.split(/\s+/).filter(Boolean);
    if (current.length > 0 && current.length + words.length > maxWords) {
      parts.push(current.join(" "));
      current = [];
    }
    for (const word of words) {
      if (current.length >= maxWords) {
        parts.push(current.join(" "));
        current = [];
      }
      current.push(word);
    }
  }
  if (current.length > 0) parts.push(current.join(" "));
  return parts;
}

/**
 * Split the script into consecutive segments of at most `maxWords` words,
 * cutting at sentence boundaries whenever possible. Joining the segments with
 * a space reproduces every word of the script in order.
 */
export function splitScriptIntoWan3Segments(
  script: string,
  maxWords = WAN3_MAX_WORDS_PER_SEGMENT,
): string[] {
  const clean = script.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const sentences = clean.split(/(?<=[.!?…]["»”)]?)\s+/).filter(Boolean);

  const segments: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const pieces = countWords(sentence) > maxWords ? splitLongSentence(sentence, maxWords) : [sentence];
    for (const piece of pieces) {
      if (current && countWords(current) + countWords(piece) > maxWords) {
        segments.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** Integer `duration` (seconds) for a WAN segment — enough time to say every word once. */
export function wan3DurationForText(text: string): number {
  const seconds = Math.ceil(countWords(text) / WAN3_WORDS_PER_SECOND + 1.5);
  return Math.min(WAN3_MAX_DURATION_SEC, Math.max(WAN3_MIN_DURATION_SEC, seconds));
}

interface Wan3Shot {
  name: string;
  camera: string;
  action: string;
}

/**
 * Shot plan for multi-segment reels: every segment is a different shot in the
 * SAME location (same look image), so the cuts between segments read as
 * intentional edits instead of the same static frame repeated.
 */
const WAN3_OPENING_SHOT: Wan3Shot = {
  name: "OPENING HANDHELD MEDIUM SHOT",
  camera:
    "Start in the IMAGE 1 composition (waist-up medium shot). Handheld camera with a gentle natural sway, " +
    "then a slow 10% push-in as the hook lands.",
  action:
    "The person leans slightly toward the lens, raises one hand to punctuate the hook, with lively eyebrows " +
    "and a genuine smile.",
};

const WAN3_MIDDLE_SHOTS: Wan3Shot[] = [
  {
    name: "INTIMATE CLOSE-UP",
    camera:
      "New camera position in the same place: chest-up close-up, slow continuous 8-12% push-in followed by " +
      "a subtle lateral slide.",
    action:
      "Expressive face, small nods, hands rising into frame at chest height, a brief glance down as if " +
      "thinking, then straight back to the lens.",
  },
  {
    name: "THREE-QUARTER SIDE ANGLE",
    camera:
      "New angle in the same place: the camera is 25-35 degrees to the side for a three-quarter view and " +
      "arcs smoothly like a gimbal while the person turns head and shoulders back toward the lens.",
    action:
      "Counts points on the fingers, shifts weight from one leg to the other, open-palm gestures, keeps " +
      "talking while turning toward the camera.",
  },
  {
    name: "WALK-AND-TALK WIDER SHOT",
    camera:
      "Wider shot from the knees up in the same place. Handheld follow shot: the camera slowly backs up while " +
      "the person takes two or three steps toward it.",
    action:
      "Walks naturally while talking with a relaxed arm swing, then stops and delivers the key line with a " +
      "confident gesture.",
  },
];

const WAN3_CLOSING_SHOT: Wan3Shot = {
  name: "CLOSING MEDIUM SHOT",
  camera:
    "Medium shot in the same place with a gentle 5-8% pull-back and a slight lateral move for the call to action.",
  action:
    "Warm smile, points toward the camera on the call to action, relaxed confident body language, final nod.",
};

/** Shot for a segment: opening, rotating middle shots, closing. */
export function wan3ShotFor(segmentIndex: number, segmentCount: number): Wan3Shot {
  if (segmentIndex === 0) return WAN3_OPENING_SHOT;
  if (segmentIndex === segmentCount - 1) return WAN3_CLOSING_SHOT;
  return WAN3_MIDDLE_SHOTS[(segmentIndex - 1) % WAN3_MIDDLE_SHOTS.length]!;
}

const fmt = (n: number) => n.toFixed(1);

/**
 * Camera direction for one WAN job. A single-segment reel gets three shot sizes
 * in one continuous take; each segment of a longer reel gets its own shot.
 */
function buildWan3CameraDirection(segmentIndex: number, segmentCount: number, duration: number): string {
  if (segmentCount <= 1) {
    const h = Math.max(0.8, duration * 0.3);
    const p = Math.max(h + 0.5, duration * 0.7);
    return (
      "CAMERA — THREE SHOT SIZES IN ONE CONTINUOUS HANDHELD TAKE, NO CUTS: " +
      `[0.0-${fmt(h)}s] ${WAN3_OPENING_SHOT.camera} ${WAN3_OPENING_SHOT.action} ` +
      `[${fmt(h)}-${fmt(p)}s] smooth continuous move into a chest-up close-up with a slow push-in; ${WAN3_MIDDLE_SHOTS[0]!.action} ` +
      `[${fmt(p)}-${fmt(duration)}s] gentle lateral arc and pull-back into a three-quarter medium shot; ${WAN3_CLOSING_SHOT.action}`
    );
  }
  const shot = wan3ShotFor(segmentIndex, segmentCount);
  return (
    `SHOT ${segmentIndex + 1} OF ${segmentCount} — ${shot.name}, one continuous take (the edit cuts between ` +
    `shots, never inside this one). CAMERA: ${shot.camera} ACTION: ${shot.action}`
  );
}

/**
 * Build the WAN 3.0 prompt for one segment.
 * Dialogue goes in its own "spoken once" block: without it WAN repeats phrases
 * after a camera or gesture transition. The person keeps moving like a real
 * creator (active mode) and every segment of a long reel is a different shot
 * in the same location.
 */
export function buildWan3Prompt(opts: {
  dialogue: string;
  language?: string | null;
  topic?: string | null;
  /** Optional delivery style (e.g. from a Voice Director preset). */
  delivery?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
}): string {
  const language = wan3LanguageLabel(opts.language);
  const isSpanish = language.toLowerCase().includes("spanish");
  const dialogue = opts.dialogue.replace(/"/g, "'").trim();
  const segmentCount = opts.segmentCount ?? 1;
  const segmentIndex = opts.segmentIndex ?? 0;
  const duration = wan3DurationForText(opts.dialogue);

  const lines = [
    "IMAGE 1 is the authoritative identity anchor and defines the location. Keep the exact same face, facial " +
      "structure, eyes, nose, mouth, skin tone, hair and recognizable likeness, the same outfit, and the same " +
      "place, background style and lighting from the first frame to the last frame. Do not invent or replace the " +
      "face. The camera position and shot size may change as directed below, but always inside that same place. " +
      "Use the audio reference ONLY as the target person's voice identity, timbre, " +
      `${isSpanish ? "accent, " : ""}and natural speaking style. Never speak, repeat or continue the words heard ` +
      "in the audio reference: the only words spoken are the EXACT DIALOGUE below. Generate clear " +
      `${language} speech with accurate lip synchronization and natural blinking.`,
    "The person in IMAGE 1 is the only person in the scene and the only person who speaks.",
    `The person speaks to the camera in ${language}, with clear pronunciation, believable phoneme-level lip ` +
      "synchronization, natural pauses, and an engaging, energetic tone, like a real content creator talking " +
      "to their audience.",
    "ACTIVE PERFORMANCE — never a stiff presenter standing still: hands, shoulders and body keep moving " +
      "naturally while talking, with expressive gestures, head tilts, leaning in and shifting weight. " +
      "Accurate lip sync on every word; hands never cover or touch the mouth, and the face stays well lit with " +
      "the mouth clearly visible in every shot.",
    opts.topic ? `The video is about: ${opts.topic.replace(/\s+/g, " ").trim().slice(0, 200)}.` : "",
    opts.delivery ? `Delivery style: ${opts.delivery}` : "",
    buildWan3CameraDirection(segmentIndex, segmentCount, duration),
    "Camera motion is smooth and physically plausible (handheld or gimbal feel). Never teleport to another " +
      "location, crop the mouth, zoom abruptly or interrupt the speech.",
    "AUDIO LOCK — Speak the following dialogue exactly once from beginning to end, in order. Never repeat, " +
      "restart, paraphrase, summarize, or add any word after a camera or gesture transition. Keep the same " +
      "uninterrupted audio performance. After the last word, stay silent with a natural closed-mouth expression.",
    `EXACT DIALOGUE — spoken once, in order, without adding or repeating words: "${dialogue}"`,
    "CONTINUITY RULES — Same person, exact face, body, outfit, location, background and lighting throughout. " +
      "No location changes, second speaker, background music, subtitles, text, captions, logos, duplicated " +
      "limbs, or extra people. Cinematic vertical 9:16 composition.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Exact request body for `alibaba/wan-3.0/reference-to-video`. */
export function buildWan3Payload(opts: {
  imageUrl: string;
  voiceReferenceUrl: string;
  dialogue: string;
  language?: string | null;
  topic?: string | null;
  delivery?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
  resolution?: string;
}): Record<string, unknown> {
  return {
    prompt: buildWan3Prompt(opts),
    // The endpoint ignores a separate `image` field: the start frame MUST be reference_images[0].
    reference_images: [opts.imageUrl],
    reference_audios: [opts.voiceReferenceUrl],
    resolution: opts.resolution ?? getWan3Resolution(),
    aspect_ratio: "9:16",
    duration: wan3DurationForText(opts.dialogue),
    enable_prompt_expansion: false,
    enable_audio: true,
    seed: -1,
  };
}

/** Parse `wavespeed-wan:{id1},{id2}` → ["id1", "id2"]. */
export function parseWan3Sentinel(sentinel: string): string[] {
  if (!sentinel.startsWith(WAN3_SENTINEL_PREFIX)) return [];
  return sentinel.slice(WAN3_SENTINEL_PREFIX.length).split(",").map((id) => id.trim()).filter(Boolean);
}

export function buildWan3Sentinel(requestIds: string[]): string {
  return `${WAN3_SENTINEL_PREFIX}${requestIds.join(",")}`;
}

// ── I/O helpers ────────────────────────────────────────────────────────────────

/**
 * True when WaveSpeed definitively rejected a submission (HTTP/API 4xx other
 * than 429). A rejected job is not created and not billed, so it is safe to
 * retry with different parameters.
 */
export function isWavespeedRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(?:HTTP|API code) 4(?!29)\d\d\b/.test(message);
}

/**
 * Submit one WAN job per segment. Stops at the first submission error and
 * returns the ids already accepted so the caller can persist them (they are
 * billed) and decide the fallback. If the very first segment is rejected at
 * 720p/1080p, the whole video is retried once at 480p.
 */
export async function submitWan3Segments(opts: {
  imageUrl: string;
  voiceReferenceUrl: string;
  /**
   * Optional per-segment voice reference (the TTS audio saying that same
   * segment). A reference that says OTHER words makes WAN mix them into the
   * speech, so each segment should get its own slice.
   */
  voiceReferenceUrls?: string[];
  segments: string[];
  language?: string | null;
  topic?: string | null;
  delivery?: string | null;
  apiKey?: string;
  onAccepted?: (requestId: string, segmentIndex: number, payload: Record<string, unknown>) => Promise<void>;
  /**
   * Checked before every segment after the first; returning false stops the
   * loop (e.g. the video was cancelled) so no further billable job is created.
   */
  shouldContinue?: () => Promise<boolean>;
}): Promise<{ requestIds: string[]; resolution: string; error: Error | null }> {
  const requestIds: string[] = [];
  let resolution = getWan3Resolution();
  for (let i = 0; i < opts.segments.length; i++) {
    if (requestIds.length > 0 && opts.shouldContinue && !(await opts.shouldContinue())) {
      return { requestIds, resolution, error: new Error("WAN 3.0 submission stopped: the video is no longer generating") };
    }
    const payload = buildWan3Payload({
      imageUrl: opts.imageUrl,
      voiceReferenceUrl: opts.voiceReferenceUrls?.[i] ?? opts.voiceReferenceUrl,
      dialogue: opts.segments[i]!,
      language: opts.language,
      topic: opts.topic,
      delivery: opts.delivery,
      segmentIndex: i,
      segmentCount: opts.segments.length,
      resolution,
    });
    let requestId: string;
    try {
      ({ requestId } = await submitJob(WAVESPEED_MODELS.WAN3_TALKING, payload, opts.apiKey));
    } catch (err) {
      if (i === 0 && resolution !== "480p" && isWavespeedRejection(err)) {
        resolution = "480p";
        i--; // retry the first segment (nothing was accepted or billed)
        continue;
      }
      return { requestIds, resolution, error: err instanceof Error ? err : new Error(String(err)) };
    }
    requestIds.push(requestId);
    await opts.onAccepted?.(requestId, i, payload);
  }
  return { requestIds, resolution, error: null };
}

/**
 * One voice reference per segment: the slice of the TTS audio that speaks that
 * segment's own words (≤ WAN3_VOICE_REFERENCE_SECONDS from its start), found by
 * aligning the segment texts over the detected speech of the TTS audio.
 *
 * Why: WAN conditions on what the reference SAYS, not only on the timbre. With
 * the script's opening as the reference for every segment, later segments
 * mixed the opening words into their own dialogue ("garbled" speech).
 *
 * `segments` must be consecutive pieces of the text the audio says. Returns
 * null when the audio cannot be aligned (caller keeps a single reference);
 * a single failed slice falls back to `fallbackUrl`.
 */
export async function prepareSegmentVoiceReferences(opts: {
  audioSource: string;
  segments: string[];
  fallbackUrl: string;
  upload: (localPath: string, segmentIndex: number) => Promise<string>;
}): Promise<string[] | null> {
  const workDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "wan3-voice-"));
  try {
    let audioPath = opts.audioSource;
    if (/^[a-z][a-z0-9+.-]*:/i.test(opts.audioSource)) {
      assertHttpsUrl(opts.audioSource);
      const res = await fetch(opts.audioSource, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Audio download failed: HTTP ${res.status}`);
      audioPath = nodePath.join(workDir, "tts.audio");
      nodeFs.writeFileSync(audioPath, Buffer.from(await res.arrayBuffer()));
    }
    const durationMs = await probeDurationMs(audioPath);
    if (!durationMs) return null;
    const intervals = await detectSpeechIntervals(audioPath, durationMs);
    const ranges = intervals ? segmentTimeRanges(opts.segments, intervals) : null;
    if (!ranges) return null;

    const urls: string[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const { startMs, endMs } = ranges[i]!;
      const start = Math.max(0, startMs - 150) / 1000;
      const length = Math.min(WAN3_VOICE_REFERENCE_SECONDS, Math.max(1, (endMs - startMs + 300) / 1000));
      const outPath = nodePath.join(workDir, `ref-${i}.mp3`);
      try {
        await execFileAsync("ffmpeg", [
          "-y", "-ss", start.toFixed(3), "-i", audioPath,
          "-t", length.toFixed(3),
          "-vn", "-acodec", "libmp3lame", "-b:a", "128k",
          outPath,
        ]);
        urls.push(await opts.upload(outPath, i));
      } catch {
        urls.push(opts.fallbackUrl);
      }
    }
    return urls;
  } catch {
    return null;
  } finally {
    nodeFs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Write the first `seconds` of an audio URL or local file to a local MP3 (voice reference clip). */
export async function trimAudioToFile(audioSource: string, outPath: string, seconds = WAN3_VOICE_REFERENCE_SECONDS): Promise<void> {
  const isRemote = /^[a-z][a-z0-9+.-]*:/i.test(audioSource);
  const inPath = isRemote ? `${outPath}.${randomUUID()}.src` : audioSource;
  if (isRemote) {
    assertHttpsUrl(audioSource);
    const res = await fetch(audioSource, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Audio download failed: HTTP ${res.status}`);
    nodeFs.writeFileSync(inPath, Buffer.from(await res.arrayBuffer()));
  }
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inPath,
      "-t", String(seconds),
      "-vn", "-acodec", "libmp3lame", "-b:a", "128k",
      outPath,
    ]);
  } finally {
    if (isRemote) nodeFs.rmSync(inPath, { force: true });
  }
}

/**
 * Download the finished WAN clips and join them into one MP4 at 720×1280.
 * A single clip is re-encoded the same way so every output has the same format.
 */
export async function concatWan3Clips(clipUrls: string[], outPath: string): Promise<void> {
  // Unique work dir per call: two concurrent joins of the same video never
  // share (or delete) each other's part files.
  const workDir = nodeFs.mkdtempSync(nodePath.join(nodePath.dirname(outPath), "wan3-join-"));
  const inputs: string[] = [];
  try {
    for (let i = 0; i < clipUrls.length; i++) {
      assertHttpsUrl(clipUrls[i]!);
      const res = await fetch(clipUrls[i]!, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`WAN clip ${i + 1} download failed: HTTP ${res.status}`);
      const path = nodePath.join(workDir, `part${i}.mp4`);
      nodeFs.writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      inputs.push(path);
    }

    // Each segment is generated with ~1.5 s of headroom after the last word.
    // Trim that trailing silence so the shots cut on the beat like an edited
    // reel instead of pausing between every shot.
    const keepSeconds = await Promise.all(inputs.map((p) => speechEndSeconds(p)));

    const W = WAN3_OUTPUT_WIDTH;
    const H = WAN3_OUTPUT_HEIGHT;
    const filters = inputs.map((_, i) => {
      const keep = keepSeconds[i];
      const vTrim = keep ? `trim=0:${keep.toFixed(3)},setpts=PTS-STARTPTS,` : "";
      const aTrim = keep ? `atrim=0:${keep.toFixed(3)},asetpts=PTS-STARTPTS,` : "";
      return (
        `[${i}:v]${vTrim}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];` +
        `[${i}:a]${aTrim}aresample=44100,aformat=channel_layouts=stereo[a${i}]`
      );
    });
    const concatInputs = inputs.map((_, i) => `[v${i}][a${i}]`).join("");
    const filterComplex = `${filters.join(";")};${concatInputs}concat=n=${inputs.length}:v=1:a=1[v][a]`;

    // Render inside the work dir, then move into place so a reader never sees
    // a half-written file at `outPath`.
    const tmpOut = nodePath.join(workDir, "joined.mp4");
    await execFileAsync("ffmpeg", [
      "-y",
      ...inputs.flatMap((p) => ["-i", p]),
      "-filter_complex", filterComplex,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      tmpOut,
    ], { maxBuffer: 10 * 1024 * 1024 });
    nodeFs.renameSync(tmpOut, outPath);
  } finally {
    nodeFs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Keep this much audio after the last spoken word when trimming a segment. */
const WAN3_TAIL_KEEP_SECONDS = 0.3;
/**
 * Never trim more than this from a segment: it is the headroom
 * wan3DurationForText adds (+1.5 s, plus up to 1 s of rounding). Anything
 * beyond it may be real dialogue, so it is always kept.
 */
const WAN3_MAX_TRIM_SECONDS = 2.5;
/**
 * Only true digital silence counts: WAN pads with near-zero audio, while a
 * softly spoken closing phrase stays well above -50 dB. A -35 dB threshold
 * could mistake quiet final words for silence and cut them.
 */
const WAN3_SILENCE_FILTER = "silencedetect=noise=-50dB:d=0.6";

/**
 * Length (s) to keep from a clip so it ends WAN3_TAIL_KEEP_SECONDS after the
 * last speech, or null to keep the whole clip.
 */
export async function speechEndSeconds(path: string): Promise<number | null> {
  let stderr = "";
  try {
    // -vn: analyse the audio only (no video decoding). Stats stay on so the
    // final "time=" reports the AUDIO stream's real end, which can be shorter
    // than the container duration.
    ({ stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", path, "-vn", "-af", WAN3_SILENCE_FILTER, "-f", "null", "-"],
      { maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch {
    return null; // detection is an optimisation only
  }
  return trailingSilenceCut(stderr, WAN3_TAIL_KEEP_SECONDS);
}

function parseClock(h: string, m: string, sec: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
}

/**
 * Parse FFmpeg silencedetect output → cut point, or null. Pure.
 * The audio end is the last progress "time=" (audio-only run), falling back to
 * the container "Duration:".
 */
export function trailingSilenceCut(
  ffmpegStderr: string,
  tailKeep: number,
  maxTrim = WAN3_MAX_TRIM_SECONDS,
): number | null {
  const times = [...ffmpegStderr.matchAll(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const lastTime = times[times.length - 1];
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegStderr);
  const audioEnd = lastTime
    ? parseClock(lastTime[1]!, lastTime[2]!, lastTime[3]!)
    : durationMatch
      ? parseClock(durationMatch[1]!, durationMatch[2]!, durationMatch[3]!)
      : null;
  if (audioEnd === null || audioEnd <= 0) return null;

  const events = [...ffmpegStderr.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)];
  const last = events[events.length - 1];
  // Trailing silence = the last event is a start with no matching end, or an
  // end that reaches the end of the audio.
  let silenceStart: number | null = null;
  if (last?.[1] === "start") {
    silenceStart = Number(last[2]);
  } else if (last?.[1] === "end" && Math.abs(Number(last[2]) - audioEnd) < 0.15) {
    const prevStart = events[events.length - 2];
    if (prevStart?.[1] === "start") silenceStart = Number(prevStart[2]);
  }
  if (silenceStart === null) return null;

  // Keep a short tail, never trim more than the generation headroom, never
  // trim to (almost) nothing, and ignore negligible savings. The cut is
  // measured against the audio end; the video is cut at the same point.
  const keep = Math.max(Math.max(0, silenceStart) + tailKeep, audioEnd - maxTrim);
  if (keep < 1 || audioEnd - keep < 0.2) return null;
  return keep;
}

/** Provider media (WaveSpeed CDN, signed storage URLs) is always HTTPS. */
function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid media URL");
  }
  if (parsed.protocol !== "https:") throw new Error(`Refusing non-HTTPS media URL (${parsed.protocol})`);
}
