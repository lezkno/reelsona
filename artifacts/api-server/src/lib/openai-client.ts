import OpenAI from "openai";

/**
 * Build an OpenAI client using the user's own API key.
 * Throws if no key is provided — there is no shared system fallback.
 */
export function makeOpenAIClient(
  userApiKey?: string | null,
  opts?: { timeout?: number },
): OpenAI {
  if (!userApiKey) {
    throw new Error("Configura tu API Key de OpenAI en Configuración para usar esta función.");
  }
  return new OpenAI({ apiKey: userApiKey, timeout: opts?.timeout ?? 60_000 });
}
