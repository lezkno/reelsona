/**
 * founder-grant.test.ts — Unit tests for anchor-based Founder credit-grant logic.
 *
 * Tests the pure functions from founder-grant.ts.  All DB/cron/Stripe machinery
 * is excluded — these tests run instantly with no external deps.
 *
 * Core invariant: each grant date is computed as addCalendarMonths(anchor, N),
 * NOT chained from the previous grant date.  Late processing never shifts
 * future anniversaries.
 *
 * Spec scenarios covered:
 *   ✓ Jan 31 → Feb 28 → Mar 31  (anchor-based, day restored when month allows)
 *   ✓ Mar 31 → Apr 30 → May 31
 *   ✓ grant due Aug 17, executed Sep 19 → next is Oct 17 (not Oct 19)
 *   ✓ compra 17 agosto → 17 septiembre → 17 octubre
 *   ✓ compra 1 agosto → 1 septiembre
 *   ✓ compra 31 enero → Feb 28/29 (non-leap / leap)
 *   ✓ cron corre dos veces mismo día → DB idempotency key guarantees 1 grant
 *   ✓ Founder con 11 grants → recibe #12
 *   ✓ Founder con 12 → no recibe #13
 *   ✓ null founderAnchorAt → no grant
 *   ✓ post-commit: founderMonthsGranted incremented → concurrent skip
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarMonths,
  addOneCalendarMonth,
  nextFounderGrantDate,
  isFounderGrantDue,
} from "../founder-grant.js";

// ── Helper ─────────────────────────────────────────────────────────────────────

/** Construct a Date at 04:00 local (matches cron run time). */
function d(year: number, month: number /* 1-based */, day: number): Date {
  return new Date(year, month - 1, day, 4, 0, 0, 0);
}

// ── addCalendarMonths ──────────────────────────────────────────────────────────

describe("addCalendarMonths", () => {

  // ── Spec case: Jan 31 → Feb 28 → Mar 31
  test("01 — Jan 31 anchor, n=1 → Feb 28 (non-leap 2025)", () => {
    const r = addCalendarMonths(d(2025, 1, 31), 1);
    assert.equal(r.getMonth() + 1, 2);
    assert.equal(r.getDate(), 28, "Feb has no 31st — clamp to 28");
  });

  test("02 — Jan 31 anchor, n=2 → Mar 31 (day restored, not 28!)", () => {
    const r = addCalendarMonths(d(2025, 1, 31), 2);
    assert.equal(r.getMonth() + 1, 3);
    assert.equal(r.getDate(), 31, "March has 31 days — original day restored from anchor");
  });

  test("03 — Jan 31 anchor, n=3 → Apr 30", () => {
    const r = addCalendarMonths(d(2025, 1, 31), 3);
    assert.equal(r.getMonth() + 1, 4);
    assert.equal(r.getDate(), 30);
  });

  test("04 — Jan 31 anchor, n=4 → May 31 (day restored)", () => {
    const r = addCalendarMonths(d(2025, 1, 31), 4);
    assert.equal(r.getMonth() + 1, 5);
    assert.equal(r.getDate(), 31);
  });

  // ── Spec case: Mar 31 → Apr 30 → May 31
  test("05 — Mar 31 anchor, n=1 → Apr 30", () => {
    const r = addCalendarMonths(d(2025, 3, 31), 1);
    assert.equal(r.getMonth() + 1, 4);
    assert.equal(r.getDate(), 30);
  });

  test("06 — Mar 31 anchor, n=2 → May 31 (day restored)", () => {
    const r = addCalendarMonths(d(2025, 3, 31), 2);
    assert.equal(r.getMonth() + 1, 5);
    assert.equal(r.getDate(), 31);
  });

  test("07 — Aug 17 anchor, n=1 → Sep 17", () => {
    const r = addCalendarMonths(d(2026, 8, 17), 1);
    assert.equal(r.getMonth() + 1, 9);
    assert.equal(r.getDate(), 17);
  });

  test("08 — Aug 17 anchor, n=2 → Oct 17", () => {
    const r = addCalendarMonths(d(2026, 8, 17), 2);
    assert.equal(r.getMonth() + 1, 10);
    assert.equal(r.getDate(), 17);
  });

  test("09 — Aug 1 anchor, n=1 → Sep 1", () => {
    const r = addCalendarMonths(d(2026, 8, 1), 1);
    assert.equal(r.getMonth() + 1, 9);
    assert.equal(r.getDate(), 1);
  });

  test("10 — Jan 31 anchor, n=1 → Feb 29 (leap year 2024)", () => {
    const r = addCalendarMonths(d(2024, 1, 31), 1);
    assert.equal(r.getMonth() + 1, 2);
    assert.equal(r.getDate(), 29, "2024 is a leap year — clamp to Feb 29");
  });

  test("11 — Dec 31 anchor, n=1 → Jan 31 next year", () => {
    const r = addCalendarMonths(d(2026, 12, 31), 1);
    assert.equal(r.getFullYear(), 2027);
    assert.equal(r.getMonth() + 1, 1);
    assert.equal(r.getDate(), 31);
  });

  test("12 — Nov 30 anchor, n=1 → Dec 30", () => {
    const r = addCalendarMonths(d(2026, 11, 30), 1);
    assert.equal(r.getMonth() + 1, 12);
    assert.equal(r.getDate(), 30);
  });

  test("13 — addOneCalendarMonth is identical to addCalendarMonths(d, 1)", () => {
    const anchor = d(2026, 8, 17);
    const a = addOneCalendarMonth(anchor);
    const b = addCalendarMonths(anchor, 1);
    assert.equal(a.getTime(), b.getTime());
  });

  // Full Jan-31 sequence across 5 months
  test("14 — Jan 31 full sequence: n=1..5 → Feb28 Mar31 Apr30 May31 Jun30", () => {
    const anchor = d(2025, 1, 31);
    const expected = [
      [2, 28],  // Feb (no 31st)
      [3, 31],  // Mar (has 31)
      [4, 30],  // Apr (no 31st)
      [5, 31],  // May (has 31)
      [6, 30],  // Jun (no 31st)
    ];
    for (let n = 1; n <= 5; n++) {
      const r = addCalendarMonths(anchor, n);
      const [expMonth, expDay] = expected[n - 1]!;
      assert.equal(r.getMonth() + 1, expMonth, `n=${n} month`);
      assert.equal(r.getDate(),       expDay,   `n=${n} day`);
    }
  });
});

