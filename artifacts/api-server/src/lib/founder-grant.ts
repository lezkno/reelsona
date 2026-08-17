/**
 * founder-grant.ts — Pure utility functions for Founder monthly credit-grant logic.
 *
 * Extracted from the scheduler so they can be imported and unit-tested without
 * any database, Stripe, or cron machinery.
 *
 * Core rules:
 * - Each grant date is computed from the immutable founderAnchorAt (the date of the
 *   initial Founder purchase grant), NOT from founderLastGrantAt.
 *   Formula: nextGrantAt = addCalendarMonths(founderAnchorAt, founderMonthsGranted)
 * - This preserves the original purchase day across all 12 cycles even when a grant
 *   is processed late (downtime on the anniversary day).
 * - founderLastGrantAt is audit-only (when the grant actually executed).
 * - Day 29/30/31 edge cases are handled safely: each month is computed independently
 *   from the anchor, so months that CAN carry the original day do (Jan 31 → Mar 31),
 *   and months that cannot clamp to their last day (Jan 31 → Feb 28).
 * - Maximum FOUNDER_MAX_MONTHS (12) grants total.
 * - A null founderAnchorAt means the initial grant hasn't happened yet.
 */

import { FOUNDER_MAX_MONTHS } from "./credits";

// ── addCalendarMonths ──────────────────────────────────────────────────────────

/**
 * Add exactly `n` calendar months to `anchor`, clamping safely when the anchor's
 * day doesn't exist in the target month.
 *
 * Because each result is computed directly from the anchor (not chained from the
 * previous result), months that have the original day get it back automatically:
 *
 *   anchor = Jan 31
 *   n=1 → Feb 28  (Feb has no 31st → clamp)
 *   n=2 → Mar 31  (Mar has 31 → restored, NOT Mar 28)
 *   n=3 → Apr 30  (Apr has no 31st → clamp)
 *   n=4 → May 31  (May has 31 → restored)
 *
 *   anchor = Aug 17
 *   n=1 → Sep 17, n=2 → Oct 17, …  (17 always exists)
 *
 * Implementation: Date.setMonth() overflows automatically (Jan 31 + 1 month →
 * Mar 2/3). We detect the overflow by comparing getDate() before and after;
 * if it changed, setDate(0) steps back to the last day of the intended month.
 */
export function addCalendarMonths(anchor: Date, n: number): Date {
  const result = new Date(anchor);
  const originalDay = result.getDate();
  result.setMonth(result.getMonth() + n);
  // Overflow detected: the day changed because the target month is shorter than
  // the anchor's day. setDate(0) moves back to the last day of the intended month
  // (i.e. the day before day-1 of the month that setMonth overflowed into).
  if (result.getDate() !== originalDay) {
    result.setDate(0);
  }
  return result;
}

/** Convenience alias: add exactly one calendar month. */
export const addOneCalendarMonth = (date: Date): Date => addCalendarMonths(date, 1);

// ── nextFounderGrantDate ───────────────────────────────────────────────────────

/**
 * Return the date at which the NEXT Founder grant becomes eligible.
 *
 * Formula: addCalendarMonths(founderAnchorAt, founderMonthsGranted)
 * where founderMonthsGranted is the count already received.
 *
 * Returns null if:
 *  - founderAnchorAt is null (initial grant not yet recorded)
 *  - founderMonthsGranted >= FOUNDER_MAX_MONTHS (all 12 grants exhausted)
 *
 * Note: founderAnchorAt is the date of the FIRST credit grant, set once at
 * purchase and never updated. founderLastGrantAt is audit-only and is NOT
 * used here.
 */
export function nextFounderGrantDate(
  founderAnchorAt: Date | null,
  founderMonthsGranted: number,
): Date | null {
  if (!founderAnchorAt) return null;
  if (founderMonthsGranted >= FOUNDER_MAX_MONTHS) return null;
  return addCalendarMonths(founderAnchorAt, founderMonthsGranted);
}

// ── isFounderGrantDue ──────────────────────────────────────────────────────────

/**
 * Determine whether a Founder subscriber is due for their next monthly credit grant.
 *
 * Returns true when ALL of:
 *   1. founderAnchorAt is not null
 *   2. founderMonthsGranted < FOUNDER_MAX_MONTHS (12 total maximum)
 *   3. now >= addCalendarMonths(founderAnchorAt, founderMonthsGranted)
 *
 * The `now` parameter is injectable so tests can control the clock without
 * mocking globals.
 *
 * Concurrency safety: after the first of two concurrent grant processes commits,
 * it increments founderMonthsGranted (N → N+1) inside the transaction. The second
 * process (unblocked from FOR UPDATE) re-reads founderMonthsGranted = N+1 and
 * finds addCalendarMonths(anchor, N+1) is next month → not due → skip.
 * The durable idempotency key (cron_founder_${id}_month${N+1}) provides an
 * additional crash-safety net if a process dies after the claim INSERT but
 * before the founderMonthsGranted update.
 */
export function isFounderGrantDue(
  founderAnchorAt: Date | null,
  founderMonthsGranted: number,
  now: Date = new Date(),
): boolean {
  const next = nextFounderGrantDate(founderAnchorAt, founderMonthsGranted);
  if (!next) return false;
  return now >= next;
}
