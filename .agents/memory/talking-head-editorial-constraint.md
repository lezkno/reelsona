---
name: Talking-head editorial constraint
description: Architecture of the avatar talking-head format restriction applied across all AI content generation in ContentPilot/Reelsona.
---

## Rule
All AI-generated topics and scripts must work with an avatar looking at camera (podcast/talking-head style). No screen sharing, no live software demos, no step-by-step visual tutorials.

## TALKING_HEAD_CONSTRAINT constant
Defined in `artifacts/api-server/src/lib/ai-scripts.ts` — injected into both `generateContentTopics` and `generateScript` prompts. Contains the full production format spec (what's available, what's prohibited, transformation examples, ideal formats list).

## Topic metadata fields (migration 005)
Four new columns on `content_plan_items`:
- `visual_dependency TEXT` — "low" | "medium" | "high"
- `format_fit_score REAL` — 0-100 talking-head fit score
- `suggested_visual_support TEXT` — JSON array (e.g. `["captions","punch text","zoom dramático"]`)
- `avatar_fit_reason TEXT` — 1-sentence reason why topic works/doesn't without screen

## Scoring penalties in scoreTopics()
- `visual_dependency === "high"` → -25 points
- `visual_dependency === "medium"` → -8 points
- `format_fit_score >= 80` → +8 bonus

## UI badge in ContentPlan.tsx
Green "Avatar ✓" (low) / amber "Avatar ~" (medium) / red "Avatar ⚠" (high) badge shown in the Viral Editorial Engine metadata row. Tooltip shows fit reason + suggested visual supports + fit score.

## ai-strategy.ts enforcement
`synthesizeMarketStudy` and `generateContentStrategy` prompts both explicitly exclude screen-dependent formats from `working_formats`, `editorial_angles`, and `pillars`.

**Why:** The production setup is HeyGen avatar → talking-head only. Topics requiring screen demos can't be produced and would result in broken/misleading content. The constraint must be in every generation path.

**How to apply:** When touching any AI prompt in this project, always inject `TALKING_HEAD_CONSTRAINT` if the output produces topics or scripts. When adding new insert sites for `ContentPlanTopicMeta`, always map the 4 new fields.
