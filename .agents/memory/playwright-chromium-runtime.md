---
name: Playwright Chromium runtime
description: How browser tests start reliably in this Replit Nix environment.
---

Browser tests should use the Chromium runtime provided through `pkgs.chromium`,
discovered from `PATH` and supplied to Playwright through `launchOptions`.
Keep the normal Playwright browser as a fallback for environments where the
system executable is absent.

**Why:** The Chromium binary downloaded by Playwright does not inherit the Nix
library closure here, so it can fail before tests start with missing shared
libraries (for example, GLib or NSPR).

**How to apply:** When adding or changing Playwright configuration, resolve
`chromium` with `which` at runtime rather than hardcoding a Nix store path.
Put the resulting path in `use.launchOptions.executablePath`.