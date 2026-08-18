/**
 * getCanonicalOrigin — returns the public-facing origin of this application.
 *
 * Used exclusively to build persistent URLs stored in the database
 * (captioned videos, thumbnails, SRT subtitles, raw video assets).
 * These URLs must never contain the Replit dev domain because:
 *   - In production the dev domain resolves to the _development_ container,
 *     not the autoscale deployment that serves live traffic.
 *   - The dev domain is behind Replit's mTLS proxy and is therefore
 *     unreachable by external services such as Instagram's video ingestor.
 *
 * Resolution order:
 *   1. APP_URL env var  — validated as an absolute https:// (or http://) URL.
 *   2. Hard fallback    — "https://reelsona.com" (only when NOT in production).
 *
 * Production behaviour:
 *   - APP_URL missing   → throws immediately; server must not start in this state.
 *   - APP_URL invalid   → throws immediately with a descriptive message.
 *
 * Development/test behaviour:
 *   - APP_URL missing   → logs a one-time warning, returns "https://reelsona.com".
 *   - APP_URL invalid   → logs a one-time warning, returns "https://reelsona.com".
 */

let _warned = false;
const FALLBACK_ORIGIN = "https://reelsona.com";

export function getCanonicalOrigin(): string {
  const raw = process.env.APP_URL?.trim().replace(/\/+$/, "");

  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(`protocol must be https:// or http://, got "${parsed.protocol}"`);
      }
      // Return origin only (scheme + host + port) — no path or query string.
      return parsed.origin;
    } catch (err) {
      const msg =
        `[appOrigin] APP_URL "${raw}" is not a valid absolute URL: ` +
        (err instanceof Error ? err.message : String(err));
      if (process.env.NODE_ENV === "production") throw new Error(msg);
      if (!_warned) {
        console.warn(msg + ` — falling back to ${FALLBACK_ORIGIN}`);
        _warned = true;
      }
      return FALLBACK_ORIGIN;
    }
  }

  const msg =
    "[appOrigin] APP_URL is not set. Persistent object-storage URLs will use the " +
    `fallback origin (${FALLBACK_ORIGIN}). Set APP_URL to the real deployment URL.`;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[appOrigin] APP_URL must be set in production. " +
        "Refusing to start with an unknown canonical origin — " +
        "captioned video and asset URLs would be unresolvable."
    );
  }

  if (!_warned) {
    console.warn(msg);
    _warned = true;
  }
  return FALLBACK_ORIGIN;
}
