---
name: Canonical caption layout
description: Shared layout contract for Caption Studio previews and Render Fast V2/libass output.
---

Caption geometry has one source of truth: `font_size` is the 1920px-reference
ASS font size, `y_position` is the baseline percentage on a canonical
1080×1920 canvas, and `max_width_percent` is the caption block width. The
legacy horizontal margin is always derived from that width, never treated as a
competing layout control.

**Why:** Template defaults used to overwrite a user's saved font size in the
scheduler, while preview and final render could calculate width from separate
values. That made WYSIWYG editing unreliable.

**How to apply:** New caption UI or render paths must derive their geometry
from these fields with the shared caption-template layout helpers. A template
may seed first-use values and provide styling, but cannot overwrite persisted
layout at render time. The only permitted size exception is a deliberately
saved, per-template font-size override.