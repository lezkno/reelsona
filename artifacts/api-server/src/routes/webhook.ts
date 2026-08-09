/**
 * POST /api/webhooks/stripe
 *
 * IMPORTANT: This router must be mounted in app.ts BEFORE express.json()
 * so that req.body arrives as a raw Buffer — required for Stripe signature
 * verification. express.raw() is applied at the route level here.
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
  // Raw body parser — must come before the async handler
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string | undefined;

    // Validate Stripe config
    let stripe: ReturnType<typeof getStripe>;
    let webhookSecret: string;
    try {
      stripe        = getStripe();
      webhookSecret = getWebhookSecret();
    } catch (configErr: any) {
      console.error("[webhook/stripe] Not configured:", configErr.message);
      // Return 200 so Stripe doesn't retry — this is a config issue, not a transient error
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

    // Respond immediately — processing happens async so Stripe gets its 200 fast
    res.json({ received: true });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      handleCheckoutCompleted(session).catch((err) => {
        console.error("[webhook/stripe] handleCheckoutCompleted error:", err?.message);
      });
    }
  }
);

// ── Event handler ─────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const sessionId = session.id;

  // ── Idempotency: skip if already processed ──────────────────────────────
  const [existing] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.providerSessionId, sessionId))
    .limit(1);

  if (existing) {
    console.log(`[webhook/stripe] Session ${sessionId} already processed — skipping`);
    return;
  }

  // ── Extract customer data ────────────────────────────────────────────────
  const email    = (session.customer_details?.email ?? session.metadata?.email ?? "").toLowerCase().trim();
  const fullName = (session.customer_details?.name  ?? session.metadata?.full_name ?? "").trim();
  const toolAccessDays = Math.max(
    1,
    parseInt(session.metadata?.tool_access_days ?? "30", 10) || 30
  );
  const amountTotal  = session.amount_total  ?? 0;
  const currency     = session.currency      ?? "usd";
  const customerId   = typeof session.customer === "string" ? session.customer : null;

  if (!email) {
    console.error("[webhook/stripe] No email in session", sessionId);
    return;
  }

  // ── Insert purchase row (guarantees idempotency even if provision fails) ─
  const [purchase] = await db
    .insert(purchases)
    .values({
      provider:           "stripe",
      providerSessionId:  sessionId,
      providerCustomerId: customerId,
      email,
      fullName,
      amountTotal,
      currency,
      status:         "completed",
      toolAccessDays,
    })
    .returning({ id: purchases.id });

  // ── Provision user ───────────────────────────────────────────────────────
  try {
    const result = await provisionUser({
      email,
      name:           fullName || email,
      toolAccessDays,
      courseAccess:   true,
      source:         "stripe",
    });

    // Link purchase to userId for audit
    await db
      .update(purchases)
      .set({ userId: result.userId, updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id));

    console.log(
      `[webhook/stripe] Provisioned userId=${result.userId} email=${email}`,
      `created=${result.created} emailSent=${result.emailSent}`
    );
    if (result.warning) {
      console.warn("[webhook/stripe] Provision warning:", result.warning);
    }
  } catch (err: any) {
    console.error(`[webhook/stripe] Provision failed for ${email}:`, err?.message);
  }
}

export default router;
