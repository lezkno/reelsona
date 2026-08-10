---
name: Multi-card config format
description: MultiCardConfig v2 replaced the legacy single SavedCardTemplate; how to detect, migrate, and process each format.
---

## Rule
`applyTextCards` accepts `MultiCardConfig | SavedCardTemplate | undefined`. Detect which format with `"version" in cardConfig` — only `MultiCardConfig` has a `version` field.

**Why:** The old single-card format stored one `{ type, useAi, text?, headline?, subtext? }`. The new format (`version: 2`) stores three independent slots (`hook`, `stat`, `cta`), each with an `enabled` flag. Both must work because old users have the legacy format in the DB.

## How to apply
- **Engine** (`applyTextCards`): `if "version" in cardConfig` → call `buildCardsFromMultiConfig`; `else` → legacy path (or full-AI if no config).
- **Frontend load** (`CaptionStudio.tsx`): Check `ct.version === 2`; if not, migrate: wrap the single legacy card into the matching slot with `enabled: true`.
- **DB column**: `cardTemplate: json().$type<MultiCardConfig | SavedCardTemplate | null>()` — no migration needed, it's JSONB.
- **AI per slot**: `buildCardsFromMultiConfig` collects `aiTypes[]` for slots where `useAi: true`, calls `analyzeScriptForCards` once, filters by type. Manual slots are built directly via `buildSlotCard`.
- **Caption suppression**: `applyTextCards` returns `cardWindows[]`; `browser-caption-engine` filters caption segments that overlap any card window before compositing.
