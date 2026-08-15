/**
 * WaveSpeed / MiniMax Voice Director — script segmentation engine
 *
 * PURPOSE
 * -------
 * Transform a flat script into structured segments, each carrying:
 *   • classified intent  (hook / problem / explanation / solution / cta)
 *   • MiniMax TTS params (speed, pitch, emotionHint, languageBoost)
 *   • trailing pause duration for natural delivery
 *
 * SCOPE
 * -----
 * This module is exclusively for the WaveSpeed/MiniMax audio pipeline.
 * It MUST NOT import from, reference, or affect any HeyGen-related code.
 * HeyGen voice generation, SSML, resolveVoiceId, and generateVideo remain
 * completely unchanged and isolated.
 *
 * All functions are pure (no I/O, no DB, no network) and safe to unit-test.
 */

import {
  type VoiceDirectorPresetId,
  type VoiceDirectorPreset,
  VOICE_DIRECTOR_PRESETS,
} from "./wavespeed.js";

// ── Segment intents ────────────────────────────────────────────────────────────

export const SEGMENT_INTENTS = [
  "hook",
  "problem",
  "explanation",
  "solution",
  "cta",
] as const;

export type SegmentIntent = (typeof SEGMENT_INTENTS)[number];

// ── Segment params ─────────────────────────────────────────────────────────────

export interface WavespeedSegmentParams {
  /** MiniMax speech speed multiplier. Range: 0.5–1.5 */
  speed: number;
  /** Pitch shift in semitones. Range: -12 to +12 */
  pitch: number;
  /** Style/emotion hint — drives future prompt-based SSML or voice style tokens */
  emotionHint: string;
  /** Always "Spanish" for this pipeline */
  languageBoost: "Spanish";
}

// ── Segment ────────────────────────────────────────────────────────────────────

export interface WavespeedVoiceSegment {
  /** Sentence text (no pause tokens embedded) */
  text: string;
  /** Classified intent of this segment */
  intent: SegmentIntent;
  /**
   * Duration of silence inserted AFTER this segment before the next one.
   * 0 = no explicit pause token.
   * Values map to MiniMax pause syntax: <#N#>
   */
  pauseAfter: number;
  /** Resolved TTS parameters for this segment */
  params: WavespeedSegmentParams;
}

// ── Analysis result ────────────────────────────────────────────────────────────

export interface WavespeedVoiceDirectorAnalysis {
  /** The base preset used for parameter resolution */
  preset: VoiceDirectorPreset;
  /** Ordered list of segments */
  segments: WavespeedVoiceSegment[];
  /**
   * Flat TTS-ready string with MiniMax pause tokens (<#N#>) inserted.
   * Feed this directly to submitSpeech() when the pipeline is activated.
   */
  ttsScript: string;
  /** Count of segments per intent */
  summary: Record<SegmentIntent, number>;
}

// ── Intent keywords ────────────────────────────────────────────────────────────
// Ordered by specificity — more specific phrases should come first.

const INTENT_KEYWORDS: Record<SegmentIntent, string[]> = {
  hook: [
    "¿sabías", "¿te has preguntado", "¿qué pasaría", "¿imaginas",
    "imagina que", "hola,", "bienvenid", "hoy quiero", "hoy vamos",
    "algo que", "déjame contarte", "lo que nadie te dice",
  ],
  problem: [
    "el problema", "la dificultad", "lo que cuesta", "lo que frena",
    "muchos no pueden", "no es fácil", "es difícil", "sin embargo",
    "lamentablemente", "el obstáculo", "el desafío", "la mayoría falla",
    "el error", "el miedo", "la frustración", "te has sentido",
  ],
  solution: [
    "la solución", "lo que necesitas", "la clave es", "la respuesta es",
    "lo que cambia todo", "descubrí que", "aprendí que", "funciona porque",
    "por eso existe", "así es como", "lo que realmente", "el secreto",
  ],
  cta: [
    "inscríbete", "regístrate", "descarga", "sígueme", "entra ahora",
    "accede", "haz click", "únete", "suscríbete", "comenta abajo",
    "visita el link", "empieza hoy", "comienza ahora", "da el paso",
    "toma acción", "no lo dejes", "aprovecha", "reserva tu lugar",
  ],
  explanation: [
    "porque", "esto significa", "en otras palabras", "es decir",
    "lo que esto quiere decir", "cuando entiendes", "a lo largo",
    "cada vez que", "lo que pasa es", "en el fondo",
  ],
};

// ── Intent modulation (delta on top of base preset) ───────────────────────────
// Applied per-intent to add emotional texture without overriding the preset entirely.

const INTENT_MODULATION: Record<
  SegmentIntent,
  { speedDelta: number; pitchDelta: number; emotionHint: string }
> = {
  hook:        { speedDelta: 0.0,   pitchDelta: 0,  emotionHint: "warm, inviting, curious" },
  problem:     { speedDelta: -0.05, pitchDelta: -1, emotionHint: "serious, empathetic, grounded" },
  explanation: { speedDelta: 0.0,   pitchDelta: 0,  emotionHint: "clear, calm, instructive" },
  solution:    { speedDelta: 0.05,  pitchDelta: 1,  emotionHint: "hopeful, revealing, confident" },
  cta:         { speedDelta: 0.1,   pitchDelta: 2,  emotionHint: "energetic, direct, motivating" },
};

// ── Pause durations after each intent (seconds) ───────────────────────────────

