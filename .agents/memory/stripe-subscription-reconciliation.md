---
name: Stripe subscription reconciliation
description: Authenticated subscription checkout must reconcile historical Stripe customers before activation or credit grants.
---

An authenticated user can have historical Stripe customers, so a local one-row subscription check is not enough to prevent duplicate billing. Reconcile all known customer IDs, keep one canonical subscription, and retain duplicate payment references without granting duplicate access or credits.

**Why:** A retry can arrive before the first webhook updates the local subscription row, while old customer records may still contain billable subscriptions.

**How to apply:** Serialize checkout claims per user, treat incomplete local rows as temporary reservations, reconcile Stripe subscriptions before provisioning, and use the initial invoice ID as an idempotency guard for credits.

Stripe can also contain active subscriptions from a legacy or separate product schema. Metadata naming, plan identifiers, and prices may not match the local registry, so an email resemblance or an unknown local subscription ID is not enough to attach them to a user.

**Why:** An active paid subscription was found with a legacy product price and UUID/camelCase metadata while no local account or configured price matched it; automatic attachment would risk granting access to the wrong user.

**How to apply:** Require an exact ownership signal and a locally configured price before provisioning; classify unmatched renewal webhooks as orphan/foreign billing records until an explicit reconciliation proves ownership.

Do not let subscription-event ordering discard a verified `invoice.paid` credit grant. Claim the grant idempotently by invoice ID; a newer `subscription.updated` event may arrive first even when the paid invoice still represents the current renewal.

**Why:** Production logs showed a renewal invoice paid after payment retries, then ignored because a later subscription event had already advanced `lastStripeEventCreatedAt`; the subscription renewed but its monthly credits did not.

**How to apply:** Keep stale-event ordering guards for subscription state/period updates, but evaluate paid-invoice credit eligibility and invoice-ID idempotency independently.