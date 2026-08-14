/**
 * WaveSpeed API client
 *
 * Thin wrapper around the WaveSpeed inference API.
 * All calls are async/polled — WaveSpeed returns a request_id immediately;
 * callers must poll getJobStatus() until status is "completed" or "failed".
 *
 * Supported models (current phase):
 *   wavespeed-ai/infinitetalk-fast       — talking-head video generation
 *   minimax/speech-2.6-turbo             — text-to-speech synthesis
 *   minimax/voice-clone                  — voice cloning from audio
 *   bytedance/seedream-v5.0-pro/edit     — image editing / composition
 */

const WAVESPEED_BASE = "https://api.wavespeed.ai";

// ── Model registry ─────────────────────────────────────────────────────────────

export const WAVESPEED_MODELS = {
  /** Talking-head video: image + audio → video */
  TALKING_HEAD: "wavespeed-ai/infinitetalk-fast",
  /** Text-to-speech with a cloned or preset voice */
  SPEECH: "minimax/speech-2.6-turbo",
  /** Voice cloning from a reference audio file */
  VOICE_CLONE: "minimax/voice-clone",
  /** Image editing / composition */
  IMAGE_EDIT: "bytedance/seedream-v5.0-pro/edit",
} as const;

export type WavespeedModel = (typeof WAVESPEED_MODELS)[keyof typeof WAVESPEED_MODELS];

// ── Config helpers ─────────────────────────────────────────────────────────────

/** Returns true when the API key is present in the environment. */
export function isWavespeedConfigured(): boolean {
  return !!process.env.WAVESPEED_API_KEY;
}

function getApiKey(): string {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error("WAVESPEED_API_KEY is not configured");
  return key;
}

// ── Core HTTP ──────────────────────────────────────────────────────────────────

interface WavespeedResponse<T> {
  data: T;
  message?: string;
}

async function wavespeedFetch<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  apiKey?: string,
): Promise<T> {
  const key = apiKey ?? getApiKey();
  const res = await fetch(`${WAVESPEED_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WaveSpeed ${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  let json: WavespeedResponse<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`WaveSpeed ${method} ${path} → non-JSON response: ${text.slice(0, 200)}`);
  }
  return json.data;
}

// ── Job types ──────────────────────────────────────────────────────────────────

export interface WavespeedJobResult {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  outputs?: Record<string, unknown>;
  error?: string;
}

// ── Generic job submission & polling ─────────────────────────────────────────

/**
 * Submit an inference job to a WaveSpeed model.
 * Returns the request id for polling.
 */
export async function submitJob(
  model: WavespeedModel,
  inputs: Record<string, unknown>,
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  const result = await wavespeedFetch<WavespeedJobResult>(
    "POST",
    `/api/v3/${model}`,
    inputs,
    apiKey,
  );
  return { requestId: result.id, status: result.status };
}

/**
 * Poll the status of a previously submitted job.
 */
export async function getJobStatus(
  requestId: string,
  apiKey?: string,
): Promise<WavespeedJobResult> {
  return wavespeedFetch<WavespeedJobResult>(
    "GET",
    `/api/v3/outputs/${requestId}`,
    undefined,
    apiKey,
  );
}

// ── Model-specific helpers ────────────────────────────────────────────────────

/**
 * Submit a talking-head video job (wavespeed-ai/infinitetalk-fast).
 * @param imageUrl  Portrait image URL (the face to animate)
 * @param audioUrl  Speech audio URL to drive lip-sync
 */
export async function submitTalkingHead(
  imageUrl: string,
  audioUrl: string,
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  return submitJob(
    WAVESPEED_MODELS.TALKING_HEAD,
    { image_url: imageUrl, audio_url: audioUrl },
    apiKey,
  );
}

/**
 * Submit a text-to-speech job (minimax/speech-2.6-turbo).
 * @param text     Script to synthesize
 * @param voiceId  WaveSpeed voice id (from a completed clone job or preset)
 */
export async function submitSpeech(
  text: string,
  voiceId: string,
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  return submitJob(
    WAVESPEED_MODELS.SPEECH,
    { text, voice_id: voiceId },
    apiKey,
  );
}

/**
 * Submit a voice clone job (minimax/voice-clone).
 * @param name      Display name for the cloned voice
 * @param audioUrl  Reference audio URL (clear speech, min ~30 s recommended)
 */
export async function submitVoiceClone(
  name: string,
  audioUrl: string,
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  return submitJob(
    WAVESPEED_MODELS.VOICE_CLONE,
    { name, audio_url: audioUrl },
    apiKey,
  );
}

/**
 * Submit an image edit job (bytedance/seedream-v5.0-pro/edit).
 * @param imageUrl  Source image URL (must be publicly reachable)
 * @param prompt    Editing instruction in natural language
 */
export async function submitImageEdit(
  imageUrl: string,
  prompt: string,
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  return submitJob(
    WAVESPEED_MODELS.IMAGE_EDIT,
    { image_url: imageUrl, prompt },
    apiKey,
  );
}
