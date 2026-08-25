---
name: Central strategic generation context
description: Durable rules for combining creator profile, own performance, market study, Radar and content history in generation.
---

The generation engine must treat the commercial offer and the user's objective as the highest-authority inputs. Audience, problems and goals come next; own-account and market evidence guide choices without proving causality; mechanisms and keywords only support vocabulary and angles. A mechanism such as an avatar or chatbot must not be promoted to a product unless the configured offer explicitly sells it.

**Why:** Flat prompt concatenation allowed statistical associations from keywords, competitor content or mechanisms to override the product the user actually configured.

**How to apply:** Build one versioned context for topic and script generation, pass it through manual, AutoPilot, regeneration and fallback paths, cap source excerpts, preserve userId scoping, and log source labels plus the selected version. Reject or repair outputs that invent products or promises; do not copy competitor content literally.
