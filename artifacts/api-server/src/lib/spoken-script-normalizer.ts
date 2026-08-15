/**
 * Spoken Script Normalizer
 *
 * PURPOSE
 * -------
 * Converts AI-generated script text into clean spoken audio copy suitable
 * for TTS / avatar synthesis (MiniMax, WaveSpeed, HeyGen).
 *
 * The generator prompt already instructs the model to avoid many issues, but
 * there is no sanitization layer between the generated text and the speech API.
 * This module is that layer.
 *
 * SCOPE
 * -----
 * Pure functions — no I/O, no DB, no network. Safe to call in any context.
 * Currently wired into the WaveSpeed / Voice Director pipeline only.
 * HeyGen and generateVideo are NOT affected in this phase.
 *
 * RULES (applied in this order)
 * -----
 *  1. URLs            → "enlace"
 *  2. Hashtags        → remove
 *  3. @handles        → remove
 *  4. Acronyms/abbr   → expand to spoken Spanish
 *  5. Currency        → "N dólares" / "N euros"
 *  6. Percentages     → "N por ciento"
 *  7. Emojis          → remove (Extended_Pictographic + variation selectors)
 *  8. Markdown        → strip formatting, keep text
 *  9. Bullets/lists   → remove markers, keep text as prose
 * 10. Punct → pauses  → em-dash/en-dash/ellipsis/semicolon → natural stops
 * 11. Colon cleanup   → convert non-time/non-ratio colons to ", "
 * 12. Artifact cleanup→ fix ", ." / ". ." / etc.
 * 13. Whitespace      → collapse newlines and repeated spaces
 */

// ── Main normalizer ────────────────────────────────────────────────────────────

/**
 * Convert a raw generated script into clean spoken text ready for TTS.
 *
 * @param script - Raw text as returned by the script generator (or user input)
 * @returns Cleaned spoken script — no emojis, markdown, symbols, or TTS-hostile chars
 */
