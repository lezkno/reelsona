/**
 * Live credit estimate for the "generate video" modal while the script is
 * being edited. Mirrors artifacts/api-server/src/lib/reel-pricing.ts (and the
 * WAN segmentation in wan3-talking.ts) — keep both in sync. The server is the
 * source of truth: it reserves the exact amount when the reel starts.
 */

const REEL_CREDITS_PER_30S = 50
const MIN_REEL_CREDITS = 15
const PREMIUM_CREDITS_PER_WAN_SECOND = 1.5
const MAX_WORDS_PER_SEGMENT = 36

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

function standardCredits(script: string): number {
  const seconds = Math.max(10, Math.ceil(countWords(script) / 2.5))
  return Math.max(MIN_REEL_CREDITS, Math.ceil((seconds * REEL_CREDITS_PER_30S) / 30))
}

/** Same packing as the server: sentences grouped into ≤36-word segments. */
function segmentWordCounts(script: string): number[] {
  const clean = script.replace(/\s+/g, " ").trim()
  if (!clean) return []
  const sentences = clean.split(/(?<=[.!?…]["»”)]?)\s+/).filter(Boolean)
  const segments: number[] = []
  let current = 0
  for (const sentence of sentences) {
    let words = countWords(sentence)
    while (words > 0) {
      const piece = Math.min(words, MAX_WORDS_PER_SEGMENT)
      if (current > 0 && current + piece > MAX_WORDS_PER_SEGMENT) {
        segments.push(current)
        current = 0
      }
      current += piece
      words -= piece
    }
  }
  if (current > 0) segments.push(current)
  return segments
}

function premiumCredits(script: string): number {
  const wanSeconds = segmentWordCounts(script).reduce(
    (sum, words) => sum + Math.min(30, Math.max(2, Math.ceil(words / 2.2 + 1.5))),
    0,
  )
  return Math.max(MIN_REEL_CREDITS, Math.ceil(wanSeconds * PREMIUM_CREDITS_PER_WAN_SECOND))
}

export function estimateReelCredits(script: string): { standard: number; premium: number } {
  return { standard: standardCredits(script), premium: premiumCredits(script) }
}
