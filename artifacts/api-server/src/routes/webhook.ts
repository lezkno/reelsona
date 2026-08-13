/**
 * POST /api/webhooks/stripe
 *
 * IMPORTANT: This router must be mounted in app.ts BEFORE express.json()
 * so that req.body arrives as a raw Buffer — required for Stripe signature
 * verification. express.raw() is applied at the route level here.
 *
 * Handles:
 *   - checkout.session.completed  (legacy hosted/embedded checkout)
 *   - payment_intent.succeeded    (custom PaymentElement form)
 *
 * Hardening guarantees:
 *   - Duplicate webhooks are idempotent (providerSessionId UNIQUE check).
 *   - If provisionUser() fails the purchase row still exists; the scheduler's
 *     provision-recovery sweep retries it every minute until it succeeds.
 *   - provisionedAt is stamped only after a successful provision so recovery
 *     can reliably identify un-provisioned payments.
 */

import express, { Router } from "express";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe, getWebhookSecret } from "../lib/stripe";
import { provisionUser } from "../lib/provision";
import { db } from "@workspace/db";
import { purchases } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string | undefined;

    let stripe: ReturnType<typeof getStripe>;
    let webhookSecret: string;
    try {
      stripe        = getStripe();
      webhookSecret = getWebhookSecret();
    } catch (configErr: any) {
      console.error("[webhook/stripe] Not configured:", configErr.message);
      res.json({ received: false, reason: "not_configured" });
      return;
    }

    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err: any) {
      console.warn("[webhook/stripe] Signature verification failed:", err.message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    // Respond immediately so Stripe gets its 200 fast
    res.json({ received: true });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      handleCheckoutCompleted(session).catch((err) => {
        console.error("[webhook/stripe] handleCheckoutCompleted error:", err?.message);
      });
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      handlePaymentIntentSucceeded(intent).catch((err) => {
        console.error("[webhook/stripe] handlePaymentIntentSucceeded error:", err?.message);
      });
    }
  }
);

// ── checkout.session.completed ─────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const sessionId = session.id;

  // Idempotency: if a purchase row already exists for this session it means
  // either (a) a duplicate webhook fired, or (b) we already processed it.
  // In both cases, skip insertion but still attempt provision if it didn't complete.
  const [existing] = await db
    .select({ id: purchases.id, provisionedAt: purchases.provisionedAt, email: purchases.email, fullName: purchases.fullName, toolAccessDays: purchases.toolAccessDays })
    .from(purchases)
    .where(eq(purchases.providerSessionId, sessionId))
    .limit(1);

  if (existing) {
    if (existing.provisionedAt) {
      console.log(`[webhook/stripe] Session ${sessionId} already fully processed — skipping`);
      return;
    }
    // Purchase exists but provision never completed — retry it now.
    console.log(`[webhook/stripe] Session ${sessionId} purchase exists but not provisioned — retrying provision`);
    await retryProvision(existing.id, existing.email, existing.fullName ?? existing.email, existing.toolAccessDays);
    return;
  }

  const email    = (session.customer_details?.email ?? session.metadata?.email ?? "").toLowerCase().trim();
  const fullName = (session.customer_details?.name  ?? session.metadata?.full_name ?? "").trim();
  const toolAccessDays = Math.max(1, parseInt(session.metadata?.tool_access_days ?? "30", 10) || 30);
  const amountTotal  = session.amount_total  ?? 0;
  const currency     = session.currency      ?? "usd";
  const customerId   = typeof session.customer === "string" ? session.customer : null;

  if (!email) {
    console.error("[webhook/stripe] No email in session", sessionId);
    return;
  }

  // Insert purchase row first — this is the durable record of the payment.
  // provisionedAt stays null until provision succeeds.
  const [purchase] = await db
    .insert(purchases)
    .values({
      provider: "stripe",
      providerSessionId: sessionId,
      providerCustomerId: customerId,
      email,
      fullName,
      amountTotal,
      currency,
      status: "completed",
      toolAccessDays,
      // provisionedAt intentionally null — set by retryProvision on success
    })
    .returning({ id: purchases.id });

  await retryProvision(purchase.id, email, fullName || email, toolAccessDays);
}

