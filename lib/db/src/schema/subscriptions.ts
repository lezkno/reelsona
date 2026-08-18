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
  /**
   * Immutable anchor date for Founder credit-grant scheduling.
   * Set once at the initial Founder purchase and never updated.
   * Each monthly grant date is: addCalendarMonths(founderAnchorAt, founderMonthsGranted).
   * This preserves the original purchase day across all 12 cycles even when a
   * grant is processed late (server downtime on the anniversary day).
   */
  founderAnchorAt:       timestamp("founder_anchor_at"),
  /** Audit trail: when the last Founder monthly credit grant actually executed. NOT used for scheduling. */
  founderLastGrantAt:    timestamp("founder_last_grant_at"),
  /** Whether Stripe will cancel the subscription at period end. */
  cancelAtPeriodEnd:     boolean("cancel_at_period_end").notNull().default(false),
  /**
   * Scheduled plan change: when set, a Stripe Subscription Schedule is managing
   * the next billing cycle price. At renewal, the plan switches to this value.
   * Used for Pro→Basic downgrades: user keeps Pro access until currentPeriodEnd,
   * then Basic credits are granted at the next invoice.paid cycle.
   * Null means no pending change. Values: 'basic' | 'pro' (never 'founder').
   */
  pendingPlanSlug:       varchar("pending_plan_slug", { length: 32 }),
  /**
   * Stripe Subscription Schedule ID backing the pending plan change.
   * Set alongside pendingPlanSlug; cleared when the schedule is released
   * (upgrade, manual cancellation, or automatic phase transition at period end).
   */
  stripeScheduleId:      varchar("stripe_schedule_id", { length: 256 }),
  /**
   * Founder swap: the OLD Stripe subscription id that this Founder purchase
   * replaced. Kept permanently so late webhooks for the old subscription can be
   * acknowledged as no-ops instead of erroring.
   */
  supersededStripeSubscriptionId: varchar("superseded_stripe_subscription_id", { length: 256 }),
  /**
   * Set once Stripe confirms the superseded subscription was cancelled.
   * NULL while supersededStripeSubscriptionId is set means the cancellation is
   * still pending — the scheduler sweep retries it every cycle.
   */
  supersededCancelledAt:  timestamp("superseded_cancelled_at"),
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
