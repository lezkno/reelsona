-- B-roll credit charging: discriminate B-roll image reservations from the
-- video's own generation reservation when both share the same video_id.
--
--   feature = NULL     — legacy rows / video generation / look / voice
--   feature = 'broll'  — per-image B-roll reservation (2 credits each)
--
-- Video settle lookups (consume/release by video_id) must exclude
-- feature = 'broll' so a B-roll reservation can never be settled as the
-- video's main reservation (and vice versa).

ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS feature VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_feature_video
  ON credit_ledger (video_id, feature) WHERE feature IS NOT NULL;