// ── isFounderGrantDue / nextFounderGrantDate — anchor-based ───────────────────

describe("isFounderGrantDue (anchor-based)", () => {

  // ── compra 17 agosto → 17 septiembre → 17 octubre
  test("15 — anchor Aug 17, 1 grant done → due Sep 17", () => {
    assert.ok(isFounderGrantDue(d(2026, 8, 17), 1, d(2026, 9, 17)));
    assert.ok(!isFounderGrantDue(d(2026, 8, 17), 1, d(2026, 9, 16)), "one day before: not due");
  });

  test("16 — anchor Aug 17, 2 grants done → due Oct 17", () => {
    assert.ok(isFounderGrantDue(d(2026, 8, 17), 2, d(2026, 10, 17)));
    assert.ok(!isFounderGrantDue(d(2026, 8, 17), 2, d(2026, 10, 16)));
  });

  // ── Spec case: grant due Sep 17, executed Sep 19 → next is Oct 17 (not Oct 19)
  test("17 — late processing does NOT shift next anniversary", () => {
    const anchor = d(2026, 8, 17); // Aug 17 purchase
    // Grant #2 was due Sep 17 but executed Sep 19 (after downtime).
    // After that grant: founderMonthsGranted = 2.
    // Next grant (#3): addCalendarMonths(Aug 17, 2) = Oct 17.
    const nextGrantAt = nextFounderGrantDate(anchor, 2);
    assert.ok(nextGrantAt !== null);
    assert.equal(nextGrantAt!.getMonth() + 1, 10, "next is October (not November)");
    assert.equal(nextGrantAt!.getDate(),       17, "day stays 17 (not 19)");
    // On Oct 17: due
    assert.ok(isFounderGrantDue(anchor, 2, d(2026, 10, 17)));
    // On Oct 16: not due
    assert.ok(!isFounderGrantDue(anchor, 2, d(2026, 10, 16)));
  });

  // ── Jan 31 → Feb 28 → Mar 31 sequence
  test("18 — Jan 31 anchor: n=1 grant done → Feb 28 next", () => {
    const anchor = d(2025, 1, 31);
    assert.ok( isFounderGrantDue(anchor, 1, d(2025, 2, 28)));
    assert.ok(!isFounderGrantDue(anchor, 1, d(2025, 2, 27)));
  });

  test("19 — Jan 31 anchor: n=2 grants done → Mar 31 next (day restored from anchor)", () => {
    const anchor = d(2025, 1, 31);
    assert.ok( isFounderGrantDue(anchor, 2, d(2025, 3, 31)));
    assert.ok(!isFounderGrantDue(anchor, 2, d(2025, 3, 30)));
  });

  // ── Mar 31 → Apr 30 → May 31 sequence
  test("20 — Mar 31 anchor: n=1 grant done → Apr 30 next", () => {
    const anchor = d(2025, 3, 31);
    assert.ok( isFounderGrantDue(anchor, 1, d(2025, 4, 30)));
    assert.ok(!isFounderGrantDue(anchor, 1, d(2025, 4, 29)));
  });

  test("21 — Mar 31 anchor: n=2 grants done → May 31 next (restored)", () => {
    const anchor = d(2025, 3, 31);
    assert.ok( isFounderGrantDue(anchor, 2, d(2025, 5, 31)));
    assert.ok(!isFounderGrantDue(anchor, 2, d(2025, 5, 30)));
  });

  // ── Downtime self-heal: server back next day still grants
  test("22 — server back the day after anniversary → still grants", () => {
    const anchor = d(2026, 8, 17); // Aug 17
    // Grant #2 was due Sep 17; server was down; back Sep 18.
    assert.ok(isFounderGrantDue(anchor, 1, d(2026, 9, 18)));
  });

  // ── Max grant protection
  test("23 — 11 grants done → 12th is due on anniversary", () => {
    assert.ok(isFounderGrantDue(d(2026, 8, 17), 11, d(2027, 7, 17)));
  });

  test("24 — 12 grants done → no 13th ever", () => {
    assert.ok(!isFounderGrantDue(d(2026, 8, 17), 12, d(2027, 9, 17)));
    assert.ok(!isFounderGrantDue(d(2026, 8, 17), 13, d(2030, 1,  1)));
  });

  // ── Null anchor
  test("25 — null founderAnchorAt → never due (initial grant not yet set)", () => {
    assert.ok(!isFounderGrantDue(null, 0, d(2026, 9, 17)));
    assert.ok(!isFounderGrantDue(null, 1, d(2026, 9, 17)));
  });

  // ── Concurrent protection: after commit founderMonthsGranted = N+1 → next month
  test("26 — post-commit check: N+1 months → next anniversary is a full month away", () => {
    const anchor = d(2026, 8, 17);
    const now = d(2026, 9, 17); // Sep 17: Process 1 just committed grant #2
    // Process 2 re-reads founderMonthsGranted = 2 (updated by Process 1).
    // Next due date = addCalendarMonths(Aug 17, 2) = Oct 17 > now (Sep 17) → not due.
    assert.ok(!isFounderGrantDue(anchor, 2, now),
      "After Process 1 commits, Process 2 finds next anniversary is next month → skip");
  });

  // ── Idempotency note: if both processes read founderMonthsGranted=N before either commits,
  // both compute grantMonthNumber=N+1 and the same idempotency key.
  // The DB ON CONFLICT DO NOTHING on the invoiceCreditGrantsTable ensures exactly 1 grant.
  test("27 — isFounderGrantDue is deterministic (DB idempotency key handles dedup)", () => {
    const anchor = d(2026, 8, 17);
    const anniversary = d(2026, 9, 17);
    assert.ok(isFounderGrantDue(anchor, 1, anniversary));
    assert.ok(isFounderGrantDue(anchor, 1, anniversary)); // same result — DB key deduplicates
  });

  // ── Aug 1 purchase
  test("28 — Aug 1 anchor: n=1 → Sep 1 due, Aug 31 not due", () => {
    const anchor = d(2026, 8, 1);
    assert.ok( isFounderGrantDue(anchor, 1, d(2026, 9,  1)));
    assert.ok(!isFounderGrantDue(anchor, 1, d(2026, 8, 31)));
  });
});

