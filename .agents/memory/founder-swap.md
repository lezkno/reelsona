---
name: Founder swap billing pattern
description: How an active Basic/Pro subscriber upgrades to Founder and the durability rules around cancelling the old Stripe subscription.
---

# Founder swap

Active Basic/Pro subscribers may buy Founder via checkout (guard exempts founder unless the user is already Founder). The old Stripe subscription is cancelled only AFTER the Founder provisioning tx commits.

**Rules:**
- Durability: the swap writes `superseded_stripe_subscription_id` (kept permanently) + `superseded_cancelled_at` (NULL until Stripe confirms) on the subscriptions row. A scheduler sweep (`sweepSupersededSubscriptions`, called from pollAndPublishVideos) retries cancellation each cycle.
- **Why:** stamping `provisioned_at` inside the tx means the purchase-recovery sweep never re-runs; without a durable marker a failed cancel leaves the user double-billed forever.
- Late Stripe webhooks (subscription.updated / invoice.paid / invoice.payment_failed) for a superseded sub id must be acknowledged as no-ops (`isSupersededSubscription` in webhook.ts) or Stripe retries with 500s forever.
- A duplicate Founder purchase for an already-active Founder throws in provisioning (purchase stays unprovisioned → recurring ERROR logs → manual refund), mirroring the seat-cap pattern.
- Stripe portal deep-link: pass `flow_data: { type: "payment_method_update" }`; exposed via optional `flow` param through billing route → executeCreatePortal → useOpenPortal hook.
