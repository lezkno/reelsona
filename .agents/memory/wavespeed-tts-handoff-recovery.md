---
name: WaveSpeed TTS handoff recovery
description: Reliability rule for the two-stage TTS to talking-head video generation flow.
---

For a user-started WaveSpeed video, do not make the completed-TTS-to-talking-head handoff depend exclusively on the global scheduler. Use a narrowly scoped, restart-safe monitor that advances only jobs already accepted for that video, with an atomic ownership claim before submitting the talking-head prediction. If the talking-head request outcome is ambiguous after the claim, fail visibly rather than re-submitting it; WaveSpeed does not provide a provider-side idempotency key for this handoff.

**Why:** Development intentionally leaves global cron off to prevent unrequested billable automation. That must not leave a user-requested video permanently stuck after its TTS audio completes.

**How to apply:** Keep the normal scheduler as the production lifecycle owner. Any targeted recovery must resume only an existing TTS job, must tolerate scheduler races, and must never submit a second talking-head job for the same video. Continue the same monitor through local captions, copy, and idempotent credit settlement so a disabled development cron cannot strand the post-processing pipeline after a restart.