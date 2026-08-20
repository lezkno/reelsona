---
name: Render Fast V2 caption templates
description: Preserves Caption Studio template typography when Fast V2 uses ASS instead of the Browser engine.
---

Render Fast V2 must derive its caption typography from the selected Browser
template (including that template's saved overrides) whenever the account uses
the Browser caption engine. The user-selected position remains an account-level
Caption Studio setting.

**Why:** Browser templates and ASS styles both use a 1920px video-height
reference, but the legacy caption-config fields can belong to a previously
selected template. Using those stale values makes Fast V2 captions visibly
smaller or otherwise mismatched after template rotation.

**How to apply:** When introducing another ASS-based rendering path, adapt the
active Browser template's font family, size, colours, words-per-line and
highlight behavior before rendering; do not apply an extra resolution scale.