---
name: api-client-react composite tsconfig
description: lib/api-client-react uses TypeScript composite mode — edits to src/ require a manual tsc rebuild before downstream packages see the updated types.
---

## Rule
After editing any file under `lib/api-client-react/src/generated/`, run:
```
cd lib/api-client-react && npx tsc -p tsconfig.json
```
to regenerate `dist/*.d.ts` before running `pnpm typecheck` in packages that depend on it.

**Why:** The package's `tsconfig.json` sets `composite: true` with `emitDeclarationOnly: true`, meaning TypeScript resolves types from the compiled `dist/` folder, not from `src/` directly. Any package that references it via `tsconfig.json` `references` will read stale declarations until the lib is rebuilt.

**How to apply:** Whenever updating `CaptionConfig`, `CaptionPreset`, `CaptionConfigInput`, or any other generated type in `lib/api-client-react/src/generated/`, always rebuild the lib immediately after. A failed typecheck with "Property X does not exist on type Y" from an api-client-react type is the telltale sign.
