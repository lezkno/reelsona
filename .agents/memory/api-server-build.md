---
name: API Server build cycle
description: The api-server has NO hot-reload — TypeScript changes require a full workflow restart to take effect.
---

## Rule
Any edit to `artifacts/api-server/src/**` requires restarting the `artifacts/api-server: API Server` workflow to take effect. The dev command is `pnpm run build && pnpm run start` (esbuild compile then node). There is no file-watcher / hot-reload.

**Why:** The dev script runs `node ./build.mjs` (esbuild) then `node ./dist/index.mjs`. Without a restart the old compiled `dist/` is still served.

**How to apply:** After any backend change, always call `WorkflowsRestart` for `artifacts/api-server: API Server` and confirm the new log shows a clean start. Never assume changes are live without restarting.

## `continue` inside nested blocks
esbuild will reject `continue` if it cannot statically verify the enclosing for-loop because TypeScript's structural analysis differs from esbuild's. Safe rule: only use `continue` at the top level of a `for` body. Use `return` when inside a nested `if/else` block inside the `for` body — since the scheduler processes one draft at a time (`.limit(1)`), `return` is semantically equivalent.
