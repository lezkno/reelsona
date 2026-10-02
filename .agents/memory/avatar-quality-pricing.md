---
name: Avatar quality tiers & reel pricing
description: Users pick Estándar (InfiniteTalk, 50 cr/30 s) or Premium (WAN 3.0 480p, 1.5 cr per WAN second, scene-aware); pricing math lives in reel-pricing.ts.
---

## Rule
- `settings.avatar_quality` (default `standard`) + optional per-reel `content_plan_items.avatar_quality` (migration 043). Resolution: reel → account → standard (`resolveAvatarQuality`). Premium only for WaveSpeed avatars and while `isWan3Enabled()`; otherwise standard.
- Credits (`reel-pricing.ts`, re-exported by credits.ts): standard = 50 per 30 s (words/2.5), min 15; premium = ceil(1.5 × Σ WAN segment durations) with the SAME segmentation the pipeline submits, min 15. Reserved at start, consumed on success, released on failure.
- The TTS job payload carries `avatarQuality`; the handoff uses WAN only for `premium` (missing flag = legacy in-flight reel → WAN).
- UI: `AvatarQualityPicker` in Settings (default) and in the "Aprobar y generar" modal (per reel, live credits from `content-pilot/src/lib/reel-credits.ts`, which mirrors the server — a parity test in reel-pricing.test.ts guards it).

## Why (Oct 2026 cost study)
WaveSpeed bills WAN 3.0 per REQUESTED second (USD 0.05 @480p, 0.10 @720p; account has −5 %); reference audio is NOT billed. InfiniteTalk 0.03/s @480p. USD/credit: Basic 0.0725, Pro 0.0647, top-ups ~0.06, Founder ~0.039. At 720p WAN lost money on every plan → premium defaults to 480p (`WAN3_RESOLUTION`). Margins after Stripe: premium ~55 % Basic / ~49 % Pro / ~15 % Founder; standard ~75 % / ~72 % / ~53 %.

## Cost savers
- WAN `duration` per segment = real TTS speech + 1.2 s (never above the word estimate) — `wan3DurationForSpoken`.
- A failed WAN segment is resubmitted ONCE (`wan-retry` lease, atomic claim); a second failure ends the reel.
