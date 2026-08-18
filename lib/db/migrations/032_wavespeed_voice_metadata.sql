-- 032_wavespeed_voice_metadata.sql
-- Reconcile WaveSpeed voice columns used by the active Drizzle schema/routes but
-- missing from the original 023/024 SQL migrations. Safe to re-run.

ALTER TABLE wavespeed_voices
  ADD COLUMN IF NOT EXISTS source_audio_object_name TEXT,
  ADD COLUMN IF NOT EXISTS preview_audio_url TEXT;
