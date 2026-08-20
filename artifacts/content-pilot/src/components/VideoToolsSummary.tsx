import { Badge } from "@/components/ui/badge"
import { Captions, ImageIcon, ZoomIn } from "lucide-react"
import type { VideoEffects } from "@workspace/api-client-react"
import {
  getVideoToolsSummaryState,
  type CaptionToolStatus,
  type VideoToolSummaryState as ToolState,
} from "./VideoToolsSummary.logic"
export {
  captionLabel,
  getVideoToolsSummaryState,
  normalizeVideoToolsEffects,
  resolveVideoToolsEffects,
} from "./VideoToolsSummary.logic"
export type { CaptionToolStatus } from "./VideoToolsSummary.logic"

type VideoToolsSummaryProps = {
  effects?: Partial<VideoEffects> | null
  captionsEnabled?: boolean
  captionStatus?: CaptionToolStatus
  compact?: boolean
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
      className={`gap-0.5 whitespace-nowrap shrink-0 max-w-full ${compact ? "text-[8px] px-1 py-0 leading-tight" : "text-[10px] px-1.5 py-0.5"} ${
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
  const summary = getVideoToolsSummaryState(effects, captionsEnabled, captionStatus)
  const tools: Array<{ tool: ToolState; icon: typeof Captions }> = [
    { tool: summary.captions, icon: Captions },
    { tool: summary.zoom, icon: ZoomIn },
    { tool: summary.ai_broll, icon: ImageIcon },
  ]

  return (
    <div className="space-y-1.5" aria-label="Herramientas del video">
      <p className={`${compact ? "text-[9px]" : "text-[10px]"} font-semibold uppercase tracking-wide text-muted-foreground`}>
        Herramientas
      </p>
      <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-0.5 overflow-hidden">
        {tools.map(({ tool, icon }) => (
          <ToolsBadge key={tool.label} tool={tool} icon={icon} compact={compact} />
        ))}
      </div>
    </div>
  )
}