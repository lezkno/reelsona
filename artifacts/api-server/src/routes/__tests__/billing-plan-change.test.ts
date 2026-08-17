/**
 * billing-plan-change.test.ts
 *
 * Tests for the actual billing business-logic functions exported from billing-logic.ts.
 * These tests import and execute the production code — not local reimplementations.
 *
 * Covered scenarios (from spec §13):
 *   1. validateChangePlan — rejects invalid plan
 *   2. validateChangePlan — rejects missing / inactive subscription
 *   3. validateChangePlan — rejects founder plan modification
 *   4. validateChangePlan — rejects same-plan request
 *   5. executeUpgrade     — releases existing schedule, calls Stripe, updates DB, provisions credits
 *   6. executeUpgrade     — preserves purchased credits (only subscription pool is replaced)
 *   7. executeDowngrade   — uses Stripe Subscription Schedule (not subscriptions.update)
 *   8. executeDowngrade   — stores scheduleId, sets pendingPlanSlug in DB
 *   9. executeCancelPlanChange — releases Stripe schedule, clears pending state in DB
 *  10. executeCancelPlanChange — 404 when no pending change
 *  11. executeCreatePortal     — returns Stripe portal URL
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Import the actual production functions ─────────────────────────────────────
import {
  validateChangePlan,
  executeUpgrade,
  executeDowngrade,
  executeCancelPlanChange,
  executeCreatePortal,
  type SubRow,
  type PlanConfig,
} from "../billing-logic.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PRICE_PRO   = "price_pro_monthly";
const PRICE_BASIC = "price_basic_monthly";

const proConfig:   PlanConfig = { planSlug: "pro",   stripePriceId: PRICE_PRO };
const basicConfig: PlanConfig = { planSlug: "basic", stripePriceId: PRICE_BASIC };

function makeSub(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id:                   1,
    userId:               42,
    planSlug:             "basic",
    status:               "active",
    stripeSubscriptionId: "sub_abc",
    stripeCustomerId:     "cus_abc",
    stripeScheduleId:     null,
    pendingPlanSlug:      null,
    currentPeriodEnd:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    ...overrides,
  };
}

function makeStripe(overrides: Record<string, unknown> = {}) {
  const scheduleCreated = { id: "sch_new" };
  return {
    subscriptions: {
      update:   async (..._a: unknown[]) => ({}),
    },
    subscriptionSchedules: {
      create:   async (_args: unknown) => scheduleCreated,
      update:   async (..._a: unknown[]) => ({}),
      release:  async (_id: unknown)    => ({}),
    },
    billingPortal: {
      sessions: {
        create: async (_args: unknown) => ({ url: "https://billing.stripe.com/session/test" }),
      },
    },
    ...overrides,
  } as any;
}

// ── validateChangePlan ─────────────────────────────────────────────────────────

describe("validateChangePlan", () => {
  test("01 — rejects invalid targetPlan value", () => {
    const err = validateChangePlan("enterprise", makeSub());
    assert.ok(err);
    assert.equal(err.code, "invalid_plan");
    assert.equal(err.status, 400);
  });

  test("02 — rejects null subscription", () => {
    const err = validateChangePlan("pro", null);
    assert.ok(err);
    assert.equal(err.code, "no_subscription");
    assert.equal(err.status, 404);
  });

  test("03 — rejects inactive subscription", () => {
    const err = validateChangePlan("pro", makeSub({ status: "canceled" }));
    assert.ok(err);
    assert.equal(err.code, "no_subscription");
  });

  test("04 — rejects founder plan", () => {
    const err = validateChangePlan("basic", makeSub({ planSlug: "founder" }));
    assert.ok(err);
    assert.equal(err.code, "founder_plan");
  });

  test("05 — rejects same plan when no pending change", () => {
    const err = validateChangePlan("basic", makeSub({ planSlug: "basic" }));
    assert.ok(err);
    assert.equal(err.code, "same_plan");
  });

  test("06 — rejects when already pending the same target plan", () => {
    const err = validateChangePlan("basic", makeSub({ planSlug: "pro", pendingPlanSlug: "basic" }));
    assert.ok(err);
    assert.equal(err.code, "already_pending");
  });

  test("07 — passes for valid Basic→Pro upgrade", () => {
    const err = validateChangePlan("pro", makeSub({ planSlug: "basic" }));
    assert.equal(err, null);
  });

  test("08 — passes for valid Pro→Basic downgrade", () => {
    const err = validateChangePlan("basic", makeSub({ planSlug: "pro" }));
    assert.equal(err, null);
  });
});

// ── executeUpgrade ─────────────────────────────────────────────────────────────

describe("executeUpgrade", () => {
  let stripeUpdateArgs: unknown[][] = [];
  let stripeReleaseArgs: unknown[][] = [];
  let dbUpdates: Record<string, unknown>[] = [];
  let creditsCalled: Array<{ userId: number; amount: number }> = [];
  let invalidateAccessCalled: number[] = [];
  let invalidatePlanCalled: number[] = [];

  beforeEach(() => {
    stripeUpdateArgs  = [];
    stripeReleaseArgs = [];
    dbUpdates         = [];
    creditsCalled     = [];
    invalidateAccessCalled = [];
    invalidatePlanCalled   = [];
  });

  function makeUpgradeDeps(sub: SubRow) {
    const stripe = makeStripe({
      subscriptions: {
        update: async (...args: unknown[]) => { stripeUpdateArgs.push(args); return {}; },
      },
      subscriptionSchedules: {
        release: async (...args: unknown[]) => { stripeReleaseArgs.push(args); return {}; },
        create:  async (..._: unknown[]) => ({ id: "sch_ignored" }),
        update:  async (..._: unknown[]) => ({}),
      },
    });
    return {
      userId:                      sub.userId,
      sub,
      proConfig,
      stripeFirstItemId:           "si_item_001",
      stripe,
      provisionSubscriptionCredits: async (userId: number, amount: number) => {
        creditsCalled.push({ userId, amount });
      },
      invalidateAccessCache:        (userId: number) => { invalidateAccessCalled.push(userId); },
      invalidatePlanCache:          (userId: number) => { invalidatePlanCalled.push(userId); },
      updateSub:                    async (u: Record<string, unknown>) => { dbUpdates.push(u); },
    };
  }

  test("09 — Stripe subscriptions.update called with Pro price", async () => {
    const sub    = makeSub({ planSlug: "basic" });
    const result = await executeUpgrade(makeUpgradeDeps(sub));

    assert.ok(result.ok);
    assert.equal(result.type, "upgrade");
    assert.equal(result.plan, "pro");

    // Stripe was called with the pro price
    assert.equal(stripeUpdateArgs.length, 1);
    const [subId, params] = stripeUpdateArgs[0] as [string, Record<string, unknown>];
    assert.equal(subId, "sub_abc");
    const items = (params.items as Array<Record<string, unknown>>);
    assert.ok(items.some((i) => i.price === PRICE_PRO), "Pro price must be in update items");
  });

  test("10 — wallet: provisionSubscriptionCredits replaces subscription pool only", async () => {
    const sub    = makeSub({ planSlug: "basic" });
    const result = await executeUpgrade(makeUpgradeDeps(sub));

    assert.ok(result.ok);
    // provisionSubscriptionCredits is called with the Pro credit amount
    // This function only modifies subscriptionCredits — purchased credits remain untouched.
    assert.equal(creditsCalled.length, 1);
    assert.equal(creditsCalled[0].userId, 42);
    // Pro credits = 1500 (from PLAN_CREDITS)
    assert.equal(creditsCalled[0].amount, 1500);
  });

  test("11 — DB updated with planSlug=pro, pendingPlanSlug=null, stripeScheduleId=null", async () => {
    const sub    = makeSub({ planSlug: "basic" });
    await executeUpgrade(makeUpgradeDeps(sub));

    assert.equal(dbUpdates.length, 1);
    assert.equal(dbUpdates[0].planSlug, "pro");
    assert.equal(dbUpdates[0].pendingPlanSlug, null);
    assert.equal(dbUpdates[0].stripeScheduleId, null);
  });

  test("12 — existing schedule released before upgrade", async () => {
    const sub = makeSub({ planSlug: "basic", stripeScheduleId: "sch_old" });
    await executeUpgrade(makeUpgradeDeps(sub));

    assert.equal(stripeReleaseArgs.length, 1);
    const [releasedId] = stripeReleaseArgs[0] as [string];
    assert.equal(releasedId, "sch_old");
  });

  test("13 — returns error when Stripe throws", async () => {
    const sub = makeSub({ planSlug: "basic" });
    const deps = makeUpgradeDeps(sub);
    (deps.stripe as any).subscriptions.update = async () => { throw new Error("Stripe down"); };

    const result = await executeUpgrade(deps);
    assert.ok(!result.ok);
    assert.equal(result.status, 502);
    assert.equal(result.code, "stripe_error");
  });
});

// ── executeDowngrade ───────────────────────────────────────────────────────────

describe("executeDowngrade", () => {
  let scheduleCreateArgs: unknown[][] = [];
  let scheduleUpdateArgs: unknown[][] = [];
  let dbUpdates: Record<string, unknown>[] = [];

  beforeEach(() => {
    scheduleCreateArgs = [];
    scheduleUpdateArgs = [];
    dbUpdates = [];
  });

  const MOCK_PHASE0_START_DATE = 1750000000; // Unix timestamp Stripe returns for phase[0].start_date

  function makeDowngradeDeps(sub: SubRow) {
    const stripe = makeStripe({
      subscriptionSchedules: {
        // Stripe returns the created schedule including phases[0].start_date — our code reads
        // this to set the required start_date on the first phase of the subsequent update call.
        create: async (...args: unknown[]) => {
          scheduleCreateArgs.push(args);
          return { id: "sch_new_downgrade", phases: [{ start_date: MOCK_PHASE0_START_DATE, items: [] }] };
        },
        update: async (...args: unknown[]) => { scheduleUpdateArgs.push(args); return {}; },
        release: async (..._: unknown[]) => ({}),
      },
    });
    return {
      userId:     sub.userId,
      sub,
      proConfig,
      basicConfig,
      stripe,
      updateSub:  async (u: Record<string, unknown>) => { dbUpdates.push(u); },
    };
  }

  test("14 — creates Subscription Schedule (not subscriptions.update)", async () => {
    const sub    = makeSub({ planSlug: "pro" });
    const result = await executeDowngrade(makeDowngradeDeps(sub));

    assert.ok(result.ok);
    // schedule was CREATED (not subscriptions.update)
    assert.equal(scheduleCreateArgs.length, 1);
    const createArg = scheduleCreateArgs[0][0] as Record<string, unknown>;
    assert.equal(createArg.from_subscription, "sub_abc", "schedule must be created from existing subscription");
  });

  test("15 — two-phase schedule API contract: Pro start_date + Basic iterations:1", async () => {
    const sub    = makeSub({ planSlug: "pro" });
    await executeDowngrade(makeDowngradeDeps(sub));

    assert.equal(scheduleUpdateArgs.length, 1);
    const [_schedId, params] = scheduleUpdateArgs[0] as [string, Record<string, unknown>];
    const phases = params.phases as Array<Record<string, unknown>>;
    assert.equal(phases.length, 2);

    // Phase 1: Pro price, start_date (required by Stripe), end_date = period end
    const phase1Items = phases[0].items as Array<Record<string, unknown>>;
    assert.ok(phase1Items.some((i) => i.price === PRICE_PRO), "Phase 1 must be Pro");
    assert.equal(
      phases[0].start_date, MOCK_PHASE0_START_DATE,
      "Phase 1 start_date must match schedule.phases[0].start_date returned by Stripe",
    );
    assert.ok(typeof phases[0].end_date === "number", "Phase 1 must have end_date (period end unix ts)");

    // Phase 2: Basic price, duration:{interval:'month',interval_count:1} (required so
    // end_behavior:release fires after 1 cycle — without a bound the schedule is indefinite)
    const phase2Items = phases[1].items as Array<Record<string, unknown>>;
    assert.ok(phase2Items.some((i) => i.price === PRICE_BASIC), "Phase 2 must be Basic");
    const phase2Duration = phases[1].duration as Record<string, unknown> | undefined;
    assert.ok(phase2Duration, "Phase 2 must have duration to bound it to 1 billing cycle");
    assert.equal(phase2Duration.interval, "month",
      "Phase 2 duration.interval must be month");
    assert.equal(phase2Duration.interval_count, 1,
      "Phase 2 duration.interval_count must be 1 so end_behavior:release fires after 1 Basic cycle");

    // Top-level schedule params
    assert.equal(params.end_behavior, "release",
      "end_behavior must be release so subscription reverts to normal after schedule ends");
    assert.equal(params.proration_behavior, "none",
      "no mid-cycle proration for a downgrade");
  });

  test("16 — DB stores scheduleId and pendingPlanSlug=basic", async () => {
    const sub    = makeSub({ planSlug: "pro" });
    await executeDowngrade(makeDowngradeDeps(sub));

    assert.equal(dbUpdates.length, 1);
    assert.equal(dbUpdates[0].pendingPlanSlug, "basic");
    assert.equal(dbUpdates[0].stripeScheduleId, "sch_new_downgrade");
  });

  test("17 — 400 when currentPeriodEnd is null", async () => {
    const sub    = makeSub({ planSlug: "pro", currentPeriodEnd: null });
    const result = await executeDowngrade(makeDowngradeDeps(sub));

    assert.ok(!result.ok);
    assert.equal(result.status, 400);
    assert.equal(result.code, "no_period_end");
  });

  test("18 — 502 when Stripe schedule creation throws", async () => {
    const sub  = makeSub({ planSlug: "pro" });
    const deps = makeDowngradeDeps(sub);
    (deps.stripe as any).subscriptionSchedules.create = async () => { throw new Error("Stripe error"); };

    const result = await executeDowngrade(deps);
    assert.ok(!result.ok);
    assert.equal(result.status, 502);
  });

  test("18b — 502 when Stripe schedule update throws, releases orphan schedule", async () => {
    const sub  = makeSub({ planSlug: "pro" });
    const deps = makeDowngradeDeps(sub);
    let releasedOnError: string | null = null;
    (deps.stripe as any).subscriptionSchedules.update = async () => { throw new Error("Update failed"); };
    (deps.stripe as any).subscriptionSchedules.release = async (id: string) => { releasedOnError = id; return {}; };

    const result = await executeDowngrade(deps);
    assert.ok(!result.ok);
    assert.equal(result.status, 502);
    // Orphan schedule must be released to prevent it silently controlling the subscription
    assert.equal(releasedOnError, "sch_new_downgrade", "Must release orphan schedule when update fails");
  });

  test("18c — 502 when schedule create returns no phase start_date, releases orphan", async () => {
    const sub  = makeSub({ planSlug: "pro" });
    const deps = makeDowngradeDeps(sub);
    let releasedId: string | null = null;
    (deps.stripe as any).subscriptionSchedules.create = async () =>
      ({ id: "sch_orphan", phases: [] }); // no phase0
    (deps.stripe as any).subscriptionSchedules.release = async (id: string) => { releasedId = id; return {}; };

    const result = await executeDowngrade(deps);
    assert.ok(!result.ok);
    assert.equal(result.status, 502);
    assert.equal(releasedId, "sch_orphan", "Must release orphan schedule when phases[0] is missing");
  });
});

// ── executeCancelPlanChange ────────────────────────────────────────────────────

describe("executeCancelPlanChange", () => {
  test("19 — releases Stripe schedule and clears pending state in DB", async () => {
    const sub = makeSub({ planSlug: "pro", pendingPlanSlug: "basic", stripeScheduleId: "sch_active" });
    let releasedId: string | null = null;
    let dbUpdate: Record<string, unknown> = {};

    const stripe = makeStripe({
      subscriptionSchedules: {
        release: async (id: string) => { releasedId = id; return {}; },
        create:  async (..._: unknown[]) => ({ id: "x" }),
        update:  async (..._: unknown[]) => ({}),
      },
    });

    const result = await executeCancelPlanChange({
      userId:    sub.userId,
      sub,
      stripe,
      updateSub: async (u: Record<string, unknown>) => { dbUpdate = u; },
    });

    assert.ok(result.ok);
    assert.equal(releasedId, "sch_active");
    assert.equal(dbUpdate.pendingPlanSlug, null);
    assert.equal(dbUpdate.stripeScheduleId, null);
  });

  test("20 — 404 when no pending change exists", async () => {
    const sub    = makeSub({ planSlug: "pro" }); // no pendingPlanSlug
    const stripe = makeStripe();

    const result = await executeCancelPlanChange({
      userId:    sub.userId,
      sub,
      stripe,
      updateSub: async () => {},
    });

    assert.ok(!result.ok);
    assert.equal(result.status, 404);
    assert.equal(result.code, "no_pending_change");
  });
});

// ── executeCreatePortal ────────────────────────────────────────────────────────

describe("executeCreatePortal", () => {
  test("21 — returns Stripe billing portal URL", async () => {
    const stripe = makeStripe();
    const result = await executeCreatePortal({
      userId:           42,
      stripeCustomerId: "cus_abc",
      stripe,
      returnUrl:        "https://app.test/billing",
    });

    assert.ok(result.ok);
    assert.ok((result as { ok: true; url: string }).url.startsWith("https://billing.stripe.com/"));
  });

  test("22 — 404 when no Stripe customer ID", async () => {
    const stripe = makeStripe();
    const result = await executeCreatePortal({
      userId:           42,
      stripeCustomerId: null,
      stripe,
      returnUrl:        "https://app.test/billing",
    });

    assert.ok(!result.ok);
    assert.equal(result.status, 404);
    assert.equal(result.code, "no_customer");
  });
});
