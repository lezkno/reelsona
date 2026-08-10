---
name: Per-user OpenAI key
description: How user-owned OpenAI API keys are stored, exposed, and threaded through the AI pipeline.
---

## Rule
When a user configures their own OpenAI API key in Settings, all AI calls use that key directly (hitting OpenAI, no proxy). When absent, the shared platform key + proxy (AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY) is used.

**Why:** Cost isolation — power users pay on their own OpenAI account; the shared key is the system fallback.

## How to apply

### Client factory
`artifacts/api-server/src/lib/openai-client.ts` exports `makeOpenAIClient(userApiKey?, opts?)`.
- Pass user's key → direct OpenAI, no baseURL override.
- Pass nothing → env proxy path.

### DB + API surface
- `settings.openai_api_key` (text, nullable) — stores the raw key.
- `GET /api/settings` → `openai_api_key_set: boolean` (never expose raw key).
- `PUT /api/settings` → accepts `openai_api_key: string | null` (null clears it).
- `lib/api-zod` and `lib/api-client-react` generated schemas updated with these fields.

### Threading through AI libs
All 6 AI lib functions accept `openaiApiKey?: string | null`:
- `ai-scripts.ts`: all exported functions + internal `generateHookCandidates`.
- `ai-strategy.ts`: `synthesizeMarketStudy`, `generateContentStrategy` (in opts).
- `broll-engine.ts`: `applyBRoll` → `analyzeBRollSegments` → `analyzeScriptForBRoll`; `generateBRollImages`.
- `text-cards-engine.ts`: `applyTextCards` → `buildCardsFromMultiConfig` → `analyzeScriptForCards`.
- `caption-engine.ts`: `applyCaptions` options → `findPunchZoomTimestampsAI` → `analyzeScriptForZooms`; also threads to applyBRoll and applyTextCards.
- `brand-cover.ts`: `generateBrandCover` → `generateAICover`.

### Call sites
- `routes/strategy.ts`: loads `settingsRow.openaiApiKey` per request, passes to all AI calls.
- `lib/scheduler.ts` `runAutomationCycle`: settings already loaded, passes `settings.openaiApiKey` to `generateScript` and indirectly via applyCaptions opts.
- `lib/scheduler.ts` `runCaptionProcessing`: loads `captionSettings` separately (has `userId` but not main settings in scope); passes `captionSettings?.openaiApiKey`.

### UI
`OpenAIIntegrationCard` in `artifacts/content-pilot/src/pages/Settings.tsx` — placed after HeyGenIntegrationCard. Calls `updateSettings.mutate({ data: { openai_api_key: value } })`.
