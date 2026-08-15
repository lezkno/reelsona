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

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`WaveSpeed ${method} ${path} → non-JSON response: ${text.slice(0, 200)}`);
  }

  // WaveSpeed wraps successful responses in { data: T }.
  // Some endpoints (e.g. GET /outputs/:id) may return the object directly.
  // Support both shapes to avoid silent undefined errors.
  const wrapped = json as WavespeedResponse<T>;
  return (wrapped.data ?? json) as T;
}

// ── Job types ──────────────────────────────────────────────────────────────────

export interface WavespeedJobResult {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  /** WaveSpeed returns outputs as a plain string[] (CloudFront URLs) for most models.
   *  Typed as unknown to force callers to handle both array and object shapes. */
  outputs?: unknown;
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
 * WaveSpeed v3 result endpoint: GET /api/v3/predictions/{task-id}/result
 * https://wavespeed.ai/docs/get-result
 */
export async function getJobStatus(
  requestId: string,
  apiKey?: string,
): Promise<WavespeedJobResult> {
  return wavespeedFetch<WavespeedJobResult>(
    "GET",
    `/api/v3/predictions/${requestId}/result`,
    undefined,
    apiKey,
  );
}

// ── Model-specific helpers ────────────────────────────────────────────────────

/**
 * Default motion prompt for infinitetalk-fast.
 *
 * The model accepts a free-text `prompt` that steers pose, expression, and
 * body behaviour.  Without it the avatar tends to stay nearly static; with
 * it we get natural upper-body movement that looks much more engaging on
 * social media.
 *
 * Keep this concise — the model reads it as a style directive, not a script.
 */
export const TALKING_HEAD_DEFAULT_PROMPT =
  "Natural upper body movement with expressive gestures and slight head turns. " +
  "Dynamic presenter energy: torso sway, occasional hand movement, engaged eye contact. " +
  "Professional content creator speaking directly to camera.";

/**
 * Submit a talking-head video job (wavespeed-ai/infinitetalk-fast).
 *
 * Documented parameters:
 *   image      — portrait image URL (required)
 *   audio      — speech audio URL (required)
 *   prompt     — natural-language style/motion directive (optional; defaults to TALKING_HEAD_DEFAULT_PROMPT)
 *   mask_image — optional mask that isolates the person to animate
 *   seed       — integer seed; -1 = random (optional)
 *
 * @param imageUrl  Portrait image URL (the face to animate)
 * @param audioUrl  Speech audio URL to drive lip-sync
 * @param opts      Optional overrides for prompt, maskImage, seed
 */
export async function submitTalkingHead(
  imageUrl: string,
  audioUrl: string,
  opts?: {
    prompt?:    string;
    maskImage?: string;
    seed?:      number;
  },
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  const prompt    = opts?.prompt    ?? TALKING_HEAD_DEFAULT_PROMPT;
  const maskImage = opts?.maskImage;
  const seed      = opts?.seed      ?? -1;

  // WaveSpeed infinitetalk-fast uses "image" and "audio" (not image_url / audio_url)
  return submitJob(
    WAVESPEED_MODELS.TALKING_HEAD,
    {
      image: imageUrl,
      audio: audioUrl,
      prompt,
      seed,
      ...(maskImage ? { mask_image: maskImage } : {}),
    },
    apiKey,
  );
}

/**
 * Submit a text-to-speech job (minimax/speech-2.6-turbo).
 * @param text     Script to synthesize
 * @param voiceId  WaveSpeed voice id (from a completed clone job or preset)
 * @param opts     Optional voice tuning: speed (0.5–1.5) and pitch in semitones (-12 to +12)
 */
export async function submitSpeech(
  text: string,
  voiceId: string,
  apiKey?: string,
  opts?: { speed?: number; pitch?: number },
): Promise<{ requestId: string; status: string }> {
  const inputs: Record<string, unknown> = { text, voice_id: voiceId };
  if (opts?.speed != null && opts.speed !== 1.0) inputs.speed  = opts.speed;
  if (opts?.pitch != null && opts.pitch !== 0)   inputs.pitch  = Math.round(opts.pitch);
  return submitJob(WAVESPEED_MODELS.SPEECH, inputs, apiKey);
}

/**
 * Submit a voice clone job (minimax/voice-clone).
 *
 * The caller must supply a `customVoiceId` that is:
 *   • ≥ 8 characters
 *   • Starts with a letter
 *   • Contains both letters and numbers
 *   • Unique across the WaveSpeed account
 *
 * The same ID is used directly when calling minimax/speech-02-hd, so save it
 * to the DB before submitting — no need to parse it from outputs later.
 *
 * @param customVoiceId  Caller-chosen unique voice ID (see format rules above)
 * @param audioUrl       Publicly accessible reference audio URL (≥ 30 s recommended)
 */
export async function submitVoiceClone(
  customVoiceId: string,
  audioUrl: string,
  apiKey?: string,
): Promise<{ requestId: string; status: string }> {
  return submitJob(
    WAVESPEED_MODELS.VOICE_CLONE,
    {
      audio: audioUrl,
      custom_voice_id: customVoiceId,
      model: "speech-02-hd",
      language_boost: "Spanish",
      need_noise_reduction: true,
      need_volume_normalization: true,
      accuracy: 0.7,
    },
    apiKey,
  );
}

// ── Voice Director presets ─────────────────────────────────────────────────────
//
// Pure configuration — NOT yet wired into video generation.
// These presets define suggested minimax/speech-2.6-turbo parameters for each
// vocal character. Wire them into the pipeline via voiceDirectorToSpeechOpts()
// when ready to apply per-video style settings.

export const VOICE_DIRECTOR_PRESET_IDS = ["natural", "energetico", "dramatico"] as const;
export type VoiceDirectorPresetId = (typeof VOICE_DIRECTOR_PRESET_IDS)[number];

export interface VoiceDirectorSpeechParams {
  /** Playback rate multiplier. 1.0 = default. Range: 0.5–1.5 */
  speed: number;
  /** Pitch shift in semitones. 0 = unchanged. Range: -12 to +12 */
  pitch: number;
  /** Language emphasis passed to minimax (voice-clone and speech). */
  languageBoost: "Spanish";
  /**
   * Descriptive emotion/style hint — use in script/topic prompts to steer
   * the AI-generated copy toward the right register before TTS synthesis.
   */
  emotionHint: string;
}

export interface VoiceDirectorPreset {
  id: VoiceDirectorPresetId;
  /** Display name shown in the UI */
  name: string;
  /** One-line description of when to use this preset */
  description: string;
  params: VoiceDirectorSpeechParams;
}

/** All built-in presets indexed by ID. */
export const VOICE_DIRECTOR_PRESETS: Record<VoiceDirectorPresetId, VoiceDirectorPreset> = {
  natural: {
    id: "natural",
    name: "Natural",
    description: "Tono de conversación real: cercano, claro y sin esfuerzo.",
    params: {
      speed: 1.0,
      pitch: 0,
      languageBoost: "Spanish",
      emotionHint: "conversational, warm, natural — habla como a un amigo",
    },
  },
  energetico: {
    id: "energetico",
    name: "Enérgico",
    description: "Ritmo más rápido: ideal para CTAs y contenido motivacional.",
    params: {
      speed: 1.1,
      pitch: 0,
      languageBoost: "Spanish",
      emotionHint: "energetic, upbeat, motivational — llama a la acción con entusiasmo",
    },
  },
  dramatico: {
    id: "dramatico",
    name: "Dramático",
    description: "Ritmo pausado: peso y autoridad para mensajes de alto impacto.",
    params: {
      speed: 0.9,
      pitch: 0,
      languageBoost: "Spanish",
      emotionHint: "serious, powerful, authoritative — habla con convicción y peso",
    },
  },
};

/**
 * Returns the full preset definition for a given ID.
 * Pure function — safe to call anywhere without side effects.
 */
export function getVoiceDirectorPreset(id: VoiceDirectorPresetId): VoiceDirectorPreset {
  return VOICE_DIRECTOR_PRESETS[id];
}

/**
 * Converts a preset into submitSpeech()-compatible opts.
 * Use this when wiring presets into the video generation pipeline.
 *
 * @example
 *   const opts = voiceDirectorToSpeechOpts("energetico")
 *   await submitSpeech(script, voiceId, apiKey, opts)
 */
export function voiceDirectorToSpeechOpts(
  id: VoiceDirectorPresetId,
): { speed: number; pitch: number } {
  const { params } = getVoiceDirectorPreset(id);
  return { speed: params.speed, pitch: params.pitch };
}

// ─────────────────────────────────────────────────────────────────────────────

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
  // bytedance/seedream-v5.0-pro/edit requires `images` as an array of URLs
  return submitJob(
    WAVESPEED_MODELS.IMAGE_EDIT,
    { images: [imageUrl], prompt },
    apiKey,
  );
}
