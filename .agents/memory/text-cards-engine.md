---
name: Text Cards Engine
description: Hook/stat/CTA overlay cards composited onto video before caption burn.
---

## Rule: CanvasRenderingContext2D is DOM-only — use local Ctx interface

`CanvasRenderingContext2D` does not exist in Node.js TypeScript lib. Any file using @napi-rs/canvas for drawing must define its own minimal `interface Ctx { ... }` instead of referencing the DOM type.

**Why:** The tsconfig in api-server targets Node, not DOM. Helper functions `wrapText` and `roundedRect` that accept a canvas context must use this local type.

**How to apply:** Any new helper function that takes a canvas context → param type `Ctx`, not `CanvasRenderingContext2D`.

## Pipeline position

zoom → B-roll → **text cards** → caption burn

Both `caption-engine.ts` (step 4d) and `browser-caption-engine.ts` (step 3e) import `applyTextCards` dynamically after the B-roll step.

## Architecture

- GPT-4o-mini analyzes script → returns up to 3 cards: hook, stat, CTA
- Each card rendered as full-resolution RGBA PNG (transparent bg, card at bottom-middle)
- FFmpeg: `fade=alpha=1` on each PNG input, chained `overlay` operations
- Timing fractions: hook=0.06, stat=0.44, cta=0.81 of video duration
- Hold: 4s per card; graceful fallback returns source unchanged

## Card zone positioning

Cards rendered at `y = videoHeight * 0.54` (center of card), between avatar face and caption area. Scale factor = `videoWidth / 1080`.
