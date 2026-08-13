---
name: HeyGen v3 voice parameters
description: How to control voice speed and pitch in HeyGen v3 video generation — top-level params are rejected; SSML is the only mechanism.
---

# HeyGen v3 Voice Parameters

## The Rule

HeyGen v3 (`POST /v3/videos`) rejects ALL of these as "Extra inputs are not permitted":
- `voice_speed` (top-level)
- `voice` (nested object)
- `speed`, `rate`, `voice_setting` (any variant)

The only way to control voice speed and pitch is **SSML `<prosody>` tags in the `script` field**.

**Why:** Confirmed by live API testing — every param variant returns `{ code: "invalid_parameter", message: "Extra inputs are not permitted", param: "<name>" }`. SSML passes validation (error advances to `avatar_not_found`), confirming HeyGen parses SSML in the script.

## How to Apply

```typescript
// Speed: multiplier 0.5–1.5 → SSML rate as percentage offset from 1.0
// speed=1.2 → rate="+20%", speed=0.8 → rate="-20%"
// Pitch: percentage -50…+50 → SSML pitch offset
// pitch=10 → pitch="+10%", pitch=-20 → pitch="-20%"

function wrapWithProsody(script, speed, pitch) {
  const hasSpeed = speed != null && Math.abs(speed - 1.0) > 0.01;
  const hasPitch = pitch != null && Math.abs(pitch) > 0.5;
  if (!hasSpeed && !hasPitch) return script;
  
  const attrs = [];
  if (hasSpeed) {
    const pct = Math.round((speed - 1) * 100);
    attrs.push(`rate="${pct >= 0 ? "+" : ""}${pct}%"`);
  }
  if (hasPitch) {
    const p = Math.round(pitch);
    attrs.push(`pitch="${p >= 0 ? "+" : ""}${p}%"`);
  }
  // Must XML-escape the script body
  const safe = script.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<speak><prosody ${attrs.join(" ")}>${safe}</prosody></speak>`;
}
```

## Storage

- Speed: `heygen_cloned_voices.speed` (real, range 0.5–1.5, null = default)
- Pitch: `heygen_cloned_voices.pitch` (real, range -50 to +50 %, null/0 = default)
- Scheduler reads both and passes as `voiceSpeed`/`voicePitch` to `generateVideo()`
- `generateVideo()` calls `wrapWithProsody()` before building the v3 payload

## Other v3 Voice Controls

No other voice-level controls exist in v3. The `expressiveness` field controls avatar expressiveness (not voice tone). For improving cloned voice quality, the only real levers are:
1. Better training audio (longer, cleaner recording)
2. Speed adjustment via SSML rate
3. Pitch adjustment via SSML pitch