// ── payment_intent.succeeded ───────────────────────────────────────────────────
// Triggered by the custom PaymentElement form (not a Checkout Session).

async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const intentId = intent.id;

  const [existing] = await db
    .select({ id: purchases.id, provisionedAt: purchases.provisionedAt, email: purchases.email, fullName: purchases.fullName, toolAccessDays: purchases.toolAccessDays })
    .from(purchases)
    .where(eq(purchases.providerSessionId, intentId))
    .limit(1);

  if (existing) {
    if (existing.provisionedAt) {
      console.log(`[webhook/stripe] PaymentIntent ${intentId} already fully processed — skipping`);
      return;
    }
    console.log(`[webhook/stripe] PaymentIntent ${intentId} purchase exists but not provisioned — retrying`);
    await retryProvision(existing.id, existing.email, existing.fullName ?? existing.email, existing.toolAccessDays);
    return;
  }

  // Retrieve billing details from the attached PaymentMethod
  let email    = (intent.receipt_email ?? "").toLowerCase().trim();
  let fullName = "";

  if (intent.payment_method && typeof intent.payment_method === "string") {
    try {
      const stripe = getStripe();
      const pm     = await stripe.paymentMethods.retrieve(intent.payment_method);
      if (pm.billing_details.email) email    = pm.billing_details.email.toLowerCase().trim();
      if (pm.billing_details.name)  fullName = pm.billing_details.name.trim();
    } catch (err: any) {
      console.warn("[webhook/stripe] Could not retrieve payment method:", err?.message);
    }
  }

  // Fallback to metadata if billing_details were empty
  if (!email)    email    = (intent.metadata?.email      ?? "").toLowerCase().trim();
  if (!fullName) fullName = (intent.metadata?.full_name  ?? "").trim();

  if (!email) {
    console.error("[webhook/stripe] No email found in PaymentIntent", intentId);
    return;
  }

  const toolAccessDays = Math.max(1, parseInt(intent.metadata?.tool_access_days ?? "30", 10) || 30);
  const amountTotal    = intent.amount_received ?? intent.amount ?? 0;
  const currency       = intent.currency ?? "usd";
  const customerId     = typeof intent.customer === "string" ? intent.customer : null;

  const [purchase] = await db
    .insert(purchases)
    .values({
      provider: "stripe",
      providerSessionId: intentId,
      providerCustomerId: customerId,
      email,
      fullName,
      amountTotal,
      currency,
      status: "completed",
      toolAccessDays,
    })
    .returning({ id: purchases.id });

  await retryProvision(purchase.id, email, fullName || email, toolAccessDays);
}

// ── Shared provision helper ────────────────────────────────────────────────────

/**
 * Run provisionUser and stamp provisionedAt on success.
 * On failure: logs the error and leaves provisionedAt=null so the scheduler
 * recovery sweep retries it on the next polling cycle.
 */
async function retryProvision(
  purchaseId:    number,
  email:         string,
  name:          string,
  toolAccessDays: number,
): Promise<void> {
  try {
    const result = await provisionUser({
      email,
      name,
      toolAccessDays,
      courseAccess: true,
      source: "stripe",
    });
    // Stamp provisionedAt only after confirmed success
    await db
      .update(purchases)
      .set({ userId: result.userId, provisionedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchases.id, purchaseId));
    console.log(
      `[webhook/stripe] Provisioned userId=${result.userId} email=${email}`,
      `created=${result.created} emailSent=${result.emailSent}`,
    );
    if (result.warning) console.warn("[webhook/stripe] Provision warning:", result.warning);
  } catch (err: any) {
    // Leave provisionedAt=null — the scheduler recovery sweep will retry.
    console.error(
      `[webhook/stripe] Provision failed for ${email} (purchaseId=${purchaseId}):`,
      err?.message,
      "— scheduler will retry automatically",
    );
  }
}

export default router;
