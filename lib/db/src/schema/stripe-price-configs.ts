/**
 * Stripe price configuration registry.
 *
 * Stores the Stripe price/product IDs for each plan/topup after they are
 * created via the admin setup endpoint. Reading from DB avoids hardcoding
 * price IDs in code or env vars.
 *
 * planSlug values:
 *   Subscriptions: 'basic' | 'pro' | 'founder'
 *   One-time tops:  'topup-300' | 'topup-600' | 'topup-1200'
 */

import { pgTable, serial, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const stripePriceConfigsTable = pgTable("stripe_price_configs", {
  id:             serial("id").primaryKey(),
  /** Unique slug that identifies this plan or topup package. */
  planSlug:       varchar("plan_slug", { length: 64 }).notNull().unique(),
  stripePriceId:  varchar("stripe_price_id", { length: 256 }).notNull(),
  stripeProductId: varchar("stripe_product_id", { length: 256 }).notNull(),
  /** Price in cents (USD). */
  amountCents:    integer("amount_cents").notNull(),
  currency:       varchar("currency", { length: 8 }).notNull().default("usd"),
  /** 'month' | 'year' | null for one-time payments. */
  interval:       varchar("interval", { length: 16 }),
  /** Credits granted per purchase or per billing cycle. */
  creditAmount:   integer("credit_amount").notNull().default(0),
  /** True for subscription plans, false for one-time topups. */
  isRecurring:    boolean("is_recurring").notNull().default(true),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export type StripePriceConfig    = typeof stripePriceConfigsTable.$inferSelect;
export type NewStripePriceConfig = typeof stripePriceConfigsTable.$inferInsert;
