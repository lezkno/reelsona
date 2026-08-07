---
    name: Per-avatar voice resolution
    description: How voice IDs are resolved per avatar look in ContentPilot — overrides map, scheduler precedence, UI sentinel.
    ---

    ## Rule
    Voice is resolved per avatar look, not globally. The DB column `voice_overrides` (json NOT NULL DEFAULT '{}') on `avatar_config` maps avatarId → voiceId.

    ## Resolution order in resolveVoiceId(avatarId)
    1. voiceOverrides[avatarId] if set and not the sentinel
    2. getAvatarDefaultVoiceId(avatarId) — HeyGen group's own default
    3. Legacy preferredVoiceId (if set and not sentinel) — backward compat
    4. null — caller must handle; no auto-pick

    ## UI Sentinel
    - Radix Select does NOT allow value="" for a selectable item — it's reserved for placeholder/clear state.
    - Use a non-empty sentinel string (e.g. "avatar_default") for the "Predeterminada de HeyGen" option.
    - On save: sentinel value → delete the key from the map; real voice ID → store in map.

    **Why:** Empty string as a SelectItem value in Radix Select is treated as unset/placeholder, so the "use default" option can never be selected by the user.

    **How to apply:** Any future voice selector using Radix Select with a "use default" option must use a non-empty sentinel string, not "".
    