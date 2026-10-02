/**
 * Reel pricing — how many credits a reel costs, by avatar quality.
 *
 *   standard (InfiniteTalk): 50 credits per 30 s of reel (min 15). Unchanged.
 *     WaveSpeed bills ~USD 0.0285/s at 480p → ~75 % gross margin on Basic.
 *
 *   premium (WAN 3.0, dynamic scenes): 1.5 credits per second requested from
 *     WAN, using the SAME segmentation the pipeline submits, so a reel with
 *     5 scenes pays for 5 scenes. WaveSpeed bills ~USD 0.0475/s at 480p →
 *     ~50 % gross margin on Basic/Pro, ~15 % on Founder.
 *
 * Pure (no DB): credits.ts and the routes import from here.
 */

import { splitScriptIntoWan3Segments, wan3DurationForText } from "./wan3-talking";

export type AvatarQuality = "standard" | "premium";

export const REEL_CREDITS_PER_30S = 50;
export const MIN_REEL_CREDITS = 15;
/** Credits charged per second requested from WAN 3.0 (premium). */
export const PREMIUM_CREDITS_PER_WAN_SECOND = 1.5;

export function isAvatarQuality(value: unknown): value is AvatarQuality {
  return value === "standard" || value === "premium";
}

/** Per-reel override wins; then the account default; then "standard". */
export function resolveAvatarQuality(
  itemQuality: string | null | undefined,
  accountQuality: string | null | undefined,
): AvatarQuality {
  if (isAvatarQuality(itemQuality)) return itemQuality;
  if (isAvatarQuality(accountQuality)) return accountQuality;
  return "standard";
}

export function estimateDurationFromScript(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(10, Math.ceil(words / 2.5));
}

export function computeReelCreditCost(durationSec: number): number {
  return Math.max(MIN_REEL_CREDITS, Math.ceil(durationSec * REEL_CREDITS_PER_30S / 30));
}

/** Seconds that will be requested from WAN 3.0 for this script (sum of all segments). */
export function premiumWanSeconds(script: string): number {
  return splitScriptIntoWan3Segments(script).reduce((sum, seg) => sum + wan3DurationForText(seg), 0);
}

/** Credits for a reel of `script` at the given quality. */
export function estimateReelCredits(script: string, quality: AvatarQuality): number {
  if (quality === "premium") {
    const seconds = premiumWanSeconds(script);
    return Math.max(MIN_REEL_CREDITS, Math.ceil(seconds * PREMIUM_CREDITS_PER_WAN_SECOND));
  }
  return computeReelCreditCost(estimateDurationFromScript(script));
}
