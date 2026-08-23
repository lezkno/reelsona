---
name: Webhook unknown subscription no-op
description: invoice.payment_failed for a subscription not in the local DB returns 200 (no-op) instead of 500.
---

# Webhook unknown subscription no-op

**Rule:** When `invoice.payment_failed` arrives for a `stripeSubId` that has no matching row in `subscriptions`, return a no-op (log warn + return) instead of throwing.

**Why:** Throwing causes a 500 response to Stripe, which then retries the event repeatedly (up to 72h). Subscriptions can exist in Stripe but not in the local DB (e.g. created before this deployment, or from test mode leaking into prod). The event cannot be processed, so acknowledging it with 200 is the correct behavior.

**How to apply:**
- `artifacts/api-server/src/routes/webhook.ts` — `handleInvoicePaymentFailed` function, after the `if (!sub)` check: log warn + `return` instead of `throw`.
- The superseded-subscription check (`isSupersededSubscription`) still runs first — Founder-swap superseded subs continue to be handled as named no-ops.
