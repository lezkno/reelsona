import type Stripe from "stripe";
import { db } from "@workspace/db";
import { purchases, subscriptionsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * One user may have had several Stripe customers over the lifetime of the
 * account. This lock prevents two authenticated checkout requests from both
 * passing the local "no subscription" check before either webhook arrives.
 */
const SUBSCRIPTION_CHECKOUT_LOCK_KEY = BigInt("7823456790123");
const CHECKOUT_CLAIM_STALE_MS = 30 * 60 * 1000;
const BILLING_STATUSES = new Set(["active", "trialing", "past_due"]);
const SCANNABLE_STATUSES = new Set(["active", "trialing", "past_due", "incomplete"]);

function getStripeCustomerId(subscription: Stripe.Subscription): string | null {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id ?? null;
}

type SubscriptionCheckoutClaim =
  | { kind: "claimed"; stripeCustomerId: string | null; stripeSubscriptionId: string | null }
  | { kind: "blocked"; message: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null }
  | { kind: "in_progress"; message: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null };

/**
 * Atomically claims the single subscription slot for an authenticated checkout.
 * The `incomplete` row is an intentional short-lived reservation: it prevents a
 * second request from creating another Stripe customer/subscription while the
 * first Payment Element is still waiting for confirmation.
 */
export async function claimSubscriptionCheckout(
  userId: number,
  planSlug: string,
): Promise<SubscriptionCheckoutClaim> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SUBSCRIPTION_CHECKOUT_LOCK_KEY}, ${userId})`);

    const [existing] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    if (existing && BILLING_STATUSES.has(existing.status)) {
      return {
        kind: "blocked",
        message: "Ya tienes una suscripción activa. Usa el cambio de plan desde Facturación.",
        stripeCustomerId: existing.stripeCustomerId,
        stripeSubscriptionId: existing.stripeSubscriptionId,
      };
    }

    if (existing?.status === "incomplete") {
      const isFresh = existing.updatedAt
        ? Date.now() - existing.updatedAt.getTime() < CHECKOUT_CLAIM_STALE_MS
        : true;
      if (isFresh) {
        return {
          kind: "in_progress",
          message: "Ya hay un checkout de suscripción en curso. Completa ese pago o espera unos minutos antes de reintentarlo.",
          stripeCustomerId: existing.stripeCustomerId,
          stripeSubscriptionId: existing.stripeSubscriptionId,
        };
      }
    }

    if (existing) {
      // A canceled/expired local row can be reused for the next checkout. The
      // historical Stripe subscription remains in purchases, while the unique
      // per-user row becomes the new pending claim.
      const [claimed] = await tx
        .update(subscriptionsTable)
        .set({
          stripeSubscriptionId: null,
          stripeCustomerId: existing.stripeCustomerId,
          planSlug,
          status: "incomplete",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          pendingPlanSlug: null,
          stripeScheduleId: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.id, existing.id))
        .returning({
          stripeCustomerId: subscriptionsTable.stripeCustomerId,
          stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
        });
      return {
        kind: "claimed",
        stripeCustomerId: claimed?.stripeCustomerId ?? null,
        stripeSubscriptionId: claimed?.stripeSubscriptionId ?? null,
      };
    }

    await tx.insert(subscriptionsTable).values({
      userId,
      planSlug,
      status: "incomplete",
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    return { kind: "claimed", stripeCustomerId: null, stripeSubscriptionId: null };
  });
}

export async function updateSubscriptionCheckoutClaim(
  userId: number,
  updates: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null },
): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({ ...updates, status: "incomplete", updatedAt: new Date() })
    .where(eq(subscriptionsTable.userId, userId));
}

export async function releaseSubscriptionCheckoutClaim(userId: number): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      status: "canceled",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.userId, userId));
}

export interface ReconcileStripeSubscriptionsOptions {
  stripe: Stripe;
  userId: number;
  email?: string | null;
  preferredSubscriptionId?: string | null;
  cancelDuplicates?: boolean;
}

export interface ReconcileStripeSubscriptionsResult {
  activeSubscriptionId: string | null;
  activeCustomerId: string | null;
  reusableIncompleteSubscriptionId: string | null;
  reusableIncompleteCustomerId: string | null;
  duplicateSubscriptionIds: string[];
}

export interface CanonicalSubscriptionSelection {
  canonical: Stripe.Subscription | undefined;
  duplicates: Stripe.Subscription[];
  reusableIncomplete: Stripe.Subscription | undefined;
}

/**
 * Pure selection rule used by both Checkout and Payment Element provisioning.
 * A locally persisted billable subscription wins over the event's subscription;
 * otherwise the preferred event subscription wins, then the oldest billable
 * subscription. This makes late duplicate webhooks harmless.
 */
export function selectCanonicalSubscription(
  subscriptions: Stripe.Subscription[],
  localSubscriptionId?: string | null,
  preferredSubscriptionId?: string | null,
): CanonicalSubscriptionSelection {
  const uniqueSubscriptions = [...new Map(subscriptions.map((sub) => [sub.id, sub])).values()];
  const billable = uniqueSubscriptions.filter((sub) => BILLING_STATUSES.has(sub.status));
  const localCanonical = localSubscriptionId
    ? billable.find((sub) => sub.id === localSubscriptionId)
    : undefined;
  const preferred = preferredSubscriptionId
    ? billable.find((sub) => sub.id === preferredSubscriptionId)
    : undefined;
  const canonical = localCanonical
    ?? preferred
    ?? [...billable].sort((a, b) => (a.created ?? 0) - (b.created ?? 0))[0];
  const duplicates = billable.filter((sub) => sub.id !== canonical?.id);
  const reusableIncomplete = canonical
    ? undefined
    : uniqueSubscriptions
      .filter((sub) => sub.status === "incomplete")
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];

  return { canonical, duplicates, reusableIncomplete };
}

/** A duplicate webhook can be audited, but must never provision access/credits. */
export function shouldProvisionCanonicalSubscription(
  canonicalSubscriptionId: string | null,
  candidateSubscriptionId: string,
): boolean {
  return canonicalSubscriptionId === null || canonicalSubscriptionId === candidateSubscriptionId;
}

/**
 * Finds subscriptions across every Stripe customer known for the user, then
 * keeps one canonical billing subscription. Duplicate active subscriptions are
 * canceled to stop future billing; the Stripe IDs remain in purchases/audit
 * records and are never silently reassigned to another account.
 */
export async function reconcileStripeSubscriptionsForUser(
  options: ReconcileStripeSubscriptionsOptions,
): Promise<ReconcileStripeSubscriptionsResult> {
  const { stripe, userId, email, preferredSubscriptionId, cancelDuplicates = true } = options;
  const customerIds = new Set<string>();

  const [localSub] = await db
    .select({
      stripeCustomerId: subscriptionsTable.stripeCustomerId,
      stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
      status: subscriptionsTable.status,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  if (localSub?.stripeCustomerId) customerIds.add(localSub.stripeCustomerId);

  const historicalCustomers = await db
    .select({ providerCustomerId: purchases.providerCustomerId })
    .from(purchases)
    .where(eq(purchases.userId, userId));
  for (const row of historicalCustomers) {
    if (row.providerCustomerId) customerIds.add(row.providerCustomerId);
  }

  // Authenticated users may have a historical Stripe customer that was never
  // written to purchases. Search is intentionally not used for anonymous
  // callers; this function is only called with a resolved userId.
  if (email && customerIds.size === 0 && stripe.customers?.search) {
    const escapedEmail = email.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const result = await stripe.customers.search({ query: `email:'${escapedEmail}'`, limit: 100 });
    for (const customer of result.data) customerIds.add(customer.id);
  }

  const remoteSubscriptions: Stripe.Subscription[] = [];
  for (const customerId of customerIds) {
    const result = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    for (const subscription of result.data) {
      if (SCANNABLE_STATUSES.has(subscription.status)) {
        remoteSubscriptions.push(subscription);
      }
    }
  }

  const selection = selectCanonicalSubscription(
    remoteSubscriptions,
    localSub?.stripeSubscriptionId,
    preferredSubscriptionId,
  );
  const { canonical, duplicates, reusableIncomplete } = selection;
  const duplicateSubscriptionIds = duplicates.map((sub) => sub.id);

  if (cancelDuplicates) {
    for (const duplicateId of duplicateSubscriptionIds) {
      try {
        await stripe.subscriptions.cancel(duplicateId);
        logger.warn({ userId, duplicateId, canonicalId: canonical?.id ?? null }, "[subscription-reconciliation] Canceled duplicate subscription");
      } catch (err: any) {
        logger.error({ userId, duplicateId, err: err?.message }, "[subscription-reconciliation] Could not cancel duplicate subscription");
      }
    }

    // Incomplete subscriptions cannot bill yet and are safe to cancel once one
    // reusable candidate is retained. This prevents stale Payment Element
    // attempts from accumulating across customers.
    const incomplete = remoteSubscriptions
      .filter((sub) => sub.status === "incomplete")
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const incompleteDuplicates = canonical
      ? incomplete
      : incomplete.filter((sub) => sub.id !== reusableIncomplete?.id);
    for (const duplicate of incompleteDuplicates) {
      try {
        await stripe.subscriptions.cancel(duplicate.id);
      } catch (err: any) {
        logger.warn({ userId, duplicateId: duplicate.id, err: err?.message }, "[subscription-reconciliation] Could not cancel stale incomplete subscription");
      }
    }
    return {
      activeSubscriptionId: canonical?.id ?? null,
      activeCustomerId: canonical ? getStripeCustomerId(canonical) : null,
      reusableIncompleteSubscriptionId: reusableIncomplete?.id ?? null,
      reusableIncompleteCustomerId: reusableIncomplete ? getStripeCustomerId(reusableIncomplete) : null,
      duplicateSubscriptionIds,
    };
  }

  return {
    activeSubscriptionId: canonical?.id ?? null,
    activeCustomerId: canonical ? getStripeCustomerId(canonical) : null,
    reusableIncompleteSubscriptionId: reusableIncomplete?.id ?? null,
    reusableIncompleteCustomerId: reusableIncomplete ? getStripeCustomerId(reusableIncomplete) : null,
    duplicateSubscriptionIds,
  };
}