---
name: Instagram OAuth setup gotchas
description: Lessons from debugging "Invalid redirect_uri" in the Instagram Login for Business flow
---

# Instagram OAuth (Login for Business) gotchas

- **redirect_uri must be identical in 3 places**: the OAuth authorize URL, the token exchange call, and the Meta App Dashboard's "Valid OAuth Redirect URIs". The frontend derives it from `window.location.origin + "/connect"` and passes it to the backend as a query param — never let the backend deduce it from request headers (yields `localhost:<port>`).
- **"Invalid redirect_uri" can mean wrong client_id**: if the client_id belongs to a different Meta app than where the URIs are registered, Meta reports invalid redirect_uri, not invalid client. Verify the "Instagram App ID" in Dashboard → Instagram → Instagram Login for Business matches the INSTAGRAM_APP_ID secret. **Why:** the ID shown in the dashboard URL/app list is the Facebook App ID, a different number.
- Replit dev domain is temporary — the dev `/connect` URI must be re-registered in Meta if the domain changes; the published `.replit.app` URI is stable.
- OAuth must open via `window.open(url, '_blank')`; the Replit preview iframe blocks external navigation via `window.location.href`.
