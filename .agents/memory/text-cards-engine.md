---
name: Text Cards deferred
description: Product decision to keep hook/stat/CTA text-card overlays out of the active product.
---

## Rule

Text-card overlays are deferred and must not be exposed, loaded by the frontend, shown in tool summaries, or activated by persisted settings.

**Why:** The creator explicitly decided that this feature is not currently being implemented; legacy settings must not make it reappear or affect a future video.

**How to apply:** Treat `text_cards` as disabled when resolving effects. Do not add a control, preview, pipeline step, or visible status for it unless the product decision changes.

