---
name: Wallet Credits Architecture
description: Phase 1 SaaS credit system — tables, lifecycle, integration points, constants, and invariants.
---

## Tables

**user_credits** (one row per user)
- `available_credits` — spendable balance
- `reserved_credits` — held for in-flight HeyGen jobs
- `total_consumed` — cumulative across all completed videos

**credit_ledger** (append-only audit log)
- `type` ∈ { provision | reserve | consume | release }
- `amount`: positive = credits added, negative = credits spent/held
- `balance_before/after` track `available_credits` only
- `video_id` → `videos.id` ON DELETE SET NULL
- `related_ledger_id` → id of the `reserve` entry (for consume/release rows, unenforced FK)

## Constants (artifacts/api-server/src/lib/credits.ts)

- `VIDEO_CREDIT_COST = 10` — credits per video generation
- `CREDITS_PER_DAY = 10` — credits granted per day of access on provision
- Example: 30-day user → 300 credits = 30 videos at 1/day

## Credit lifecycle per video

```
hasEnoughCredits() → reserveCredits()   [before HeyGen call]
                  → consumeVideoCredits()  [on status → ready]
                  → releaseVideoCredits()  [on any failure/timeout/orphan]
```

All operations are idempotent (checked via `related_ledger_id` before any consume/release).

## Integration points in scheduler.ts

- **After atomic claim**, before video row: credit check; if fail → reset item to 'scripted' (not 'failed')
- **After video row created**: `reserveCredits()`
- **In catch block** (HeyGen submission error): `releaseVideoCredits()`
- **Orphan recovery** (generating, no heygenVideoId, >5 min): mark failed → release, reset item to 'scripted'
- **Timeout handler**: `releaseVideoCredits()` before `continue`
- **HeyGen status=failed**: `releaseVideoCredits()`
- **HeyGen HTTP permanent errors** (401, 402): `releaseVideoCredits()`
- **HeyGen status=completed**: `consumeVideoCredits()`
- Admin users (`role='admin'`) bypass ALL credit checks and reserves.

## Provision recovery (webhook hardening)

- `purchases.provisioned_at` stamps when `provisionUser()` completed.
- Webhook sets it only after confirmed success; leaves it NULL on failure.
- `pollAndPublishVideos()` (runs every minute) finds purchases with `provisioned_at IS NULL` and `created_at < 30 min ago` and retries provision.
- `provisionUser()` now calls `provisionCredits(userId, toolAccessDays * 10, ...)` — credits accumulate on re-provision.

## Why credit check does NOT mark item as 'failed'

If a user runs out of credits mid-schedule, their scripted items must not become permanently failed. Resetting to 'scripted' lets the automation cycle retry them automatically when the user tops up.

## Migration

`lib/db/migrations/021_wallet_credits.sql` — applied 2026-08-13.
Bootstraps existing active users with `remaining_days * 10` credits (min 10).
Marks existing completed purchases as provisioned.
