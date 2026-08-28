---
name: Plan-limit integration testing
description: Process-local plan caching affects tests that mutate subscription rows directly while an API server is running.
---

The API plan cache is process-local, so changing a subscription row directly from a separate integration-test process does not refresh the running server's cached plan. Test HTTP downgrade guards against the server's initial cached plan, and test restoration either through the real plan-change flow or with the same-process plan helper.

**Why:** A direct database update appeared not to restore a persona even though the database row was correct; the running API process still held the previous plan for its cache TTL.

**How to apply:** When an integration fixture changes subscription data behind a running API, invalidate through the application flow or restart the server before asserting the new plan. Do not weaken the production cache solely to accommodate tests.