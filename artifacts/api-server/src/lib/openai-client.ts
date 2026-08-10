import OpenAI from "openai";

/**
 * Build an OpenAI client.
 *
 * Priority:
 *   1. User's own API key (stored in settings.openai_api_key) — hits OpenAI directly,
 *      bypassing the shared platform proxy.  The user bears the cost on their own account.
 *   2. Shared platform key — uses the AI Integrations proxy (AI_INTEGRATIONS_OPENAI_BASE_URL
 *      + AI_INTEGRATIONS_OPENAI_API_KEY).
 */
export function makeOpenAIClient(
  userApiKey?: string | null,
  opts?: { timeout?: number },
): OpenAI {
  const timeout = opts?.timeout ?? 60_000;
  if (userApiKey) {
    // User supplied their own key → go direct, no proxy
    return new OpenAI({ apiKey: userApiKey, timeout });
  }
  return new OpenAI({
    apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout,
  });
}
