---
name: Voice failure notifications
description: How voice clone failure emails are wired — onVoiceFailed callback pattern and inline WaveSpeed path.
---

# Voice failure notifications

**Rule:** When a cloned voice transitions to "failed" (either explicitly or via timeout), the user receives an email. Without this they never know why their personas stopped generating videos.

**Why:** Users have no other way to discover a failed voice clone. The UI shows the status but users don't visit Avatars constantly. Silent failure → confusion about missing videos.

**How to apply:**
- HeyGen poller (`runVoicePollerCycle`): the injectable `VoicePollerDeps` interface now has an `onVoiceFailed?: (voice: { id, userId }) => Promise<void>` callback alongside `onVoiceReady`. Both the "failed" branch and the "timeout" branch call `deps.onVoiceFailed`.
- Production wrapper (`pollPendingClonedVoices`): wires `onVoiceFailed` with a `sendEmail` call ("Tu voz clonada no pudo procesarse…").
- WaveSpeed poller (`pollPendingWavespeedVoices`): inline email send in both the "failed" branch and the timeout branch (no injectable pattern — handled directly).
