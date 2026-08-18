-- 031_wavespeed_voice_id_immutable.sql
-- WaveSpeed custom_voice_id is chosen before the clone job is submitted and is
-- the permanent identifier used by TTS once the job becomes ready. Protect it
-- from accidental overwrites (for example from prediction outputs[0]).

CREATE OR REPLACE FUNCTION preserve_wavespeed_voice_id()
RETURNS trigger AS $$
BEGIN
  IF OLD.wavespeed_voice_id IS NOT NULL
     AND NEW.wavespeed_voice_id IS DISTINCT FROM OLD.wavespeed_voice_id THEN
    NEW.wavespeed_voice_id := OLD.wavespeed_voice_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_preserve_wavespeed_voice_id ON wavespeed_voices;
CREATE TRIGGER trg_preserve_wavespeed_voice_id
BEFORE UPDATE OF wavespeed_voice_id ON wavespeed_voices
FOR EACH ROW
EXECUTE FUNCTION preserve_wavespeed_voice_id();
