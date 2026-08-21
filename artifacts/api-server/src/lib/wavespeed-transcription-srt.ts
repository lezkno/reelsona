import { generateBasicSRT } from "./caption-engine";
import { parseSRT } from "./browser-caption-engine";

export type TranscriptionSrtSource = "provider_srt" | "word_timestamps" | "segment_timestamps" | "transcript";

export type TranscriptionSrtResult = {
  srt: string;
  source: TranscriptionSrtSource;
};

type TimedCue = {
  text: string;
  startMs: number;
  endMs: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getText(value: JsonRecord): string | null {
  for (const key of ["word", "text", "token"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function getMilliseconds(value: JsonRecord, millisecondsKey: string, secondsKey: string): number | null {
  const milliseconds = value[millisecondsKey];
  if (typeof milliseconds === "number" && Number.isFinite(milliseconds)) {
    return Math.round(milliseconds);
  }

  const seconds = value[secondsKey];
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return Math.round(seconds * 1_000);
  }
  return null;
}

function readTimedCues(value: unknown): TimedCue[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const text = getText(item);
    const startMs = getMilliseconds(item, "start_ms", "start");
    const endMs = getMilliseconds(item, "end_ms", "end");
    if (!text || startMs === null || endMs === null || startMs < 0 || endMs <= startMs) {
      return [];
    }
    return [{ text, startMs, endMs }];
  });
}

function formatSrtTime(milliseconds: number): string {
  const safeMs = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const ms = safeMs % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function cuesToSrt(cues: TimedCue[]): string {
  return cues
    .map((cue, index) =>
      `${index + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}`,
    )
    .join("\n\n");
}

function validSrt(value: string): string | null {
  const trimmed = value.trim();
  return parseSRT(trimmed).length > 0 ? trimmed : null;
}

/**
 * Converts OpenAI-compatible transcription responses into a valid SRT.
 *
 * The Replit proxy currently accepts response_format:"json" for
 * gpt-4o-mini-transcribe, not response_format:"srt". Future proxy responses
 * may include word or segment timestamps; preserve them exactly when present.
 * Plain JSON transcripts still become phrase SRTs tied to the final MP4 audio
 * duration, so caption processing receives a subtitle artifact instead of
 * falling through because the provider rejected an output format.
 */
export function transcriptionResponseToSrt(
  response: unknown,
  audioDurationMs: number,
): TranscriptionSrtResult | null {
  const normalized = typeof response === "string" ? parseJsonString(response) : response;

  if (typeof normalized === "string") {
    const srt = validSrt(normalized);
    if (srt) return { srt, source: "provider_srt" };
    if (audioDurationMs > 0 && normalized.trim()) {
      return { srt: generateBasicSRT(normalized, audioDurationMs), source: "transcript" };
    }
    return null;
  }

  if (!isRecord(normalized)) return null;

  const wordCues = readTimedCues(normalized.words);
  if (wordCues.length > 0) {
    return { srt: cuesToSrt(wordCues), source: "word_timestamps" };
  }

  const segmentCues = readTimedCues(normalized.segments);
  if (segmentCues.length > 0) {
    return { srt: cuesToSrt(segmentCues), source: "segment_timestamps" };
  }

  const transcript = getText(normalized);
  if (!transcript || audioDurationMs <= 0) return null;
  return { srt: generateBasicSRT(transcript, audioDurationMs), source: "transcript" };
}

/**
 * The scheduler writes a fixed 16 kHz mono PCM WAV. Read its data chunk so a
 * JSON-only transcription can be placed across the exact final-video audio
 * duration without adding another FFmpeg/ffprobe process.
 */
export function getWavDurationMs(wav: Buffer): number | null {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;

  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (dataStart + chunkSize > wav.length) break;

    if (chunkId === "fmt " && chunkSize >= 12) {
      byteRate = wav.readUInt32LE(dataStart + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataSize || byteRate <= 0) return null;
  return Math.round((dataSize / byteRate) * 1_000);
}