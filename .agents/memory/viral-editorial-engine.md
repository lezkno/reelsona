---
name: Viral Editorial Engine
description: Architecture and key decisions for the editorial scoring system added in task #59.
---

# Viral Editorial Engine — Implementation notes

## Architecture

### EDITORIAL_BASE constant
- Lives in `artifacts/api-server/src/lib/ai-scripts.ts`
- Injected at the top of ALL prompts (topics, scripts, captions, hooks)
- Safety rules: no guaranteed results, no fabricated stats, no sensationalism, no clichés
- Penalty words trigger -30 score deduction: "garantizado", "cura", "secreto que ocultan", etc.

### generateContentTopics — new signature
- Accepts optional `auditInsights?: AuditInsights` 8th param (backwards compat — undefined safe)
- Returns `ContentPlanTopicMeta[]` with: viral_score, editorial_angle, audience_pain, share_reason, novelty_level, specific_promise
- After AI returns topics, `scoreTopics()` applies programmatic adjustments, then `balanceAngles()` ensures no 3+ consecutive same-angle topics

### generateScript — new signature
- Accepts optional 6th param `options?: { criterion?, auditInsights? }`
- 2-call flow: (1) `generateHookCandidates()` generates 3 hooks → `scoreHook()` picks winner, (2) full script generation using winning hook
- Returns `hook_candidates: string[]` and `hook_selection_reason: string` — stored on content_plan_items
- Fallback: if hook candidates fail, single-pass generation proceeds normally

### regenerateCaption — extended
- Now accepts optional `topCaptions?: string[]` (from audit cache)
- Hashtag tiers: 3-4 niche (<500K posts) + 4-5 medium (500K-5M) + 2-3 broad (>5M)

### regenerateScriptWithCriterion
- 5 criterion modes: educational, controversial, storytelling, sales, emotional
- Mapped to `CRITERION_EMPHASIS` record, injected as prompt instruction block

## Audit Cache
- Table: `instagram_audit_cache` — single row (truncate-on-write), 7-day TTL
- Helpers: `getLatestAuditCache()` / `saveAuditCache()` in `artifacts/api-server/src/lib/audit-cache.ts`
- Populated: `GET /instagram/audit` (non-blocking fire-and-forget)
- Consumed: content plan generation, script generation, caption regeneration, scheduler autofill

## DB columns added to content_plan_items
- viral_score (integer, nullable)
- editorial_angle (text, nullable)
- hook_candidates (text, nullable — JSON array string)
- hook_selection_reason (text, nullable)
- share_reason (text, nullable)
- audience_pain (text, nullable)
- novelty_level (text, nullable)

## New table: instagram_audit_cache
- id, recommended_topics text[], content_insights text, top_captions_json text (JSON string), avg_engagement real, best_posting_times text[], fetched_at timestamp, created_at timestamp

## New endpoint
- `POST /content/:id/regenerate` — body: `{ criterion: "educational"|"controversial"|"storytelling"|"sales"|"emotional" }`

## UI changes (ContentPlan.tsx)
- viral_score badge: green ≥70, amber 40-69, red <40
- editorial_angle chip: violet
- share_reason tooltip: blue "Compartible" badge
- Hook candidates panel in script review modal (collapsible, shows winner + alternatives)
- "Regenerar guion" dropdown per item (draft|scripted only) with 5 criterion options
- All wrapped in TooltipProvider

**Why:**
The audit was discarding IG engagement data. Prompts had no editorial constitution. Hooks were single-pass with no scoring. This change closes all three gaps.

**How to apply:**
- When touching ai-scripts.ts, preserve the EDITORIAL_BASE constant at top of all prompts
- New topics insert must store viral_score, editorial_angle, share_reason, audience_pain, novelty_level
- New script generation must store hook_candidates (JSON) and hook_selection_reason
- Audit cache is fire-and-forget (non-blocking saves); always handle null from getLatestAuditCache
