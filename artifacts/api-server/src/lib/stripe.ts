/**
 * Stripe client factory.
 *
 * All access to Stripe credentials goes through this module.
 * Every getter throws with a clear message when the env var is missing
 * so callers can return a 503 instead of crashing the process.
 */

import Stripe from "stripe";

let _client: Stripe | null = null;

/** Returns a cached Stripe instance. Throws if STRIPE_SECRET_KEY is not set. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!_client) {
    _client = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  }
  return _client;
}

/** Throws if STRIPE_WEBHOOK_SECRET is not set. */
export function getWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!s) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return s;
}

/** Throws if STRIPE_PRICE_ID_PROGRAM is not set. */
export function getPriceId(): string {
  const p = process.env.STRIPE_PRICE_ID_PROGRAM?.trim();
  if (!p) throw new Error("STRIPE_PRICE_ID_PROGRAM is not configured");
  return p;
}

/** Falls back to 30 days if STRIPE_TOOL_ACCESS_DAYS is absent or invalid. */
export function getToolAccessDays(): number {
  const raw = process.env.STRIPE_TOOL_ACCESS_DAYS;
  const n   = parseInt(raw ?? "", 10);
  return !isNaN(n) && n >= 1 && n <= 3650 ? n : 30;
}
