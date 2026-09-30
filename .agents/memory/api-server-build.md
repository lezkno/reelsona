---
name: API Server build cycle
description: The api-server has NO hot-reload — TypeScript changes require a full workflow restart to take effect.
---

## Rule
Any edit to `artifacts/api-server/src/**` requires restarting the `artifacts/api-server: API Server` workflow to take effect. The dev command is `pnpm run build && pnpm run start` (esbuild compile then node). There is no file-watcher / hot-reload.

**Why:** The dev script runs `node ./build.mjs` (esbuild) then `node ./dist/index.mjs`. Without a restart the old compiled `dist/` is still served.

**How to apply:** After any backend change, always call `WorkflowsRestart` for `artifacts/api-server: API Server` and confirm the new log shows a clean start. Never assume changes are live without restarting.

## Conflict state can change during investigation
Recheck `git status` and the current conflict markers immediately before applying a conflict-resolution patch. A concurrent merge or reconciliation can change the working file between inspections.

**Why:** On 2026-09-30 an unresolved API scheduler file changed to a clean file during the same investigation, so a patch based on the earlier excerpt no longer matched.

**How to apply:** If the markers have disappeared, inspect the current diff and confirm which behavior remains before proceeding; do not replay a stale merge patch.

## `continue` inside nested blocks
esbuild will reject `continue` if it cannot statically verify the enclosing for-loop because TypeScript's structural analysis differs from esbuild's. Safe rule: only use `continue` at the top level of a `for` body. Use `return` when inside a nested `if/else` block inside the `for` body — since the scheduler processes one draft at a time (`.limit(1)`), `return` is semantically equivalent.
