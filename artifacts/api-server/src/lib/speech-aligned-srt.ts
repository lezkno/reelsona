/**
 * Speech-aligned SRT for transcripts that come back WITHOUT timestamps.
 *
 * The Replit proxy only accepts response_format:"json" for
 * gpt-4o-mini-transcribe, which returns plain text. Spreading that text evenly
 * over the whole video (generateBasicSRT) drifts on every pause, slow passage
 * or leading silence — and WAN 3.0 / active performances pause a lot.
 *
 * Instead we measure where speech actually is (FFmpeg silencedetect on the
 * final MP4 audio) and lay the words only over those speech intervals:
 *   • pauses get no caption and the next phrase starts when the voice resumes;
 *   • a caption block never spans a pause;
 *   • inside a speech interval words are timed by approximate syllable count,
 *     which tracks Spanish speaking time far better than characters.
 *
 * Pure except detectSpeechIntervals (FFmpeg).
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SpeechInterval {
  startMs: number;
  endMs: number;
}

/** Max words per caption block (matches generateBasicSRT). */
const WORDS_PER_BLOCK = 5;
/** How far (in words) a split between speech intervals may move to land on punctuation. */
const PUNCTUATION_SNAP_WORDS = 3;
/** Speech blips shorter than this are noise, not words. */
const MIN_INTERVAL_MS = 80;

// ── Speech detection ───────────────────────────────────────────────────────────

/**
 * Speech intervals of an audio/video file, from FFmpeg silencedetect.
 * Returns null when detection fails (callers fall back to even spreading).
 */
export async function detectSpeechIntervals(
  path: string,
  durationMs: number,
): Promise<SpeechInterval[] | null> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-i", path, "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return speechIntervalsFromSilencedetect(stderr, durationMs);
  } catch {
    return null;
  }
}

/** Parse silencedetect output into the complementary speech intervals. */
export function speechIntervalsFromSilencedetect(stderr: string, durationMs: number): SpeechInterval[] {
  const silences: SpeechInterval[] = [];
  let openStart: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)) {
    const ms = Math.max(0, Math.round(Number(m[2]) * 1000));
    if (m[1] === "start") {
      openStart = ms;
    } else if (openStart !== null) {
      silences.push({ startMs: openStart, endMs: ms });
      openStart = null;
    }
  }
  if (openStart !== null) silences.push({ startMs: openStart, endMs: durationMs });

  const speech: SpeechInterval[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.startMs > cursor) speech.push({ startMs: cursor, endMs: Math.min(s.startMs, durationMs) });
    cursor = Math.max(cursor, s.endMs);
  }
  if (cursor < durationMs) speech.push({ startMs: cursor, endMs: durationMs });
  return speech.filter((iv) => iv.endMs - iv.startMs >= MIN_INTERVAL_MS);
}

// ── Alignment ──────────────────────────────────────────────────────────────────

/** Approximate syllables: vowel groups (Spanish/English/Portuguese), min 1. Digits count per digit. */
export function syllableWeight(word: string): number {
  const clean = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (!clean) return 0.5;
  const vowelGroups = clean.match(/[aeiouáéíóúüàèìòùâêîôûãõy]+/g)?.length ?? 0;
  const digits = clean.match(/\d/g)?.length ?? 0;
  return Math.max(1, vowelGroups + digits);
}

export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
  interval: number;
}

/**
 * Time every word of `words` over the detected speech intervals (pauses get
 * no words). Returns null when there is nothing to align.
 */
