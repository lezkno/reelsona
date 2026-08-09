/**
 * Integration test: provisionUser() → cache invalidation.
 *
 * Verifies that after provisionUser() runs, the in-memory access cache no
 * longer holds a stale "no-access" entry for that user, so the middleware will
 * perform a fresh DB lookup on the very next request instead of waiting for
 * the 90-second TTL to expire.
 *
 * This test exercises the real provisionUser() function against the
 * development database. If the invalidateAccessCache() call is removed or
 * misplaced inside provision.ts, the assertion on line ~58 will fail.
 *
 * Run with:
 *   node --import tsx/esm --test src/lib/provision.test.ts
 *
 * Cleanup: every test-created row is deleted in the `after` hook.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { users, userEntitlements } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import { provisionUser } from "./provision.js";
import {
  _setCacheEntryForTest,
  _getCacheEntryForTest,
  invalidateAccessCache,
} from "../middleware/requireToolAccess.js";

// ── Shared state ──────────────────────────────────────────────────────────────

// Unique email per test-run so parallel/re-runs don't conflict.
const TEST_EMAIL = `test-provision-cache-${Date.now()}@example.invalid`;
let createdUserId: number | null = null;

// ── Teardown ──────────────────────────────────────────────────────────────────

after(async () => {
  if (createdUserId !== null) {
    invalidateAccessCache(createdUserId);
    await db
      .delete(userEntitlements)
      .where(eq(userEntitlements.userId, createdUserId));
    await db.delete(users).where(eq(users.id, createdUserId));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test(
  "provisionUser() invalidates a stale 'no-access' cache entry so the " +
    "next middleware request re-queries DB and grants access immediately",
  async () => {
    // Step 1 – Provision the user for the first time to get a stable userId.
    //          (Email delivery may fail in the dev environment; that's fine —
    //          provisionUser() handles it gracefully with a warning.)
    const firstResult = await provisionUser({
      email: TEST_EMAIL,
      name:  "Test Provision Cache User",
      toolAccessDays: 30,
      source: "test",
    });

    createdUserId = firstResult.userId;
    assert.ok(createdUserId > 0, "provisionUser must return a valid userId");

    // Step 2 – Simulate the cache state a real user experiences:
    //          the middleware previously ran and cached toolAccessActive=false
    //          (e.g. the first page load happened before payment was confirmed).
    _setCacheEntryForTest(createdUserId, {
      toolAccessActive: false,
      courseAccess:     false,
    });

    const staleEntry = _getCacheEntryForTest(createdUserId);
    assert.notEqual(staleEntry, null, "stale cache entry must exist before re-provisioning");
    assert.equal(staleEntry!.toolAccessActive, false, "stale entry must show no access");

    // Step 3 – Stripe webhook arrives → provisionUser() is called again.
    //          This is the moment under test: does it clear the cache?
    await provisionUser({
      email: TEST_EMAIL,
      name:  "Test Provision Cache User",
      toolAccessDays: 30,
      source: "stripe-webhook-test",
    });

    // Step 4 – The stale cache entry must be gone.
    //          The next middleware call will therefore hit DB and return 200.
    const entryAfter = _getCacheEntryForTest(createdUserId);
    assert.equal(
      entryAfter,
      null,
      "provisionUser() must invalidate the access cache so the next request " +
        "picks up the new entitlement from DB without waiting for the 90-second TTL"
    );
  }
);
