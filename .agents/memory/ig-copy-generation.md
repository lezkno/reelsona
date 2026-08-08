---
name: IG Copy generation step
description: How the automatic Instagram description + hashtags pipeline step works — DB column, scheduler triggers, recovery, and frontend step.
---

## The feature
After the video pipeline (HeyGen + Caption Studio) completes, `runCopyGeneration` auto-generates the Instagram description (caption) and hashtags using `regenerateCaption` from ai-scripts. Prompt enforces a hook first line, 3-5 sentences, and a mandatory CTA at the end.

## DB column
`content_plan_items.copy_status TEXT` — values: `null` (not started), `'generating'`, `'done'`, `'failed'`.  
Added via `ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS copy_status TEXT`.  
Existing items backfilled: `UPDATE … SET copy_status = 'done' WHERE caption IS NOT NULL`.

## Scheduler trigger points (`runCopyGeneration`)
1. Browser caption engine success (before `return;` — must be BEFORE return, not at end of function)
2. End of `runCaptionProcessing` (covers ASS/FFmpeg done + failed — fire-and-forget after the try/catch)
3. Captions disabled path in `processGeneratingVideos` (after setting `captionStatus = 'disabled'`)

**Why:** Each caption path has its own code path; the function-end trigger only catches ASS/FFmpeg. The browser engine path has an early `return` that bypasses it.

## Atomic claim pattern
```typescript
const claimed = await db.update(contentPlanItemsTable)
  .set({ copyStatus: "generating", updatedAt: new Date() })
  .where(and(eq(...id), isNull(...copyStatus)))
  .returning({ id: ... });
if (claimed.length === 0) return; // already started
```
Same pattern as video generation — prevents concurrent runs.

## Recovery sweep
In `pollAndPublishVideos`, a JOIN query finds `content_plan_items.status='ready'` with `copy_status IS NULL` where the joined video has terminal `caption_status`. Fires `runCopyGeneration` (fire-and-forget) for each.

## Frontend (PipelineTimeline)
New step key `"copy"`, new mode `"copy_generating"`. Step is always visible (no condition to hide it). `pickActiveItem` priority 3 = captions terminal + copy null/generating. Uses violet accent (same as review step) when active. Grid expanded to handle up to 6 columns.

## Auto-publish gate
Auto-publish must NOT fire before copy is done. Three-point fix:
1. `processGeneratingVideos`: skips direct auto-publish for plan-linked items (`noCopyPending = !video.contentPlanId`); lets `runCopyGeneration` fire it instead.
2. `pollAndPublishVideos` sweep: LEFT JOINs `content_plan_items` and adds `OR(contentPlanId IS NULL, copyStatus IN ('done','failed'))` guard.
3. `runCopyGeneration`: after try/catch, reads automation config and calls `publishVideoToInstagram` fire-and-forget if auto_publish on and video still ready.

**Why:** caption processing triggers copy fire-and-forget (~10s). Without the gate, the next scheduler minute-tick would auto-publish before copy finished, sending the post with no description.

## api-zod schemas
`copy_status` added to all 5 content item response Zod schemas in `lib/api-zod/src/generated/api.ts` and to the TypeScript type in `generated/types/contentPlanItem.ts`. Field added to `mapItem()` in `content.ts`.
