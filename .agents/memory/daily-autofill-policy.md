---
name: Daily content auto-fill policy
description: Automatic content generation should fill only the current local calendar day, not reserve a multi-day future horizon.
---

The product rule is that user-programmed future calendar items take precedence, while automatic generation may create only missing slots for the current calendar date in the automation timezone.

**Why:** A multi-day auto-fill horizon unexpectedly populated users' calendars weeks ahead without explicit scheduling actions.

**How to apply:** Keep same-day filtering in scheduler auto-fill paths; use the configured timezone's next local midnight so DST changes do not expand or shorten the calendar day.