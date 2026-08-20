---
name: Object Storage worker URLs
description: How background video workers read media while browser URLs remain private.
---

Browser-facing `/api/captioned-objects/` URLs require an authenticated session and cannot be downloaded by server-side caption workers. Resolve those proxy URLs to short-lived signed Object Storage URLs before a worker reads source video or subtitle media; leave external provider URLs unchanged.

**Why:** Rendering workers have no browser cookies, so fetching their own protected proxy returned HTTP 401 and made Caption Studio appear as “Omitido (error)” even though the source video existed.

**How to apply:** Use the shared server-readable media URL helper for every worker-side media download, including both standard and browser caption engines.