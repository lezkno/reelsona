import type { VideoEffects } from "@workspace/api-client-react"

export type CaptionToolStatus = string | null | undefined

export type VideoToolSummaryState = {
  label: string
  enabled: boolean
  status?: string
}

export type VideoToolsSummaryState = {
  captions: VideoToolSummaryState
  zoom: VideoToolSummaryState
  ai_broll: VideoToolSummaryState
  text_cards: VideoToolSummaryState
}

const EFFECT_DEFAULTS: VideoEffects = { zoom: false, ai_broll: false, text_cards: false }

export function normalizeVideoToolsEffects(value?: Partial<VideoEffects> | null): VideoEffects {
  return {
    zoom: value?.zoom === true,
    ai_broll: value?.ai_broll === true,
    // Text cards are not currently part of the product surface.
    text_cards: false,
  }
}

function applyVideoToolsOverride(base: VideoEffects, override?: Partial<VideoEffects> | null): VideoEffects {
  if (!override) return base
  return {
    zoom: typeof override.zoom === "boolean" ? override.zoom : base.zoom,
    ai_broll: typeof override.ai_broll === "boolean" ? override.ai_broll : base.ai_broll,
    text_cards: false,
  }
}

export function resolveVideoToolsEffects(
  accountEffects?: Partial<VideoEffects> | null,
  itemOverride?: Partial<VideoEffects> | null,
  snapshot?: Partial<VideoEffects> | null,
): VideoEffects {
  if (snapshot != null) return normalizeVideoToolsEffects(snapshot)
  return applyVideoToolsOverride(
    applyVideoToolsOverride(EFFECT_DEFAULTS, accountEffects),
    itemOverride,
  )
}

export function captionLabel(status: CaptionToolStatus): string {
  if (status === "processing") return "Captions · procesando"
  if (status === "done") return "Captions · listos"
  if (status === "failed") return "Captions · error"
  if (status === "disabled") return "Captions · apagados"
  return "Captions"
}

export function getVideoToolsSummaryState(
  effects: Partial<VideoEffects> | null | undefined,
  captionsEnabled: boolean,
  captionStatus: CaptionToolStatus,
): VideoToolsSummaryState {
  const normalized = normalizeVideoToolsEffects(effects)
  const captions: VideoToolSummaryState = {
    label: captionLabel(captionStatus),
    enabled: captionsEnabled,
  }
  if (captionStatus === "failed") captions.status = "fallaron"

  return {
    captions,
    zoom: { label: "Zoom", enabled: normalized.zoom },
    ai_broll: { label: "B-roll IA", enabled: normalized.ai_broll },
    text_cards: { label: "Tarjetas", enabled: normalized.text_cards },
  }
}