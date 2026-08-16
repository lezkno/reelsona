/**
 * invoice_credit_grants — per-Stripe-invoice credit grant record.
 *
 * A row is inserted atomically (ON CONFLICT DO NOTHING) inside the same
 * transaction that updates the user's credit wallet. The UNIQUE constraint on
 * stripe_invoice_id is the idempotency guarantee:
 *   - Only one concurrent or duplicate invoice.paid delivery can win the INSERT.
 *   - Prevents out-of-order re-delivery from granting credits twice.
 *   - Also used during initial provisioning (checkout) so the initial invoice
 *     is pre-claimed — when invoice.paid fires for the same invoice it is
 *     already recorded and skips cleanly.
 */
import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const invoiceCreditGrantsTable = pgTable("invoice_credit_grants", {
  id:              serial("id").primaryKey(),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 256 }).notNull().unique(),
  userId:          integer("user_id").notNull(),
  planSlug:        varchar("plan_slug", { length: 32 }).notNull(),
  creditsGranted:  integer("credits_granted").notNull(),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});
