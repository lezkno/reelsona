---
name: Publishing playback visibility
description: Video library playback is blocked while Instagram publication is in progress.
---

A video must remain in the publishing state with a blocking spinner while Instagram processes it; the library exposes playback only after publication reaches the terminal `published` state, with cancelled originals as the deliberate exception.

**Why:** Automatic publishing can have a source URL before Instagram finishes, which made an unplayable in-flight video appear complete.

**How to apply:** Gate preview controls on the video status, not merely on the presence of a URL, and keep publishing status visually active.