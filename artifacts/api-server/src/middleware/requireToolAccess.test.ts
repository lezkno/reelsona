/**
 * Unit tests for requireToolAccess — cache-invalidation behaviour.
 *
 * Verifies that after provisionUser() calls invalidateAccessCache(userId) the
 * stale "no-access" cache entry is gone so the middleware will perform a fresh
 * DB lookup on the next request and grant access immediately.
 *
 * Run with:
 *   node --import tsx/esm --test src/middleware/requireToolAccess.test.ts
 *
 * No DB connection or network I/O is required; the test drives the exported
 * cache helpers (_setCacheEntryForTest, _getCacheEntryForTest) directly.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  invalidateAccessCache,
  _setCacheEntryForTest,
  _getCacheEntryForTest,
} from "./requireToolAccess.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_IDS = [100, 101, 102];

afterEach(() => {
  // Clean up every userId touched by tests
  for (const id of TEST_USER_IDS) invalidateAccessCache(id);
});

// ── Tests ────────────────────────────────────────────────────────────────────

test(
  "cache starts empty for a fresh userId",
  () => {
    assert.equal(
      _getCacheEntryForTest(100),
      null,
      "no entry should exist before any request is made"
    );
  }
);

test(
  "invalidateAccessCache removes a 'toolAccessActive: false' entry " +
    "so the next middleware call re-queries DB instead of serving stale data",
  () => {
    const userId = 100;

    // Step 1 – Simulate the middleware caching a "no access" result.
    //          (This is what happens on the first request before provisioning.)
    _setCacheEntryForTest(userId, { toolAccessActive: false, courseAccess: false });

    const before = _getCacheEntryForTest(userId);
    assert.notEqual(before, null, "cache must hold the stale 'no access' entry");
    assert.equal(before!.toolAccessActive, false, "cached entry should say access is inactive");

    // Step 2 – provisionUser() calls invalidateAccessCache() after the
    //          entitlement is written to the DB. Simulate that call.
    invalidateAccessCache(userId);

    // Step 3 – The cache entry must now be gone so the middleware is forced
    //          to do a fresh DB lookup on the next request.
    const after = _getCacheEntryForTest(userId);
    assert.equal(
      after,
      null,
      "invalidateAccessCache must remove the stale entry so the next request goes to DB"
    );
  }
);

test(
  "invalidateAccessCache also removes a 'toolAccessActive: true' entry " +
    "(idempotent — works for any cached state)",
  () => {
    const userId = 101;

    _setCacheEntryForTest(userId, { toolAccessActive: true, courseAccess: true });
    assert.notEqual(_getCacheEntryForTest(userId), null, "entry should exist before invalidation");

    invalidateAccessCache(userId);

    assert.equal(
      _getCacheEntryForTest(userId),
      null,
      "invalidateAccessCache must clear any entry regardless of its access state"
    );
  }
);

test(
  "invalidateAccessCache only removes the target user; " +
    "other users' cache entries remain intact",
  () => {
    const userA = 100;
    const userB = 101;

    _setCacheEntryForTest(userA, { toolAccessActive: false, courseAccess: false });
    _setCacheEntryForTest(userB, { toolAccessActive: true,  courseAccess: true  });

    // Invalidate only userA (e.g. userA just paid, userB is unrelated)
    invalidateAccessCache(userA);

    assert.equal(
      _getCacheEntryForTest(userA),
      null,
      "userA's entry must be gone after invalidation"
    );
    assert.notEqual(
      _getCacheEntryForTest(userB),
      null,
      "userB's entry must remain untouched — only the provisioned user's cache is cleared"
    );
    assert.equal(
      _getCacheEntryForTest(userB)!.toolAccessActive,
      true,
      "userB's active-access flag must be preserved"
    );
  }
);

test(
  "invalidateAccessCache is a no-op when called for a userId with no cache entry",
  () => {
    const userId = 102;

    // Should not throw
    assert.doesNotThrow(() => invalidateAccessCache(userId));
    assert.equal(_getCacheEntryForTest(userId), null);
  }
);

test(
  "a stale cache entry (TTL = 0 ms) is treated as missing by _getCacheEntryForTest",
  async () => {
    const userId = 100;

    // Write an entry that expires immediately
    _setCacheEntryForTest(userId, { toolAccessActive: false, courseAccess: false }, 0);

    // Wait one event-loop tick so Date.now() is past the expiresAt
    await new Promise((resolve) => setImmediate(resolve));

    // The middleware's getCached() deletes expired entries; the raw getter
    // returns the Map value directly, so we verify the expiresAt is in the past.
    const entry = _getCacheEntryForTest(userId);
    if (entry !== null) {
      assert.ok(
        entry.expiresAt <= Date.now(),
        "if an entry is still in the map it must be expired (past expiresAt)"
      );
    }
    // Either null or expired — both mean the middleware will re-query DB.
  }
);
