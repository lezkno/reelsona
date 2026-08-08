-- Migration: Phase 1 Production Safety columns
-- Run this on any existing production database before deploying this release.
-- All columns are additive (nullable or with defaults) — no data is modified.
-- The development database was already updated via `pnpm --filter @workspace/db run push`.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS poll_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generating_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ig_container_id   TEXT;
