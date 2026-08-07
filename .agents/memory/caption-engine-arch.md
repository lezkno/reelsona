---
name: Caption engine architecture
description: How the Caption Studio pipeline works end-to-end in ContentPilot.
---

## Pipeline

1. `generateVideo()` in `heygen.ts` — when `captionsEnabled: true`, passes `caption: { file_format: "srt" }` to HeyGen v3 (no `style` = HeyGen does NOT burn captions, just returns SRT URL)
2. `pollAndPublishVideos()` in `scheduler.ts` — when video completes, `status.subtitle_url` is available
3. `applyCaptions(videoUrl, script, style, { subtitleUrl, videoDurationSeconds })` in `caption-engine.ts`:
   - Downloads source video to `/tmp/contentpilot-captioned/in_<id>.mp4`
   - Downloads SRT from `subtitle_url` (word-level timing from HeyGen TTS)
   - Falls back to `generateBasicSRT(script, durationMs)` if no subtitle_url
   - Converts SRT → ASS with Caption Studio style (colors, font, karaoke `\kf` tags)
   - Runs `ffmpeg -vf ass=<file>.ass` to burn captions
   - Returns public URL: `https://${REPLIT_DEV_DOMAIN}/api/captioned/<filename>`
4. Route `GET /api/captioned/:filename` in `routes/captioned.ts` — serves MP4 with Range support

## Storage

- Captioned videos live in `/tmp/contentpilot-captioned/` (ephemeral across restarts)
- Files are only needed until Instagram upload completes — no permanent storage required
- `captionedVideoUrl` in DB stores the public URL; `captionStatus` tracks: `disabled | processing | done | failed`

## ASS styling

- Font: `DejaVu Sans` (Montserrat/Inter fallback), `DejaVu Serif` (Georgia fallback)
- Karaoke word highlighting: `\kf<cs>` tags in ASS dialogue, duration distributed proportionally by character count
- Position → ASS alignment: top=8, center=5, bottom=2
- Background: `rgba()` CSS → ASS `&HAABBGGRR` (CSS alpha inverted)
- BorderStyle 3 (opaque box) when `backgroundColor` is set, else 1 (outline)

**Why FFmpeg/libass not HeyGen native captions:** HeyGen v3 `CaptionStyle` only has `"default"` — no color/font control. Caption Studio needs custom styling per preset (Bold Impact, Neon, Fire, Minimal, Cinematic).
