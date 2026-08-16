import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const purchases = pgTable("purchases", {
  id:                  serial("id").primaryKey(),
  provider:            varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerSessionId:   varchar("provider_session_id", { length: 256 }).notNull().unique(),
  providerCustomerId:  varchar("provider_customer_id", { length: 256 }),
  email:               varchar("email", { length: 256 }).notNull(),
  fullName:            varchar("full_name", { length: 256 }),
  amountTotal:         integer("amount_total"),   // cents
  currency:            varchar("currency", { length: 8 }),
  status:              varchar("status", { length: 32 }).notNull().default("pending"),
  toolAccessDays:      integer("tool_access_days").notNull().default(30),
  userId:              integer("user_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * Purchase type:
   *  'program'      — legacy one-time program purchase (old system)
   *  'subscription' — subscription checkout (basic/pro/founder)
   *  'topup'        — one-time credit top-up purchase
   */
  purchaseType:        varchar("purchase_type", { length: 32 }).notNull().default("program"),
  /** The plan slug for subscription purchases (basic/pro/founder), null for topups. */
  planSlug:            varchar("plan_slug", { length: 32 }),
  /** Credits granted by this purchase (used for topups). */
  creditsPurchased:    integer("credits_purchased"),
  /**
   * Set to NOW() when provisionUser() completes successfully.
   * NULL means provision is pending or failed — the scheduler recovery sweep
   * will retry it automatically until it succeeds.
   */
  provisionedAt:       timestamp("provisioned_at"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});
