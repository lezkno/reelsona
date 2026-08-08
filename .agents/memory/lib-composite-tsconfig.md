---
name: lib/* composite tsconfig pattern
description: All shared libs (api-client-react, db, api-zod) use composite:true + emitDeclarationOnly; TypeScript consumers read dist/, not src/.
---

## Rule
After editing **any** file in `lib/api-client-react/src/`, `lib/db/src/`, or `lib/api-zod/src/`, run `tsc -p tsconfig.json` inside that lib directory **before** running typecheck on api-server or content-pilot. Otherwise consumers see stale dist/*.d.ts and report "property does not exist" on types you just added.

**Why:** All three libs have `composite: true` + `emitDeclarationOnly: true` + `outDir: "dist"`. TypeScript resolution follows `exports` → `./dist/index.js` → `./dist/index.d.ts`. The source TypeScript is never read by consumers directly.

**How to apply:**
1. Edit lib source file(s).
2. `cd lib/<name> && npx tsc -p tsconfig.json` — no output = success.
3. Repeat for each affected lib (e.g. api-zod and api-client-react if you added a field to the API schema).
4. Then run `pnpm --filter @workspace/api-server run typecheck` and `pnpm --filter @workspace/content-pilot run typecheck`.

**Affected libs (as of Aug 2026):**
- `lib/db` — Drizzle schema; `$inferSelect`/`$inferInsert` types come from dist.
- `lib/api-zod` — Zod route schemas; inferred request/response body types come from dist.
- `lib/api-client-react` — React Query hooks + TypeScript interfaces; all come from dist.

**Note:** `lib/caption-templates` is intentionally source-only (no compile step, `noEmit: true`). Both Vite and esbuild consume its TypeScript directly. No rebuild needed for that lib.
