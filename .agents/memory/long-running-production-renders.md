---
name: Long-running production renders
description: Deployment constraint for reliable background video post-production.
---

Video post-production runs as a long-lived background worker and must use an always-on VM deployment rather than autoscale.

**Why:** Autoscale instances can be interrupted when traffic drops. A renderer can lose its worker while retaining a processing lease, leaving the video awaiting recovery instead of producing a final file or terminal error.

**How to apply:** Before publishing render-pipeline changes, set the deployment type to VM / always-on in the Publishing settings. This target is selected in the Publishing UI, not by editing application or artifact configuration files. Keep render jobs bounded and terminal on timeout as an additional safeguard.