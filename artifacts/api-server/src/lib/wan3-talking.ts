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
import { execFile } from "child_process";
import { promisify } from "util";
import { submitJob, WAVESPEED_MODELS } from "./wavespeed";

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

/**
 * Build the WAN 3.0 prompt for one segment.
 * Dialogue goes in its own "spoken once" block: without it WAN repeats phrases
 * after a camera or gesture transition. Camera stays calm — aggressive moves
 * compete with phoneme-level lip sync.
 */
export function buildWan3Prompt(opts: {
  dialogue: string;
  language?: string | null;
  topic?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
}): string {
  const language = wan3LanguageLabel(opts.language);
  const isSpanish = language.toLowerCase().includes("spanish");
  const dialogue = opts.dialogue.replace(/"/g, "'").trim();
  const segmentCount = opts.segmentCount ?? 1;
  const segmentIndex = opts.segmentIndex ?? 0;

  const lines = [
    "IMAGE 1 is the START FRAME and the authoritative identity anchor. Preserve its scene, composition, " +
      "camera framing, outfit, lighting, background and initial pose, and keep the exact same face, facial " +
      "structure, eyes, nose, mouth, skin tone, hair and recognizable likeness stable from the first frame to " +
      "the last frame. Do not invent or replace the face. Use the audio reference as the target person's voice " +
      `identity, timbre, ${isSpanish ? "accent, " : ""}and natural speaking style. Generate clear ${language} ` +
      "speech with accurate lip synchronization, natural blinking, subtle head movement, and realistic gestures.",
    "The person in IMAGE 1 is the only person in the scene and the only person who speaks.",
    `The person speaks naturally to the camera in ${language}, with clear pronunciation, believable ` +
      "phoneme-level lip synchronization, natural pauses, and an engaging warm tone, like a real content " +
      "creator talking to their audience.",
    "Prioritize lip synchronization over cinematic movement. Keep the mouth clearly visible whenever the person speaks.",
    opts.topic ? `The video is about: ${opts.topic.replace(/\s+/g, " ").trim().slice(0, 200)}.` : "",
    segmentCount > 1
      ? `This is part ${segmentIndex + 1} of ${segmentCount} of one continuous video: start and end in the same ` +
        "pose, framing and location as IMAGE 1 so the parts join seamlessly."
      : "",
    "CAMERA — one continuous take, no cuts: stable framing with at most a slow, subtle push-in during the " +
      "core message. Never jump-cut, teleport, switch angle, crop the mouth, zoom abruptly or interrupt the speech. " +
      "Allow natural blinking, subtle head movement and one or two restrained hand gestures after natural phrase breaks.",
    "AUDIO LOCK — Speak the following dialogue exactly once from beginning to end, in order. Never repeat, " +
      "restart, paraphrase, summarize, or add any word after a camera or gesture transition. Keep the same " +
      "uninterrupted audio performance. After the last word, stay silent with a natural closed-mouth expression.",
    `EXACT DIALOGUE — spoken once, in order, without adding or repeating words: "${dialogue}"`,
    "CONTINUITY RULES — Same person, exact face, body, outfit, location, background and lighting throughout. " +
      "Camera motion must be smooth and physically plausible. No abrupt cuts, location changes, second speaker, " +
      "background music, subtitles, text, captions, logos, duplicated limbs, or extra people. " +
      "Cinematic vertical 9:16 composition.",
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
  segments: string[];
  language?: string | null;
  topic?: string | null;
  apiKey?: string;
  onAccepted?: (requestId: string, segmentIndex: number, payload: Record<string, unknown>) => Promise<void>;
}): Promise<{ requestIds: string[]; resolution: string; error: Error | null }> {
  const requestIds: string[] = [];
  let resolution = getWan3Resolution();
  for (let i = 0; i < opts.segments.length; i++) {
    const payload = buildWan3Payload({
      imageUrl: opts.imageUrl,
      voiceReferenceUrl: opts.voiceReferenceUrl,
      dialogue: opts.segments[i]!,
      language: opts.language,
      topic: opts.topic,
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

/** Write the first `seconds` of an audio URL or local file to a local MP3 (voice reference clip). */
export async function trimAudioToFile(audioSource: string, outPath: string, seconds = WAN3_VOICE_REFERENCE_SECONDS): Promise<void> {
  const isRemote = /^https?:\/\//i.test(audioSource);
  const inPath = isRemote ? `${outPath}.src` : audioSource;
  if (isRemote) {
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
  const inputs: string[] = [];
  try {
    for (let i = 0; i < clipUrls.length; i++) {
      const res = await fetch(clipUrls[i]!, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`WAN clip ${i + 1} download failed: HTTP ${res.status}`);
      const path = `${outPath}.part${i}.mp4`;
      nodeFs.writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      inputs.push(path);
    }

    const W = WAN3_OUTPUT_WIDTH;
    const H = WAN3_OUTPUT_HEIGHT;
    const filters = inputs.map((_, i) =>
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];` +
      `[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`,
    );
    const concatInputs = inputs.map((_, i) => `[v${i}][a${i}]`).join("");
    const filterComplex = `${filters.join(";")};${concatInputs}concat=n=${inputs.length}:v=1:a=1[v][a]`;

    await execFileAsync("ffmpeg", [
      "-y",
      ...inputs.flatMap((p) => ["-i", p]),
      "-filter_complex", filterComplex,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      outPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } finally {
    for (const p of inputs) nodeFs.rmSync(p, { force: true });
  }
}
