---
name: libass font pinning
description: Fast V2 must isolate and name the exact bundled Canvas TTF for libass, then verify selection with FFmpeg logs.
---

Do not assume a shared `fontsdir` guarantees libass uses the CSS font family. Fast V2 has to stage just the intended bundled Canvas TTF in its temporary render directory and set its concrete ASS face name. This applies to Poppins ExtraBold, Oswald, Bangers Regular, and Montserrat Black.

**Why:** libass/fontconfig can select a system font or a sibling bundled face when given a generic family. Canvas registers a known file directly, so mismatched resolution produces a caption-size mismatch even when the persisted `font_size` and video resolution are correct.

**How to apply:** When changing Fast V2 typography, capture FFmpeg debug `Loading font file` plus `fontselect` output and compare actual glyph bounding boxes against Canvas. A staged-file checksum is useful evidence. Do not add a scalar size multiplier until font selection is proven; ASS and Canvas can still have independent raster-metric differences after the same TTF is selected.