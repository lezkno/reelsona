---
name: Caption templates library
description: Browser caption templates — current set, special rendering modes, and engine features.
---

## Current templates (lib/caption-templates/src/templates.ts)

10 templates total:
- `authority_bold` — Oswald 700, white+yellow, 4 words
- `viral_stack` — Oswald 700, 2 words, zoom animation
- `clean_coach` — Oswald 700, teal accent, 5 words
- `hot_box` — red box background, 3 words
- `neon_glow` — Bangers, cyan glow shadow
- `dimidium_mix` — Poppins 800 95px, mixed mode, buildingMode:true, 5 words/block
- `bold_stack` — Poppins 800, stackWords:true, 2 words vertical
- `zoom_in` — Oswald 700 150px, all yellow #FFE600, 1 word/time, zoom animation
- `bangers_comic` — Bangers 400, 1 word, pink #FF3366
- `clean_coach` (also listed above)

## Special rendering modes (lib/caption-templates/src/types.ts)

- `stackWords?: boolean` — each word on its own line (Bold Stack)
- `buildingMode?: boolean` — words accumulate one-by-one within a block; uses `buildBuildingCues` in renderer.ts instead of `buildCaptionCues`; each cue = 1 word spoken, block size = `wordsPerLine`
- `highlightMode: "mixed"` — function words at 55% size + primaryColor, content words full size + activeWordColor; uses BROWSER_FUNCTION_WORDS set
- `animation: "zoom"` — generates 3 scale sub-frames (0.65→0.82→1.0) per new word window in video render; zoomScale param on renderCueFrame applies ctx.scale() around (videoW/2, baselineY)
- `animation: "typewriter"` — char-by-char reveal in CSS preview; word-by-word sub-frames in video render when window changes

## Engine features (artifacts/api-server/src/lib/browser-caption-engine.ts)

- `buildBuildingCues` exported from renderer.ts — one cue per word, showing accumulation from block start
- `renderCueFrame(canvas, template, cue, w, h, revealedWords?, zoomScale?)` — optional zoomScale 0–1 applies canvas transform
- Zoom sub-frames: triggered when `template.animation === "zoom" && isNewWindow`; 3 steps over min(180ms, 40% of cueDur)
- Building mode skips typewriter sub-frames (each word already has its own cue)
- Diagnostic endpoint: GET /api/captions/browser/preview-frame?templateId=X&words=A,B,C
- Recaption endpoint: POST /api/videos/:id/recaption {template_id} — fetches HeyGen SRT live, fire-and-forget render

## subtitle_url persistence gap

HeyGen's subtitle_url is NOT stored in the videos table — it's fetched live on each recaption call. Task #52 tracks adding the column. Until then, the recaption endpoint calls getVideoStatus() on every request.

## backgroundMode values

"none" | "word" | "active_word" | "line" — "line" draws a rounded-rect behind each text line before words are drawn.

## Overflow auto-scale

measureWords() in renderCueFrame detects if widest word > availableW and scales effectiveFontSize down proportionally so long words never overflow.
