/**
 * Wallet and credit ledger tables for the Reelsona credit system.
 *
 * user_credits  — one row per user; tracks available / reserved / consumed totals.
 * credit_ledger — append-only audit log; every balance movement has an entry.
 *
 * Credit lifecycle for video generation:
 *   provision → reserve (on submit) → consume (on success) | release (on failure)
 */

import { pgTable, serial, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { videosTable } from "./videos";

// ── Wallet ────────────────────────────────────────────────────────────────────

export const userCreditsTable = pgTable("user_credits", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  /**
   * Total credits available for new reservations.
   * Always kept in sync: availableCredits = subscriptionCredits + purchasedCredits.
   * Maintained for backward compatibility with existing code.
   */
  availableCredits:    integer("available_credits").notNull().default(0),
  /** Credits reserved (deducted from available, not yet consumed). */
  reservedCredits:     integer("reserved_credits").notNull().default(0),
  /** Cumulative credits consumed across all completed videos. */
  totalConsumed:       integer("total_consumed").notNull().default(0),
  /**
   * Credits from the active subscription cycle.
   * Reset (not accumulated) on each billing renewal.
   * Spent before purchasedCredits.
   */
  subscriptionCredits: integer("subscription_credits").notNull().default(0),
  /**
   * Credits from one-time topup purchases.
   * Persist indefinitely — never reset by plan changes or renewals.
   */
  purchasedCredits:    integer("purchased_credits").notNull().default(0),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});

export type UserCredits    = typeof userCreditsTable.$inferSelect;
export type NewUserCredits = typeof userCreditsTable.$inferInsert;

// ── Ledger ────────────────────────────────────────────────────────────────────

/**
 * Immutable audit log. Never UPDATE or DELETE rows here.
 *
 * type values:
 *   provision — credits added (new access purchase or admin grant)
 *   reserve   — credits held for an in-progress generation (negative amount)
 *   consume   — reserved credits finalised after a successful video (negative)
 *   release   — reserved credits returned to available after a failure (positive)
 *
 * relatedLedgerId points to the original 'reserve' entry for consume/release rows.
 */
export const creditLedgerTable = pgTable("credit_ledger", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Credit movement type: provision | reserve | consume | release | adjustment */
  type:            varchar("type", { length: 32 }).notNull(),
  /** Signed amount: positive = credits added, negative = credits spent/reserved. */
  amount:          integer("amount").notNull(),
  /** availableCredits before this entry. */
  balanceBefore:   integer("balance_before").notNull(),
  /** availableCredits after this entry. */
  balanceAfter:    integer("balance_after").notNull(),
  /**
   * Credit pool: 'subscription' | 'purchased' | 'mixed' | null (legacy rows).
   * 'mixed' = reserve/release spans both pools; see subscriptionAmount/purchasedAmount.
   */
  pool:                varchar("pool", { length: 16 }),
  /** For 'mixed' reserve/release: how much came from subscriptionCredits. */
  subscriptionAmount:  integer("subscription_amount"),
  /** For 'mixed' reserve/release: how much came from purchasedCredits. */
  purchasedAmount:     integer("purchased_amount"),
  /** Video this movement is associated with (nullable). */
  videoId:         integer("video_id").references(() => videosTable.id, { onDelete: "set null" }),
  /** For consume/release rows: the id of the original reserve entry. */
  relatedLedgerId: integer("related_ledger_id"), // intentional: no FK to avoid self-reference complexity
  description:     text("description"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export type CreditLedgerEntry = typeof creditLedgerTable.$inferSelect;
