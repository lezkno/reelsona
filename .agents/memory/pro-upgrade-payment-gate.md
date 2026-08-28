---
name: Pro upgrade payment gate
description: A Basic-to-Pro upgrade can activate local Pro access without an immediate successful Stripe payment.
---

The local Pro state and credit grant are not proof that Stripe collected the upgrade. A prorated subscription update may create invoice adjustments without immediately finalizing or charging an invoice, so access must not be treated as paid until Stripe confirms payment.

**Why:** The production account reached active Pro with no separate Pro purchase or confirmed paid invoice, while the existing subscription was changed in place.

**How to apply:** When auditing or changing plan upgrades, inspect Stripe invoice/payment status and design the flow around an explicit paid or pending state; do not infer payment from the local plan or credit ledger alone.