export function normalizeToSpokenScript(script: string): string {
  let t = script;

  // ── 1. URLs → "enlace" ────────────────────────────────────────────────────
  t = t.replace(/https?:\/\/[^\s]+/g, "enlace");
  t = t.replace(/www\.[^\s]+/g, "enlace");

  // ── 2. Hashtags → remove ──────────────────────────────────────────────────
  // \S+ matches all non-whitespace so accented chars (é, ó, ñ…) are included
  t = t.replace(/#\S+/g, "");

  // ── 3. @handles → remove ──────────────────────────────────────────────────
  t = t.replace(/@\S+/g, "");

  // ── 4. Acronym / abbreviation expansion ───────────────────────────────────
  // Match whole words only. Case-sensitive for common all-caps acronyms.
  t = t.replace(/\b24\/7\b/g, "veinticuatro horas al día siete días a la semana");
  t = t.replace(/\bIA\b/g,    "inteligencia artificial");
  t = t.replace(/\bAI\b/g,    "inteligencia artificial");
  t = t.replace(/\bROI\b/g,   "retorno de inversión");
  t = t.replace(/\bKPIs?\b/gi, "indicadores clave");
  t = t.replace(/\bCEO\b/g,   "director ejecutivo");
  t = t.replace(/\bCOO\b/g,   "director de operaciones");
  t = t.replace(/\bCFO\b/g,   "director financiero");
  t = t.replace(/\bCTO\b/g,   "director de tecnología");
  t = t.replace(/\bSEO\b/g,   "posicionamiento en buscadores");
  t = t.replace(/\bCRM\b/g,   "sistema de gestión de clientes");
  t = t.replace(/\bB2B\b/g,   "empresa a empresa");
  t = t.replace(/\bB2C\b/g,   "empresa a consumidor");
  t = t.replace(/\bUSA?\b/g,  "Estados Unidos");

  // ── 5. Currency ───────────────────────────────────────────────────────────
  // "$1,234" and "$1,234.56" → "1234 dólares"  (strip commas, drop decimals)
  t = t.replace(/\$\s*([\d,]+)(?:\.\d+)?/g, (_, n) => `${n.replace(/,/g, "")} dólares`);
  t = t.replace(/€\s*([\d,]+)(?:\.\d+)?/g,  (_, n) => `${n.replace(/,/g, "")} euros`);

  // ── 6. Percentages ────────────────────────────────────────────────────────
  // "50%" → "50 por ciento"   "4,5%" → "4,5 por ciento"
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%/g, "$1 por ciento");

  // ── 7. Remove emojis ──────────────────────────────────────────────────────
  // \p{Extended_Pictographic} covers all emoji Unicode ranges reliably in V8.
  // The second regex removes variation selectors and zero-width joiners left behind.
  t = t.replace(/\p{Extended_Pictographic}/gu, "");
  t = t.replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "");

  // ── 8. Strip markdown formatting (keep inner text) ────────────────────────
  t = t.replace(/\*\*(.+?)\*\*/gs, "$1");   // **bold**
  t = t.replace(/\*(.+?)\*/gs,     "$1");   // *italic*
  t = t.replace(/__(.+?)__/gs,     "$1");   // __bold__
  t = t.replace(/_(.+?)_/gs,       "$1");   // _italic_
  t = t.replace(/~~(.+?)~~/gs,     "$1");   // ~~strikethrough~~
  t = t.replace(/`([^`]+)`/g,      "$1");   // `code`
  t = t.replace(/^#{1,6}\s+/gm,    "");     // # Heading

  // ── 9. Remove bullet / numbered list markers (keep text) ──────────────────
  t = t.replace(/^\s*[-*•]\s+/gm,    "");  // "- item", "* item", "• item"
  t = t.replace(/^\s*\d+[.)]\s+/gm,  "");  // "1. item", "1) item"

  // ── 10. Punctuation → natural spoken pauses ───────────────────────────────
  t = t.replace(/[—–]/g,         ", ");   // em / en dash → comma pause
  t = t.replace(/\.{3,}|…/g,    ". ");   // ellipsis → period
  t = t.replace(/;/g,            ". ");   // semicolon → period
  // Colon: replace only when NOT between two digit sequences (time, ratio)
  t = t.replace(/(?<!\d):(?!\d)/g, ", ");

  // ── 11. Clean punctuation artifacts ──────────────────────────────────────
  t = t.replace(/,\s*\./g,  ".");  // ", ." → "."
  t = t.replace(/\.\s*,/g,  ".");  // ". ," → "."
  t = t.replace(/,\s*,/g,   ",");  // ",," → ","
  t = t.replace(/\.\s*\./g, ".");  // ". ." → "."

  // ── 12. Collapse whitespace ───────────────────────────────────────────────
  t = t.replace(/\r?\n/g,  " ");   // newlines → space
  t = t.replace(/\s{2,}/g, " ");   // multiple spaces → single
  t = t.trim();

  return t;
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Scan a script for known TTS-hostile patterns.
 * Returns an array of issue labels — empty means the script is clean.
 *
 * Use this BEFORE normalizing to report what was present in the original,
 * or AFTER normalizing to verify the normalizer did its job.
 */
export function validateSpokenScript(script: string): string[] {
  const issues: string[] = [];
  if (/#\w/.test(script))                         issues.push("hashtag");
  if (/@\w/.test(script))                         issues.push("@handle");
  if (/\p{Extended_Pictographic}/u.test(script))  issues.push("emoji");
  if (/https?:\/\//.test(script))                 issues.push("URL");
  if (/\*\*|__|~~/.test(script))                  issues.push("markdown");
  if (/`/.test(script))                           issues.push("backtick");
  if (/^\s*[-*•]\s/m.test(script))               issues.push("bullet-list");
  if (/^\s*\d+[.)]\s/m.test(script))             issues.push("numbered-list");
  return issues;
}

// ── Convenience wrapper ────────────────────────────────────────────────────────

export interface NormalizeResult {
  /** Cleaned spoken script — send this to TTS */
  spokenScript: string;
  /** Issues found in the original (for debug / logging) */
  issues: string[];
  /** True when the original needed no changes */
  wasClean: boolean;
}

/**
 * Normalize and validate in one call.
 * Returns both the clean script and a diff-able audit trail.
 */
export function prepareForTts(rawScript: string): NormalizeResult {
  const issues     = validateSpokenScript(rawScript);
  const spokenScript = normalizeToSpokenScript(rawScript);
  return {
    spokenScript,
    issues,
    wasClean: issues.length === 0 && rawScript.trim() === spokenScript,
  };
}
