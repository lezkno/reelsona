/**
 * founder-grant.ts — Pure utility functions for Founder monthly credit-grant logic.
 *
 * Extracted from the scheduler so they can be imported and unit-tested without
 * any database, Stripe, or cron machinery.
 *
 * Core rules:
 * - Grants run on the calendar-month anniversary of founderLastGrantAt (the date
 *   the previous grant was made), not every 28 days.
 * - Day 29/30/31 edge cases are handled safely: when the original day doesn't
 *   exist in the target month, the result is clamped to the last day of that month.
 * - Maximum FOUNDER_MAX_MONTHS (12) grants total; afterwards nothing happens.
 * - A null founderLastGrantAt means the initial grant hasn't happened yet;
 *   the cron never handles that case (provision-purchase.ts does).
 */

import { FOUNDER_MAX_MONTHS } from "./credits";

// ── addOneCalendarMonth ────────────────────────────────────────────────────────

/**
 * Add exactly one calendar month to `date`, clamping safely when the original
 * day doesn't exist in the target month.
 *
 * Examples:
 *   Aug 17 → Sep 17
 *   Jan 31 → Feb 28 (non-leap) or Feb 29 (leap)
 *   Mar 31 → Apr 30
 *   Nov 30 → Dec 30
 *   Dec 31 → Jan 31 (next year)
 *
 * Implementation: JavaScript's Date.setMonth() overflows automatically (Jan 31
 * + 1 month becomes Mar 2/3). We detect the overflow by comparing getDate()
 * before and after; if it changed, we call setDate(0) to step back to the last
 * day of the intended month.
 */
export function addOneCalendarMonth(date: Date): Date {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setMonth(result.getMonth() + 1);
  // Overflow detected: day changed because the target month is shorter.
  // setDate(0) moves back to the last day of the now-current month's predecessor,
  // which is the last day of the intended target month.
  if (result.getDate() !== originalDay) {
    result.setDate(0);
  }
  return result;
}

// ── nextFounderGrantDate ───────────────────────────────────────────────────────

/**
 * Return the date at which the next Founder grant becomes eligible:
 * exactly one calendar month after the last grant.
 *
 * Returns null if founderLastGrantAt is null (initial grant pending)
 * or if the subscriber has already received all FOUNDER_MAX_MONTHS grants.
 */
export function nextFounderGrantDate(
  founderLastGrantAt: Date | null,
  founderMonthsGranted: number,
): Date | null {
  if (founderMonthsGranted >= FOUNDER_MAX_MONTHS) return null;
  if (!founderLastGrantAt) return null;
  return addOneCalendarMonth(founderLastGrantAt);
}

// ── isFounderGrantDue ──────────────────────────────────────────────────────────

/**
 * Determine whether a Founder subscriber is due for their next monthly credit grant.
 *
 * Returns true when ALL of:
 *   1. founderMonthsGranted < FOUNDER_MAX_MONTHS (12 total maximum)
 *   2. founderLastGrantAt is not null
 *   3. now >= addOneCalendarMonth(founderLastGrantAt)  (calendar anniversary reached)
 *
 * The `now` parameter is injectable so tests can control the clock without
 * mocking globals.
 *
 * Concurrency note: after the first of two concurrent grant processes commits,
 * it sets founderLastGrantAt = now inside the transaction.  The second process
 * (blocked by FOR UPDATE) re-reads the updated row and will find:
 *   addOneCalendarMonth(now) > now  →  not due  →  skip.
 * The durable idempotency key (cron_founder_${id}_month${N}) provides an
 * additional crash-safety net if a process dies after the claim INSERT but
 * before the founderLastGrantAt update.
 */
export function isFounderGrantDue(
  founderLastGrantAt: Date | null,
  founderMonthsGranted: number,
  now: Date = new Date(),
): boolean {
  const next = nextFounderGrantDate(founderLastGrantAt, founderMonthsGranted);
  if (!next) return false;
  return now >= next;
}