// ── nextFounderGrantDate ───────────────────────────────────────────────────────

describe("nextFounderGrantDate", () => {
  test("29 — returns addCalendarMonths(anchor, N) for eligible subscriber", () => {
    const anchor = d(2026, 8, 17);
    const next = nextFounderGrantDate(anchor, 1);
    assert.ok(next !== null);
    assert.equal(next!.getMonth() + 1, 9);
    assert.equal(next!.getDate(), 17);
  });

  test("30 — returns null when max months reached", () => {
    assert.equal(nextFounderGrantDate(d(2026, 8, 17), 12), null);
  });

  test("31 — returns null when founderAnchorAt is null", () => {
    assert.equal(nextFounderGrantDate(null, 0), null);
    assert.equal(nextFounderGrantDate(null, 5), null);
  });

  test("32 — Jan 31 anchor, 1 grant done → Feb 28", () => {
    const next = nextFounderGrantDate(d(2025, 1, 31), 1);
    assert.ok(next !== null);
    assert.equal(next!.getMonth() + 1, 2);
    assert.equal(next!.getDate(), 28);
  });

  test("33 — Jan 31 anchor, 2 grants done → Mar 31", () => {
    const next = nextFounderGrantDate(d(2025, 1, 31), 2);
    assert.ok(next !== null);
    assert.equal(next!.getMonth() + 1, 3);
    assert.equal(next!.getDate(), 31);
  });
});
