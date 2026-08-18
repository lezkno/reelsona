/**
 * Stripe client factory and plan configuration helpers.
 *
 * All access to Stripe credentials goes through this module.
 * Plan price IDs are stored in the stripe_price_configs DB table after the admin
 * setup endpoint is called once. A lightweight in-memory cache (60 s TTL) avoids
 * a DB round-trip on every checkout.
 */

import Stripe from "stripe";
import { db } from "@workspace/db";
import { stripePriceConfigsTable } from "@workspace/db";

let _client: Stripe | null = null;

function assertStripeEnvironmentSafe(key: string): void {
  const isProduction = process.env.NODE_ENV === "production";
  const isLiveKey = key.startsWith("sk_live_");
  const explicitOverride = process.env.ALLOW_LIVE_STRIPE_IN_NONPROD === "true";

  if (!isProduction && isLiveKey && !explicitOverride) {
    throw new Error(
      "Refusing to use a live Stripe secret outside NODE_ENV=production. " +
        "Use an sk_test_ key for development, or explicitly set ALLOW_LIVE_STRIPE_IN_NONPROD=true for a deliberate live test.",
    );
  }
}

/** Returns a cached Stripe instance. Throws if STRIPE_SECRET_KEY is not set. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  assertStripeEnvironmentSafe(key);
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
const PRICE_CACHE_TTL_MS = 60_000;

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

export function invalidatePriceCache(): void {
  _priceCache = null;
}

export async function getPlanConfig(planSlug: string): Promise<PlanPriceConfig | null> {
  const configs = await getAllPriceConfigs();
  return configs.get(planSlug) ?? null;
}

import { subscriptionsTable } from "@workspace/db";
import { eq as eqOp, and, inArray } from "drizzle-orm";

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

// Legacy helpers removed — the old PaymentIntent/program product is discontinued.
