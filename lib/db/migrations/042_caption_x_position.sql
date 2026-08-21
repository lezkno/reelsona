-- Caption Studio V2: persist the horizontal center of the caption block.
-- Keep this migration immutable; seed.ts retains IF NOT EXISTS only for legacy
-- compatibility on databases upgraded outside the normal migration runner.
ALTER TABLE caption_config
  ADD COLUMN IF NOT EXISTS x_position REAL NOT NULL DEFAULT 50;