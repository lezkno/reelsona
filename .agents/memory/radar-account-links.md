---
name: Radar account links
description: Saved competitor links must always point to the Instagram profile page, never to media or profile-image URLs.
---

The radar account URL is a canonical profile-page URL derived from the normalized Instagram username. Apify's `profilePicUrl` is image media and must never populate the account link field.

**Why:** The saved-reference link opened an image/CDN destination instead of the competitor's Instagram account after enrichment replaced the profile URL.

**How to apply:** Keep profile-page URL generation separate from profile-image metadata in every create, sync, and background-enrichment path.