export function alignWordsToSpeech(
  words: string[],
  intervals: SpeechInterval[],
): TimedWord[] | null {
  const usable = intervals.filter((iv) => iv.endMs > iv.startMs);
  if (words.length === 0 || usable.length === 0) return null;

  const weights = words.map(syllableWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const speechMs = usable.reduce((a, iv) => a + (iv.endMs - iv.startMs), 0);

  // 1. Split the words between speech intervals proportionally to speaking
  //    time, then snap each split to a nearby punctuation mark: people pause
  //    at "." "," "?" — so the word after a period belongs after the pause.
  const splits: number[] = []; // splits[k] = number of words in intervals 0..k
  let acc = 0;
  for (let k = 0; k < usable.length - 1; k++) {
    acc += usable[k]!.endMs - usable[k]!.startMs;
    const targetWeight = (acc / speechMs) * totalWeight;
    let ideal = 0;
    let cum = 0;
    while (ideal < words.length && cum + weights[ideal]! / 2 <= targetWeight) {
      cum += weights[ideal]!;
      ideal++;
    }
    const prev = splits[k - 1] ?? 0;
    let best = ideal;
    let bestDistance = Infinity;
    for (let j = ideal - PUNCTUATION_SNAP_WORDS; j <= ideal + PUNCTUATION_SNAP_WORDS; j++) {
      if (j <= prev || j >= words.length) continue;
      if (!/[.,;:!?…]["»”)]*$/.test(words[j - 1]!)) continue;
      const d = Math.abs(j - ideal);
      if (d < bestDistance) {
        best = j;
        bestDistance = d;
      }
    }
    splits.push(Math.min(words.length, Math.max(prev, best)));
  }
  splits.push(words.length);

  const intervalOfWord: number[] = [];
  for (let k = 0, i = 0; k < usable.length; k++) {
    for (; i < splits[k]!; i++) intervalOfWord.push(k);
  }

  // 2. Inside each interval, time its words by syllable weight.
  const timed: TimedWord[] = [];
  for (let k = 0; k < usable.length; k++) {
    const idx = intervalOfWord.flatMap((iv, i) => (iv === k ? [i] : []));
    if (idx.length === 0) continue;
    const iv = usable[k]!;
    const w = idx.reduce((a, i) => a + weights[i]!, 0);
    let t = iv.startMs;
    for (const i of idx) {
      const dur = ((iv.endMs - iv.startMs) * weights[i]!) / w;
      timed.push({ text: words[i]!, startMs: Math.round(t), endMs: Math.round(t + dur), interval: k });
      t += dur;
    }
  }
  return timed;
}

/**
 * Place transcript words over the detected speech intervals and group them
 * into caption blocks (≤5 words, never spanning a pause).
 * Returns null when there is nothing to align.
 */
export function alignTranscriptToSpeech(
  transcript: string,
  intervals: SpeechInterval[],
): Array<{ text: string; startMs: number; endMs: number }> | null {
  const timed = alignWordsToSpeech(transcript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean), intervals);
  if (!timed) return null;

  // 3. Group into blocks of ≤5 words that never cross a pause.
  const blocks: Array<{ text: string; startMs: number; endMs: number }> = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    blocks.push({
      text: current.map((w) => w.text).join(" "),
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
    });
    current = [];
  };
  for (const w of timed) {
    if (current.length > 0 && (current.length >= WORDS_PER_BLOCK || w.interval !== current[0]!.interval)) flush();
    current.push(w);
  }
  flush();
  return blocks.filter((b) => b.endMs > b.startMs);
}


/**
 * Time range in the audio where each text segment is spoken (segments are
 * consecutive pieces of the same text the audio says). Null if not alignable.
 */
export function segmentTimeRanges(
  segments: string[],
  intervals: SpeechInterval[],
): Array<{ startMs: number; endMs: number }> | null {
  const perSegment = segments.map((seg) => seg.replace(/\s+/g, " ").trim().split(" ").filter(Boolean));
  const timed = alignWordsToSpeech(perSegment.flat(), intervals);
  if (!timed) return null;
  const ranges: Array<{ startMs: number; endMs: number }> = [];
  let index = 0;
  for (const words of perSegment) {
    if (words.length === 0) return null;
    const first = timed[index]!;
    const last = timed[index + words.length - 1]!;
    ranges.push({ startMs: first.startMs, endMs: last.endMs });
    index += words.length;
  }
  return ranges;
}

/** Media duration in ms from FFmpeg's "Duration:" line, or null. */
export async function probeDurationMs(path: string): Promise<number | null> {
  let stderr = "";
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-i", path], { maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    // `ffmpeg -i` with no output always exits non-zero; the header is in stderr.
    stderr = String((err as { stderr?: string }).stderr ?? "");
  }
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

function formatSrtTime(milliseconds: number): string {
  const safeMs = Math.max(0, Math.round(milliseconds));
  const h = Math.floor(safeMs / 3_600_000);
  const m = Math.floor((safeMs % 3_600_000) / 60_000);
  const s = Math.floor((safeMs % 60_000) / 1_000);
  const ms = safeMs % 1_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** Speech-aligned phrase SRT, or null if alignment is impossible. */
export function speechAlignedSrt(transcript: string, intervals: SpeechInterval[]): string | null {
  const blocks = alignTranscriptToSpeech(transcript, intervals);
  if (!blocks || blocks.length === 0) return null;
  return blocks
    .map((b, i) => `${i + 1}\n${formatSrtTime(b.startMs)} --> ${formatSrtTime(b.endMs)}\n${b.text}`)
    .join("\n\n");
}
