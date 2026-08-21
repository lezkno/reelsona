---
name: libass Poppins font resolution
description: Fast V2 can load the bundled Poppins file yet select DejaVu Sans when ASS requests the Poppins family.
---

Do not assume `fontsdir` guarantees libass uses the CSS font family. In a controlled Fast V2 ASS render, `Fontname: Poppins` with bold selected DejaVu Sans Bold even though `Poppins-ExtraBold.ttf` was loaded from the bundled fonts directory; Caption Studio loads that TTF directly in CSS.

**Why:** CSS and libass therefore use different glyph metrics at the same canonical `font_size`, producing a visible caption-size mismatch without any resolution-scale bug.

**How to apply:** When calibrating or changing Fast V2 typography, capture FFmpeg verbose `fontselect` output and compare actual glyph bounding boxes against the Studio preview. Treat a scalar size multiplier only as a temporary calibration; verify font-family resolution first.