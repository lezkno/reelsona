---
name: Centralized avatar and voice policy
description: Durable guardrails for the central HeyGen catalog and per-user WaveSpeed assets.
---

HeyGen is a central public catalog only: user-facing clients must not expose BYOK, private avatar/look creation, or private voice management. Historical backend endpoints may remain solely as explicit 403 defenses for old clients. WaveSpeed persona, look, and voice mutations must include the owning userId whenever owner context exists.

**Why:** The product intentionally separates shared Reelsona-managed HeyGen resources from private per-user WaveSpeed resources; an ID-only mutation or leftover client hook can undermine that boundary.

**How to apply:** When changing avatars, voices, scheduler pollers, or generated client hooks, add static regressions covering both the visible client surface and every internal owner-scoped mutation.