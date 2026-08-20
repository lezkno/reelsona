import { Badge } from "@/components/ui/badge"
import { Captions, ImageIcon, ZoomIn } from "lucide-react"
import type { VideoEffects } from "@workspace/api-client-react"

export type CaptionToolStatus = string | null | undefined

type ToolState = {
  label: string
  enabled: boolean
  status?: string
}

type VideoToolsSummaryProps = {
  effects?: Partial<VideoEffects> | null
  captionsEnabled?: boolean
  captionStatus?: CaptionToolStatus
  compact?: boolean
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

function captionLabel(status: CaptionToolStatus): string {
  if (status === "processing") return "Captions · procesando"
  if (status === "done") return "Captions · listos"
  if (status === "failed") return "Captions · error"
  if (status === "disabled") return "Captions · apagados"
  return "Captions"
}

function ToolsBadge({
  tool,
  icon: Icon,
  compact,
}: {
  tool: ToolState
  icon: typeof Captions
  compact: boolean
}) {
  return (
    <Badge
      variant="outline"
      title={`${tool.label}: ${tool.enabled ? "activo" : "apagado"}${tool.status ? ` · ${tool.status}` : ""}`}
      className={`gap-1 ${compact ? "text-[9px] px-1.5 py-0" : "text-[10px] px-1.5 py-0.5"} ${
        tool.enabled
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      <Icon className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {tool.label}
      <span className="sr-only">{tool.enabled ? "activo" : "apagado"}</span>
    </Badge>
  )
}

export function VideoToolsSummary({
  effects,
  captionsEnabled = false,
  captionStatus,
  compact = false,
}: VideoToolsSummaryProps) {
  const normalized = normalizeVideoToolsEffects(effects)
  const tools: Array<{ tool: ToolState; icon: typeof Captions }> = [
    {
      tool: {
        label: captionLabel(captionStatus),
        enabled: captionsEnabled,
        status: captionStatus === "failed" ? "fallaron" : undefined,
      },
      icon: Captions,
    },
    { tool: { label: "Zoom", enabled: normalized.zoom }, icon: ZoomIn },
    { tool: { label: "B-roll IA", enabled: normalized.ai_broll }, icon: ImageIcon },
  ]

  return (
    <div className="space-y-1.5" aria-label="Herramientas del video">
      <p className={`${compact ? "text-[9px]" : "text-[10px]"} font-semibold uppercase tracking-wide text-muted-foreground`}>
        Herramientas
      </p>
      <div className="flex flex-wrap gap-1">
        {tools.map(({ tool, icon }) => (
          <ToolsBadge key={tool.label} tool={tool} icon={icon} compact={compact} />
        ))}
      </div>
    </div>
  )
}