/**
 * CaptionTemplate — the single source of truth for all visual properties of a
 * browser-rendered caption style. All size/offset values use 1920px video height
 * as the reference frame. Scale proportionally to any preview or render target.
 *
 * Forward-compatible with word-level timestamps: CaptionCue.words can carry
 * per-word startMs/endMs for future karaoke-style rendering.
 */

export type HighlightMode = "color" | "scale" | "both" | "none" | "mixed";
export type CaptionAnimation = "none" | "fade" | "zoom";
export type BackgroundMode = "none" | "word" | "active_word" | "line";
export type TextAlign = "left" | "center" | "right";

export interface CaptionTemplate {
  // ── Identity ────────────────────────────────────────────────────────────
  id: string;
  name: string;
  description: string;

  // ── Typography (all values at 1920px video height reference) ─────────────
  fontFamily: string;          // bundled font: "Oswald" | "Poppins" | "Bangers" | "Montserrat"
  fontSize: number;            // px at 1920px height reference
  fontWeight: 400 | 700 | 800 | 900;
  uppercase: boolean;
  letterSpacing: number;       // em multiplier (e.g. 0.04 = 4% of font-size)
  lineHeight: number;          // line-height multiplier

  // ── Layout & Position ────────────────────────────────────────────────────
  wordsPerLine: number;        // words shown simultaneously per block
  stackWords?: boolean;        // true = each word on its own line (vertical stack)
  yPercent: number;            // 0–100 from top of video (text baseline anchor)
  marginXPercent: number;      // horizontal safe-area padding as % of video width
  textAlign: TextAlign;

  // ── Colors ───────────────────────────────────────────────────────────────
  primaryColor: string;        // inactive-word color (#rrggbb)
  activeWordColor: string;     // active/highlighted word color
  inactiveOpacity: number;     // 0.0–1.0 — opacity of non-active words

  // ── Outline / Stroke ─────────────────────────────────────────────────────
  outlineColor: string;        // #rrggbb
  outlineWidth: number;        // px at 1920 reference — canvas: lineWidth×2 → outward only

  // ── Drop Shadow ──────────────────────────────────────────────────────────
  shadowColor: string;         // rgba() or hex
  shadowOffsetX: number;       // px at 1920 reference
  shadowOffsetY: number;       // px at 1920 reference
  shadowBlur: number;          // px at 1920 reference

  // ── Word Background Box ──────────────────────────────────────────────────
  backgroundMode: BackgroundMode;   // "none" | "word" | "line"
  backgroundColor: string | null;   // null = no box
  backgroundPaddingX: number;       // px at 1920 reference
  backgroundPaddingY: number;
  backgroundRadius: number;         // border-radius px

  // ── Highlight Behavior ───────────────────────────────────────────────────
  highlightMode: HighlightMode;
  activeWordScale: number;     // 1.0 = no scale; >1.0 = active word is larger

  // ── Animation ────────────────────────────────────────────────────────────
  animation: CaptionAnimation;
  animationDuration: number;   // ms — duration of transition
}

// ── Caption Data Model ────────────────────────────────────────────────────────

/**
 * A single word in a caption cue.
 * Phase 1: text only. Phase 2: per-word startMs/endMs from AI transcription.
 */
export interface CaptionWord {
  text: string;
  startMs?: number;   // word-level start time (future)
  endMs?: number;     // word-level end time (future)
}

/**
 * A single display unit — what the renderer shows for one time window.
 * Contains all words visible in this frame plus which word is "active".
 */
export interface CaptionCue {
  index: number;           // sequential word index in the full script
  startMs: number;         // when to begin showing this cue
  endMs: number;           // when to hide this cue
  words: CaptionWord[];    // the word block shown (1..wordsPerLine)
  activeWordIndex: number; // which word in `words` is currently highlighted
}

/**
 * Flat word timing — one entry per SRT block or per word from AI transcription.
 */
export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}
