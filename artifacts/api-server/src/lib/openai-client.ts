import OpenAI from "openai";

/**
 * Build an OpenAI client using the centralized Replit AI Integrations proxy.
 * The proxy key is set via the AI_INTEGRATIONS_OPENAI_API_KEY env secret.
 * Throws if the key is not configured.
 */
export function makeOpenAIClient(opts?: { timeout?: number }): OpenAI {
  const proxyKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const proxyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  if (proxyKey) {
    return new OpenAI({
      apiKey:  proxyKey,
      baseURL: proxyBase || undefined,
      timeout: opts?.timeout ?? 60_000,
    });
  }

  throw new Error(
    "OpenAI API key no configurada en el sistema. Contacta al administrador.",
  );
}
