---
name: Video Express audio compatibility
description: Browser recording containers and authoritative duration validation for Video Express.
---

For Video Express, select a browser-supported audio MIME type, normalize invalid recorder MIME values to audio/webm, and name the upload with its matching container extension. Display microphone-recording duration from the wall clock captured at stop time; validate the upload duration only after FFmpeg converts it to WAV, rather than trusting source-container metadata.

**Why:** Browser WebM/Opus recordings can play and decode successfully while missing duration metadata that FFprobe can read directly. Their `HTMLMediaElement.duration` can also include encoder/container padding, making a short recording look much longer. Embedded Chromium can report an invalid recorder MIME type.

**How to apply:** Keep the 2–180 second guard on the normalized WAV duration and use the shared client helpers whenever adding another browser-recorded Video Express input. Do not display raw `HTMLMediaElement.duration` as the time recorded from the microphone. Three minutes is the chosen product limit: enough room for context while keeping instructions focused and reliable to transcribe.