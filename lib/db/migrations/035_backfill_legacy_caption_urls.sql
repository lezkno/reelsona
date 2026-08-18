-- Historical captioned videos created before APP_URL hardening stored a temporary
-- *.replit.dev / *.replit.app host. Preserve the object path and move only the
-- origin to the canonical production domain so existing captioned videos work.

UPDATE videos
SET captioned_video_url = regexp_replace(
      captioned_video_url,
      '^https://[^/]+',
      'https://reelsona.com'
    ),
    updated_at = NOW()
WHERE captioned_video_url ~ '^https://[^/]+\.(replit\.dev|replit\.app)/';
