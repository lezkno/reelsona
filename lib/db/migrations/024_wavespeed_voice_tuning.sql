-- Add speed and pitch tuning columns to wavespeed_voices.
-- speed: TTS playback rate multiplier passed to minimax/speech-2.6-turbo. NULL = default (1.0). Range: 0.5–1.5.
-- pitch: Voice pitch shift in semitones passed to minimax/speech-2.6-turbo. NULL = default (0). Range: -12 to +12.
ALTER TABLE wavespeed_voices
  ADD COLUMN IF NOT EXISTS speed real,
  ADD COLUMN IF NOT EXISTS pitch real;
