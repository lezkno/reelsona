---
name: Production API outage diagnosis
description: How to distinguish a published API process failure from an authentication or database-record problem.
---

The published static frontend may continue returning HTTP 200 while the API artifact is unavailable. A generic plain-text HTTP 500 from `/api/healthz`, `/api/auth/me`, and even an empty login request means the API service is not being reached; it is not evidence of a bad password or a user-specific account error.

**Why:** A production outage showed the API process exiting after its PostgreSQL scheduler-leader connection was terminated, while the frontend remained accessible. The deployment metadata could still report a successful build.

**How to apply:** Test the static root and `/api/healthz` separately, inspect deployment runtime logs for process exits/crash loops, and verify database connectivity independently before investigating user credentials or auth rows.