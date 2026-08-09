/**
 * POST /api/checkout/create-session
 *
 * Public endpoint — no auth required.
 * Supports two modes:
 *   - embedded: true  → Stripe Embedded Checkout (returns clientSecret for Stripe.js)
 *   - embedded: false → Stripe Hosted Checkout   (returns redirect url)
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { getStripe, getPriceId, getToolAccessDays } from "../lib/stripe";
import { getAppUrl } from "../lib/email";

const router = Router();

/**
 * POST /api/checkout/create-payment-intent
 *
 * Creates a Stripe PaymentIntent and returns the clientSecret so the
 * frontend can mount a fully custom-designed payment form using
 * Stripe Elements + PaymentElement.
 */
router.post("/checkout/create-payment-intent", async (req: Request, res: Response): Promise<void> => {
  let stripe: ReturnType<typeof getStripe>;
  let priceId: string;
  try {
    stripe  = getStripe();
    priceId = getPriceId();
  } catch (configErr: any) {
    console.error("[checkout/create-payment-intent] Stripe not configured:", configErr.message);
    res.status(503).json({ error: "El checkout no está disponible en este momento." });
    return;
  }

  const toolAccessDays = getToolAccessDays();

  try {
    // Retrieve price for canonical amount + currency (avoids hardcoding)
    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) {
      res.status(500).json({ error: "No se pudo determinar el precio." });
      return;
    }

    const intent = await stripe.paymentIntents.create({
      amount:   price.unit_amount,
      currency: price.currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        product:          "reelsona_program",
        tool_access_days: String(toolAccessDays),
      },
    });

    res.json({ clientSecret: intent.client_secret });
  } catch (err: any) {
    console.error("[checkout/create-payment-intent]", err?.message);
    res.status(500).json({ error: "No se pudo crear la sesión de pago" });
  }
});

router.post("/checkout/create-session", async (req: Request, res: Response): Promise<void> => {
  const { email, fullName, embedded } = (req.body ?? {}) as {
    email?:    string;
    fullName?: string;
    embedded?: boolean;
  };

  // For hosted checkout, email is required up-front.
  // For embedded checkout, Stripe collects it inside the form.
  if (!embedded && (!email || !email.includes("@"))) {
    res.status(400).json({ error: "Se requiere un email válido" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  let priceId: string;
  try {
    stripe  = getStripe();
    priceId = getPriceId();
  } catch (configErr: any) {
    console.error("[checkout/create-session] Stripe not configured:", configErr.message);
    res.status(503).json({ error: "El checkout no está disponible en este momento. Contacta al equipo." });
    return;
  }

  const appUrl         = getAppUrl();
  const toolAccessDays = getToolAccessDays();

  try {
    if (embedded) {
      // ── Embedded Checkout ──────────────────────────────────────────────────
      // Returns a client_secret that Stripe.js uses to mount the form on our page.
      // After payment, Stripe redirects the browser to return_url.
      const session = await stripe.checkout.sessions.create({
        mode:      "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        ui_mode:   "embedded_page",
        return_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        metadata: {
          product:          "reelsona_program",
          tool_access_days: String(toolAccessDays),
          full_name:        (fullName ?? "").trim(),
        },
      });
      res.json({ clientSecret: session.client_secret });
    } else {
      // ── Hosted Checkout (legacy fallback) ──────────────────────────────────
      const session = await stripe.checkout.sessions.create({
        mode:           "payment",
        customer_email: email!.trim().toLowerCase(),
        line_items:     [{ price: priceId, quantity: 1 }],
        metadata: {
          product:          "reelsona_program",
          tool_access_days: String(toolAccessDays),
          full_name:        (fullName ?? "").trim(),
        },
        success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${appUrl}/checkout/cancel`,
      });
      res.json({ url: session.url });
    }
  } catch (err: any) {
    console.error("[checkout/create-session]", err?.message);
    res.status(500).json({ error: "No se pudo crear la sesión de pago" });
  }
});

export default router;
