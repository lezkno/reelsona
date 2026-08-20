---
name: Video Express audio compatibility
description: Browser recording containers and authoritative duration validation for Video Express.
---

For Video Express, select a browser-supported audio MIME type, normalize invalid recorder MIME values to audio/webm, and name the upload with its matching container extension. Validate duration only after FFmpeg converts the upload to WAV, rather than trusting source-container metadata.

**Why:** Browser WebM/Opus recordings can play and decode successfully while missing duration metadata that FFprobe can read directly. Embedded Chromium can also report an invalid recorder MIME type.

**How to apply:** Keep the 2–180 second guard on the normalized WAV duration and use the shared client helpers whenever adding another browser-recorded Video Express input. Three minutes is the chosen product limit: enough room for context while keeping instructions focused and reliable to transcribe.