const PAUSE_AFTER_SEC: Record<SegmentIntent, number> = {
  hook:        0.4,   // dramatic beat after the opening hook
  problem:     0.3,   // weight before moving on
  explanation: 0.2,   // natural breath between ideas
  solution:    0.3,   // let the answer land
  cta:         0.0,   // no trailing pause — end clean
};

// ── MiniMax pause token ────────────────────────────────────────────────────────

/**
 * Formats a pause duration as a MiniMax TTS pause token.
 * Example: pauseToken(0.4) → "<#0.4#>"
 */
export function pauseToken(seconds: number): string {
  return `<#${seconds}#>`;
}

// ── Sentence splitting ─────────────────────────────────────────────────────────

/**
 * Splits a script into individual sentences.
 * Handles Spanish punctuation: `.`, `!`, `?`, `…`
 * Preserves the trailing punctuation in the sentence.
 */
export function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Intent classification ──────────────────────────────────────────────────────

/**
 * Classifies a single sentence's intent based on keyword matching and position.
 *
 * Scoring:
 *   - Each keyword match adds 2 points to the matching intent
 *   - First sentence gets +3 hook prior, +1 hook if near-first
 *   - Last sentence gets +3 cta prior, +1 cta if near-last
 *   - "explanation" always has a baseline of 1 (default fallback)
 */
export function classifyIntent(
  sentence: string,
  index: number,
  total: number,
): SegmentIntent {
  const lower = sentence.toLowerCase();

  const scores: Record<SegmentIntent, number> = {
    hook:        index === 0 ? 3 : index <= 1 ? 1 : 0,
    problem:     0,
    explanation: 1, // default fallback
    solution:    0,
    cta:         index === total - 1 ? 3 : index >= total - 2 ? 1 : 0,
  };

  for (const intent of SEGMENT_INTENTS) {
    for (const kw of INTENT_KEYWORDS[intent]) {
      if (lower.includes(kw)) {
        scores[intent] += 2;
      }
    }
  }

  // Return intent with highest score (stable: ties resolved by order of SEGMENT_INTENTS)
  let best: SegmentIntent = "explanation";
  let bestScore = -1;
  for (const intent of SEGMENT_INTENTS) {
    if (scores[intent] > bestScore) {
      bestScore = scores[intent];
      best = intent;
    }
  }
  return best;
}

// ── Parameter resolution ───────────────────────────────────────────────────────

/**
 * Resolves final WavespeedSegmentParams for a segment by combining:
 *   1. The base preset's speed/pitch
 *   2. The per-intent modulation deltas
 *   3. Clamping to valid ranges
 */
export function resolveSegmentParams(
  presetId: VoiceDirectorPresetId,
  intent: SegmentIntent,
): WavespeedSegmentParams {
  const preset = VOICE_DIRECTOR_PRESETS[presetId];
  const mod = INTENT_MODULATION[intent];

  const speed = Math.min(1.5, Math.max(0.5, preset.params.speed + mod.speedDelta));
  const pitch = Math.min(12,  Math.max(-12, preset.params.pitch + mod.pitchDelta));

  // Combine preset emotion hint with per-intent override for richer context
  const emotionHint = `${mod.emotionHint} / ${preset.params.emotionHint}`;

  return {
    speed: parseFloat(speed.toFixed(2)),
    pitch,
    emotionHint,
    languageBoost: "Spanish",
  };
}

// ── TTS script builder ─────────────────────────────────────────────────────────

/**
 * Flattens an array of voice segments into a single MiniMax-ready TTS string.
 * Pause tokens (<#N#>) are inserted between segments based on pauseAfter.
 * No trailing pause is added after the last segment.
 */
export function buildWavespeedTtsScript(segments: WavespeedVoiceSegment[]): string {
  return segments
    .map((seg, i) => {
      const isLast = i === segments.length - 1;
      if (isLast || seg.pauseAfter === 0) return seg.text;
      return `${seg.text} ${pauseToken(seg.pauseAfter)}`;
    })
    .join(" ");
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Analyzes a flat script and returns a structured Voice Director analysis
 * ready for WaveSpeed/MiniMax TTS synthesis.
 *
 * This is a pure function — no I/O, no network, no DB access.
 * It does NOT call WaveSpeed or spend any credits.
 *
 * @param script    The flat script text to analyze
 * @param presetId  Which Voice Director preset to use (natural | energetico | dramatico)
 */
export function analyzeScriptForWavespeed(
  script: string,
  presetId: VoiceDirectorPresetId,
): WavespeedVoiceDirectorAnalysis {
  const preset = VOICE_DIRECTOR_PRESETS[presetId];
  const sentences = splitIntoSentences(script);
  const total = sentences.length;

  if (total === 0) {
    return {
      preset,
      segments: [],
      ttsScript: "",
      summary: { hook: 0, problem: 0, explanation: 0, solution: 0, cta: 0 },
    };
  }

  const segments: WavespeedVoiceSegment[] = sentences.map((text, i) => {
    const intent = classifyIntent(text, i, total);
    return {
      text,
      intent,
      pauseAfter: PAUSE_AFTER_SEC[intent],
      params: resolveSegmentParams(presetId, intent),
    };
  });

  const summary = SEGMENT_INTENTS.reduce(
    (acc, intent) => ({ ...acc, [intent]: segments.filter((s) => s.intent === intent).length }),
    {} as Record<SegmentIntent, number>,
  );

  return {
    preset,
    segments,
    ttsScript: buildWavespeedTtsScript(segments),
    summary,
  };
}
