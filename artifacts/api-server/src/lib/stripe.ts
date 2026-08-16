/**
 * Stripe client factory and plan configuration helpers.
 *
 * All access to Stripe credentials goes through this module.
 * Plan price IDs are stored in the stripe_price_configs DB table after the admin
 * setup endpoint is called once.  A lightweight in-memory cache (60 s TTL) avoids
 * a DB round-trip on every checkout.
 */

import Stripe from "stripe";
import { db } from "@workspace/db";
import { stripePriceConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// ── Plan configuration cache ──────────────────────────────────────────────────

interface PlanPriceConfig {
  planSlug:        string;
  stripePriceId:   string;
  stripeProductId: string;
  amountCents:     number;
  creditAmount:    number;
  interval:        string | null;
  isRecurring:     boolean;
}

let _priceCache: Map<string, PlanPriceConfig> | null = null;
let _priceCacheAt = 0;
const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds

/** Returns all known plan/topup price configs from the DB (cached). */
export async function getAllPriceConfigs(): Promise<Map<string, PlanPriceConfig>> {
  if (_priceCache && Date.now() - _priceCacheAt < PRICE_CACHE_TTL_MS) {
    return _priceCache;
  }
  const rows = await db.select().from(stripePriceConfigsTable);
  const map = new Map<string, PlanPriceConfig>();
  for (const row of rows) {
    map.set(row.planSlug, {
      planSlug:        row.planSlug,
      stripePriceId:   row.stripePriceId,
      stripeProductId: row.stripeProductId,
      amountCents:     row.amountCents,
      creditAmount:    row.creditAmount,
      interval:        row.interval ?? null,
      isRecurring:     row.isRecurring,
    });
  }
  _priceCache = map;
  _priceCacheAt = Date.now();
  return map;
}

/** Invalidates the price config cache (call after admin setup). */
export function invalidatePriceCache(): void {
  _priceCache = null;
}

/** Returns config for a specific plan slug, or null if not found. */
export async function getPlanConfig(planSlug: string): Promise<PlanPriceConfig | null> {
  const configs = await getAllPriceConfigs();
  return configs.get(planSlug) ?? null;
}

// ── Founder seat counter ──────────────────────────────────────────────────────
import { subscriptionsTable } from "@workspace/db";
import { eq as eqOp, and, inArray } from "drizzle-orm";

/** Returns the current number of active Founder subscriptions. */
export async function getActiveFounderCount(): Promise<number> {
  const rows = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eqOp(subscriptionsTable.planSlug, "founder"),
        inArray(subscriptionsTable.status, ["active", "trialing"]),
      )
    );
  return rows.length;
}

// ── Legacy helpers (kept for backward compat) ─────────────────────────────────

/**
 * @deprecated — Reads from STRIPE_PRICE_ID_PROGRAM env var (legacy single-plan).
 * Kept so the old PaymentIntent checkout path keeps compiling.
 */
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
