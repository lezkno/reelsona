import OpenAI from "openai";

/**
 * Build an OpenAI client using the centralized Replit AI Integrations proxy.
 * The proxy key is set via the AI_INTEGRATIONS_OPENAI_API_KEY env secret.
 *
 * Transient 408/409/429/5xx/network failures are retried by the OpenAI SDK.
 * Keep the retry count bounded so a failed provider cannot stall workers
 * indefinitely.
 */
export function makeOpenAIClient(opts?: { timeout?: number; maxRetries?: number }): OpenAI {
  const proxyKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const proxyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  if (proxyKey) {
    return new OpenAI({
      apiKey:  proxyKey,
      baseURL: proxyBase || undefined,
      timeout: opts?.timeout ?? 60_000,
      maxRetries: opts?.maxRetries ?? 3,
    });
  }

  throw new Error(
    "OpenAI API key no configurada en el sistema. Contacta al administrador.",
  );
}