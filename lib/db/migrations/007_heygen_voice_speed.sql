-- Add configurable voice speed for HeyGen TTS (null = use HeyGen default 1.0)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS heygen_voice_speed REAL;
