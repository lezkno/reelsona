-- Migration 023: WaveSpeed foundation tables
-- Adds the base infrastructure for the WaveSpeed AI video pipeline alongside
-- the existing HeyGen flow. HeyGen tables and behavior are NOT modified.
--
-- Tables added:
--   wavespeed_personas — AI persona identities (replaces HeyGen avatar groups)
--   wavespeed_looks    — per-persona looks / reference images
--   wavespeed_voices   — cloned voices (minimax/voice-clone jobs)
--   wavespeed_jobs     — generic async inference job tracker

CREATE TABLE IF NOT EXISTS wavespeed_personas (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wavespeed_personas_user
  ON wavespeed_personas (user_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wavespeed_looks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona_id  INTEGER REFERENCES wavespeed_personas(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  image_url   TEXT,
  config      TEXT,          -- JSON blob for extra model params
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wavespeed_looks_user
  ON wavespeed_looks (user_id);
CREATE INDEX IF NOT EXISTS idx_wavespeed_looks_persona
  ON wavespeed_looks (persona_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wavespeed_voices (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona_id           INTEGER REFERENCES wavespeed_personas(id) ON DELETE SET NULL,
  display_name         TEXT NOT NULL,
  wavespeed_request_id TEXT,            -- id returned by the clone job
  wavespeed_voice_id   TEXT,            -- resolved voice id once clone is ready
  status               TEXT NOT NULL DEFAULT 'pending', -- pending | ready | failed
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wavespeed_voices_user
  ON wavespeed_voices (user_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wavespeed_jobs (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model                TEXT NOT NULL,   -- e.g. "wavespeed-ai/infinitetalk-fast"
  status               TEXT NOT NULL DEFAULT 'queued', -- queued | processing | completed | failed
  wavespeed_request_id TEXT,
  input_payload        TEXT,            -- JSON: inputs sent to WaveSpeed
  output_url           TEXT,            -- primary output asset URL
  output_payload       TEXT,            -- JSON: full outputs object from WaveSpeed
  error_message        TEXT,
  related_video_id     INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wavespeed_jobs_user
  ON wavespeed_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_wavespeed_jobs_request
  ON wavespeed_jobs (wavespeed_request_id);
CREATE INDEX IF NOT EXISTS idx_wavespeed_jobs_status
  ON wavespeed_jobs (status);
