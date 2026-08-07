---
name: Dimidium caption style
description: Implementation details and lessons for the Dimidium-style caption effect (word-by-word reveal + line stacking)
---

## Key behavior (from reference video analysis at 8fps)
- Each **SRT block = one display line** (NOT fixed wordsPerLine count)
- Words within a block appear **one by one** at their spoken timing, building the line progressively
- When a new SRT block starts → new line at bottom, previous lines push UP one slot
- Max **4 lines visible** simultaneously; line 5 pushes line 1 off screen

## Word classification
- **Small + white** (function): ONLY pronouns (they, he, she, i, we, you, me, my...), conjunctions (and, but, or, y, e, o...), and common qualifiers (more, most, very, just, also, too, even, only). Keep list SHORT.
- **Large + accent color** (emphasis): everything else — verbs, nouns, adjectives, adverbs, AND articles (the, a, el, la), prepositions (in, on, to, de, en...).
- **Why short list matters**: making the list too long (including verbs like "watch", "boost", "go") produces too many small/white words — the effect should be ~80% yellow.

## ASS rendering
- Alignment: `\an1` (bottom-left), `\pos(60, y)` — text grows rightward from left margin
- NOT center (`\an2`) — each line starts from the same left anchor
- Outline: 4px, shadow: 2px
- Large font: `config.fontSize` (e.g. 82pt), Small font: `fontSize * 0.56`
- Line spacing: `videoHeight * 0.085` (~163px at 1920)
- Bottom anchor: `videoHeight - 80`

## ASS dialogue structure
For each word state `(li, wi)` — generates up to 4 Dialogue entries:
- slot 0: `lineText(lines[li], 0..wi)` — current line in progress
- slot 1: `lineText(lines[li-1], complete)` — previous complete line
- slot 2: `lineText(lines[li-2], complete)`
- slot 3: `lineText(lines[li-3], complete)`

**Why:** This is the only correct way to do word-by-word reveal with line stacking in ASS — each "state" (interval between word appearances) gets a fresh set of Dialogue entries at the right positions.

## Font
- Poppins ExtraBold — downloaded to `artifacts/api-server/assets/fonts/Poppins-ExtraBold.ttf`
- resolveFontName maps "Poppins" → "Poppins ExtraBold" (the fc-scan family name)
- Natural casing preserved (no uppercase transform)

## Preview simulation
- `DIM_STATES` = flat list of `{li, wi}` pairs from `DIM_BLOCKS`
- `dimTick` advances with `setTimeout` (not `setInterval`) for variable speed: 520ms mid-line, 950ms at line end
- Render: oldest slot at top, newest at bottom (`[...slots].reverse()`)
- Alignment: `items-start`, `justify-start` (left-aligned in the preview container)
