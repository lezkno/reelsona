/**
 * Subscription tracking table for Reelsona monetization.
 *
 * One row per user — stores their active plan, Stripe identifiers,
 * billing cycle, and Founder-specific monthly grant counter.
 *
 * planSlug values: 'basic' | 'pro' | 'founder'
 * status values:   'active' | 'trialing' | 'past_due' | 'canceled'
 */

import { pgTable, serial, integer, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const subscriptionsTable = pgTable("subscriptions", {
  id:                    serial("id").primaryKey(),
  userId:                integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  stripeSubscriptionId:  varchar("stripe_subscription_id", { length: 256 }).unique(),
  stripeCustomerId:      varchar("stripe_customer_id", { length: 256 }),
  /** basic / pro / founder */
  planSlug:              varchar("plan_slug", { length: 32 }).notNull(),
  /** active / trialing / past_due / canceled */
  status:                varchar("status", { length: 32 }).notNull().default("active"),
  currentPeriodStart:    timestamp("current_period_start"),
  currentPeriodEnd:      timestamp("current_period_end"),
  /**
   * Founder-only: how many monthly 1,500-credit grants have been issued.
   * Max = 12. Incremented each time the monthly cron grants credits.
   */
  founderMonthsGranted:  integer("founder_months_granted").notNull().default(0),
  /** Timestamp of the last Founder monthly credit grant — used by the cron guard. */
  founderLastGrantAt:    timestamp("founder_last_grant_at"),
  /** Whether Stripe will cancel the subscription at period end. */
  cancelAtPeriodEnd:     boolean("cancel_at_period_end").notNull().default(false),
  /**
   * Immutable Stripe invoice ID of the last renewal that successfully granted credits.
   * Used as the idempotency key in invoice.paid so that subscription.updated writing
   * currentPeriodEnd cannot race-condition the credit-grant guard.
   */
  lastGrantedInvoiceId:  varchar("last_granted_invoice_id", { length: 256 }),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
});

export type Subscription    = typeof subscriptionsTable.$inferSelect;
export type NewSubscription = typeof subscriptionsTable.$inferInsert;
