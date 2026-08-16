-- ============================================================================
-- Migration 026: Look and voice-clone credit lifecycle columns
--
-- Adds look_id, voice_clone_id, and voice_clone_type to credit_ledger so that
-- reservations for additional looks (4th+) and additional voice clones (2nd+)
-- can be settled in the same idempotent reserve→consume/release lifecycle used
-- for video generation credits.
--
-- Safe to re-run: all statements use ADD COLUMN IF NOT EXISTS.
-- ============================================================================

ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS look_id INTEGER;
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS voice_clone_id INTEGER;
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS voice_clone_type VARCHAR(16);
