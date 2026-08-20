import "./_group.css"
import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  FileText, UserSquare2, Captions, Send, CheckCircle2,
  Clock, AlertTriangle, Loader2, Play, Eye, Sparkles,
  ZoomIn, ImageIcon, Instagram, Check, ChevronUp,
} from "lucide-react"

// ── Types (inlined from api-client-react shape) ───────────────────────────────
type CaptionStatus = "processing" | "done" | "failed" | "disabled" | null | undefined
type CopyStatus = "generating" | "done" | "failed" | null | undefined
type VideoStatus = "publishing" | "done" | null | undefined
type ItemStatus = "draft" | "scripting" | "scripted" | "generating" | "ready" | "published" | "failed"

interface ContentPlanItem {
  id: string
  topic: string
  status: ItemStatus
  scheduled_at: string | null
  updated_at: string
  video_id: string | null
  video_url: string | null
  captioned_video_url: string | null
  caption: string | null
  hashtags: string | null
  caption_status: CaptionStatus
  copy_status: CopyStatus
  video_status: VideoStatus
  video_effects?: Partial<VideoEffects> | null
  video_effects_override?: Partial<VideoEffects> | null
}

type VideoEffects = { zoom: boolean; ai_broll: boolean; text_cards: boolean }

// ── Step definitions ─────────────────────────────────────────────────────────
const BASE_STEPS = [
  { key: "script",  label: "Guion",            desc: "La IA escribe el guion y el hook",                 icon: FileText,    estimatedMs: 60_000  },
  { key: "video",   label: "Video con Avatar",  desc: "La IA crea el video con tu avatar",                icon: UserSquare2, estimatedMs: 600_000 },
  { key: "caption", label: "Studio de Efectos", desc: "Se aplican captions y efectos visuales al video", icon: Captions,    estimatedMs: 150_000 },
  { key: "copy",    label: "Descripcion e IG",  desc: "La IA genera descripcion y hashtags",             icon: Sparkles,    estimatedMs: 15_000  },
  { key: "review",  label: "Revision Manual",   desc: "Aprueba el video antes de publicarlo",            icon: Eye,         estimatedMs: 0       },
  { key: "publish", label: "Publicar en IG",    desc: "Se sube y publica el Reel en Instagram",          icon: Send,        estimatedMs: 120_000 },
] as const

type StepKey = typeof BASE_STEPS[number]["key"]
type PipelineMode =
  | "generating" | "captioning" | "copy_generating" | "publishing"
  | "awaiting_publish" | "scripted_waiting" | "next" | "done"

// ── Progress mapping ─────────────────────────────────────────────────────────
function getProgress(item: ContentPlanItem): { step: number; percent: number } {
  const cs = item.caption_status
  const copyDone = item.copy_status === "done" || item.copy_status === "failed"
  switch (item.status) {
    case "draft":      return { step: 0, percent: 8  }
    case "scripting":  return { step: 0, percent: 20 }
    case "scripted":   return { step: 1, percent: 30 }
    case "generating": return { step: 1, percent: 50 }
    case "ready": {
      if (item.video_status === "publishing") return { step: 5, percent: 92 }
      if (cs === "done" || cs === "failed" || cs === "disabled") {
        if (copyDone) return { step: 4, percent: 83 }
        return { step: 3, percent: 75 }
      }
      return { step: 2, percent: 65 }
    }
    case "published":  return { step: 5, percent: 100 }
    default:           return { step: -1, percent: 0  }
  }
}

function getHeaderLabel(mode: PipelineMode, willAutoPublish: boolean): string {
  switch (mode) {
    case "generating":       return "Produccion en curso"
    case "captioning":       return "Aplicando captions al video"
    case "copy_generating":  return "Generando descripcion e IG copy"
    case "publishing":       return "Publicando en Instagram..."
    case "awaiting_publish": return willAutoPublish
      ? "En cola para publicar automaticamente"
      : "Video listo — revisa y aprueba para publicar"
    case "scripted_waiting": return willAutoPublish
      ? "Guion listo — el sistema generara el video"
      : "Guion listo — revisa y genera el video"
    case "next":             return "Proximo video en cola"
    case "done":             return "Ultimo video producido"
  }
}

// ── Step elapsed-time progress bar ───────────────────────────────────────────
function getStepElapsedPercent(
  stepKey: StepKey,
  item: ContentPlanItem,
  mode: PipelineMode,
  nowMs: number,
): { pct: number; remainingSec: number } | null {
  if (mode === "next" || mode === "done" || mode === "awaiting_publish" || mode === "scripted_waiting") return null
  const activeKey: StepKey | null =
    mode === "generating"      ? "video"   :
    mode === "captioning"      ? "caption" :
    mode === "copy_generating" ? "copy"    :
    mode === "publishing"      ? "publish" : null
  if (activeKey !== stepKey) return null
  const step = BASE_STEPS.find((s) => s.key === stepKey)
  if (!step || step.estimatedMs === 0) return null
  const elapsedMs = Math.max(0, nowMs - new Date(item.updated_at).getTime())
  const pct = Math.min(95, (elapsedMs / step.estimatedMs) * 100)
  const remainingSec = Math.max(0, Math.round((step.estimatedMs - elapsedMs) / 1000))
  return { pct, remainingSec }
}

function fmtRemaining(sec: number): string {
  if (sec <= 0) return "Finalizando..."
  if (sec < 60)  return `~${sec} seg`
  return `~${Math.ceil(sec / 60)} min`
}

// ── VideoToolsSummary (inlined) ───────────────────────────────────────────────
type ToolState = { label: string; enabled: boolean; status?: string }

function normalizeVideoToolsEffects(value?: Partial<VideoEffects> | null): VideoEffects {
  return { zoom: value?.zoom === true, ai_broll: value?.ai_broll === true, text_cards: false }
}

function applyVideoToolsOverride(base: VideoEffects, override?: Partial<VideoEffects> | null): VideoEffects {
  if (!override) return base
  return {
    zoom:      typeof override.zoom     === "boolean" ? override.zoom     : base.zoom,
    ai_broll:  typeof override.ai_broll === "boolean" ? override.ai_broll : base.ai_broll,
    text_cards: false,
  }
}

function resolveVideoToolsEffects(
  accountEffects?: Partial<VideoEffects> | null,
  itemOverride?: Partial<VideoEffects> | null,
  snapshot?: Partial<VideoEffects> | null,
): VideoEffects {
  if (snapshot != null) return normalizeVideoToolsEffects(snapshot)
  const EFFECT_DEFAULTS: VideoEffects = { zoom: false, ai_broll: false, text_cards: false }
  return applyVideoToolsOverride(
    applyVideoToolsOverride(EFFECT_DEFAULTS, accountEffects),
    itemOverride,
  )
}

function captionLabel(status: CaptionStatus): string {
  if (status === "processing") return "Captions - procesando"
  if (status === "done")       return "Captions - listos"
  if (status === "failed")     return "Captions - error"
  if (status === "disabled")   return "Captions - apagados"
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

function VideoToolsSummary({
  effects,
  captionsEnabled = false,
  captionStatus,
  compact = false,
}: {
  effects?: Partial<VideoEffects> | null
  captionsEnabled?: boolean
  captionStatus?: CaptionStatus
  compact?: boolean
}) {
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

// ── VideoModal (inlined, stubbed actions) ─────────────────────────────────────
function VideoModal({
  open,
  onClose,
  title,
  caption,
  hashtags,
}: {
  open: boolean
  onClose: () => void
  title: string
  caption: string | null
  hashtags: string | null
}) {
  const [localCaption, setLocalCaption]   = useState(caption ?? "")
  const [localHashtags, setLocalHashtags] = useState(hashtags ?? "")
  const [infoExpanded, setInfoExpanded]   = useState(false)

  useEffect(() => {
    if (open) {
      setLocalCaption(caption ?? "")
      setLocalHashtags(hashtags ?? "")
      setInfoExpanded(false)
    }
  }, [open, caption, hashtags])

  const isDirty =
    localCaption.trim() !== (caption ?? "").trim() ||
    localHashtags.trim() !== (hashtags ?? "").trim()

  const copySection = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Caption para Instagram
        </p>
        <Textarea
          value={localCaption}
          onChange={(e) => setLocalCaption(e.target.value)}
          rows={4}
          className="text-sm resize-none"
          placeholder="Caption que se publicara junto al video..."
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Hashtags
        </p>
        <Textarea
          value={localHashtags}
          onChange={(e) => setLocalHashtags(e.target.value)}
          rows={3}
          className="text-sm resize-none font-mono text-violet-700"
          placeholder="#hashtag1 #hashtag2 ..."
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <Sparkles className="w-3.5 h-3.5 text-violet-600" />
          Regenerar con IA
        </Button>
        {isDirty && (
          <Button size="sm" className="gap-1.5 text-xs ml-auto bg-violet-700 hover:bg-violet-800 text-white">
            <Check className="w-3.5 h-3.5" />
            Guardar cambios
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="
          p-0 overflow-hidden gap-0
          flex flex-col sm:flex-row
          w-full max-w-full h-[100dvh] rounded-none
          sm:w-[95vw] sm:max-w-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl
        "
      >
        {/* Video panel */}
        <div className="relative bg-black overflow-hidden flex-1 min-h-0 sm:flex-none sm:w-56 sm:self-stretch flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-white/40 py-10">
            <Play className="w-8 h-8 opacity-40" />
            <p className="text-xs">Vista previa del video</p>
          </div>
        </div>

        {/* Desktop right column */}
        <div className="hidden sm:flex flex-col flex-1 min-h-0 overflow-hidden">
          <DialogHeader className="bg-violet-700 px-5 py-3 shrink-0 rounded-none">
            <DialogTitle className="text-white flex items-center gap-2 text-base font-bold leading-snug">
              <Eye className="w-4 h-4 shrink-0" />
              <span className="line-clamp-2">{title}</span>
            </DialogTitle>
            <p className="text-violet-200 text-xs mt-0.5 leading-snug">
              Revisa el video antes de publicarlo en Instagram.
            </p>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {copySection}
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-2 items-center border-t">
            <Button variant="outline" onClick={onClose} className="w-auto">
              Revisar despues
            </Button>
            <Button
              onClick={onClose}
              className="gap-2 bg-violet-700 hover:bg-violet-800 text-white border-transparent ml-auto"
            >
              <Instagram className="w-4 h-4" />
              Aprobar y Publicar en IG
            </Button>
          </div>
        </div>

        {/* Mobile bottom panel */}
        <div className="sm:hidden shrink-0 bg-white flex flex-col">
          <button
            type="button"
            className="w-full px-4 py-3.5 flex items-center gap-2.5 text-left border-t border-gray-100 active:bg-gray-50 transition-colors"
            onClick={() => setInfoExpanded((v) => !v)}
            aria-expanded={infoExpanded}
          >
            <Eye className="w-4 h-4 text-violet-600 shrink-0" />
            <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{title}</span>
            <ChevronUp
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                infoExpanded ? "rotate-0" : "rotate-180"
              }`}
            />
          </button>
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              infoExpanded ? "max-h-[55vh]" : "max-h-0"
            }`}
          >
            <div className="overflow-y-auto max-h-[55vh] px-4 pt-1 pb-4 border-t border-gray-100">
              {copySection}
            </div>
          </div>
          <div className="px-4 py-3 flex gap-2 border-t border-gray-100">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Revisar despues
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 gap-2 bg-violet-700 hover:bg-violet-800 text-white border-transparent"
            >
              <Instagram className="w-4 h-4" />
              Aprobar y Publicar en IG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Static mock data ──────────────────────────────────────────────────────────
// Represents a video in the "awaiting_publish" / manual review state —
// the richest visible state (all 6 steps rendered, "Tocá para revisar" CTA).
const MOCK_ITEM: ContentPlanItem = {
  id: "mock-001",
  topic: "Como duplicar tus ventas con contenido corto en Instagram",
  status: "ready",
  scheduled_at: "2025-07-22T18:00:00Z",
  updated_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(), // 4 min ago
  video_id: "mock-video-001",
  video_url: null,
  captioned_video_url: null,
  caption:
    "El contenido corto es la forma mas eficiente de llegar a nuevos clientes en 2025. En este video te explico exactamente como estructuro cada Reel para que convierta.",
  hashtags: "#instagram #reels #marketing #ventas #contenido #emprendimiento",
  caption_status: "done",
  copy_status: "done",
  video_status: null,
  video_effects: { zoom: true, ai_broll: false, text_cards: false },
  video_effects_override: null,
}

const MOCK_AUTOMATION = { enabled: true, auto_publish: false, captions_enabled: true }
const MOCK_ACCOUNT_EFFECTS: Partial<VideoEffects> = { zoom: true, ai_broll: false }

// ── Scenario selector (for reference variety) ─────────────────────────────────
type ScenarioKey = "awaiting_publish" | "generating" | "captioning" | "done"

const SCENARIOS: Record<ScenarioKey, { item: ContentPlanItem; mode: PipelineMode; label: string }> = {
  awaiting_publish: {
    item: MOCK_ITEM,
    mode: "awaiting_publish",
    label: "En revision — listo para publicar",
  },
  generating: {
    item: {
      ...MOCK_ITEM,
      status: "generating",
      caption_status: null,
      copy_status: null,
      video_status: null,
      updated_at: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
    },
    mode: "generating",
    label: "Generando video con Avatar",
  },
  captioning: {
    item: {
      ...MOCK_ITEM,
      status: "ready",
      caption_status: "processing",
      copy_status: null,
      video_status: null,
      updated_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    },
    mode: "captioning",
    label: "Aplicando captions",
  },
  done: {
    item: { ...MOCK_ITEM, status: "published", caption_status: "done", copy_status: "done" },
    mode: "done",
    label: "Ultimo video publicado",
  },
}

// ── Pipeline timeline renderer ────────────────────────────────────────────────
function PipelineTimelineView({
  item,
  mode,
  willAutoPublish,
  captionsEnabled,
  effectiveEffects,
  nowMs,
  onOpenReview,
}: {
  item: ContentPlanItem
  mode: PipelineMode
  willAutoPublish: boolean
  captionsEnabled: boolean
  effectiveEffects: VideoEffects
  nowMs: number
  onOpenReview: () => void
}) {
  const { step, percent } = getProgress(item)

  const hasActiveEffect   = effectiveEffects.zoom || effectiveEffects.ai_broll
  const hasEffectsStudioWork = captionsEnabled || hasActiveEffect
  const isManual = !willAutoPublish

  const visibleSteps = BASE_STEPS.filter((s) => {
    if (s.key === "caption" && !hasEffectsStudioWork) return false
    if (s.key === "review"  && !isManual)              return false
    return true
  })

  const activeKey: StepKey | null =
    step === 0 ? "script"  :
    step === 1 ? "video"   :
    step === 2 ? "caption" :
    step === 3 ? "copy"    :
    step === 4 ? (isManual ? "review" : "publish") :
    step === 5 ? "publish" : null

  const displayStep = activeKey ? visibleSteps.findIndex((s) => s.key === activeKey) : -1

  const isActivelyProcessing =
    mode === "generating" || mode === "captioning" ||
    mode === "copy_generating" || mode === "publishing"
  const isAwaitingReview = mode === "awaiting_publish" && isManual

  const gridClass =
    visibleSteps.length <= 3 ? "grid-cols-2 sm:grid-cols-3" :
    visibleSteps.length === 4 ? "grid-cols-2 sm:grid-cols-4" :
    visibleSteps.length === 5 ? "grid-cols-2 sm:grid-cols-5" :
    visibleSteps.length === 6 ? "grid-cols-2 sm:grid-cols-6" :
                                "grid-cols-3 sm:grid-cols-4"

  // Format scheduled_at with static locale-aware string (no date-fns import needed)
  const scheduledLabel = item.scheduled_at
    ? new Date(item.scheduled_at).toLocaleDateString("es-AR", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : null

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent shrink-0">
      <CardContent className="p-5">
        {/* Header row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
              {getHeaderLabel(mode, willAutoPublish)}
            </p>
            <h3 className="font-display font-bold truncate">{item.topic}</h3>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {scheduledLabel && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {mode === "next" ? "Comienza el " : ""}
                {scheduledLabel}
              </span>
            )}
            <span className={`text-lg font-bold font-display ${item.status === "failed" ? "text-destructive" : "text-primary"}`}>
              {item.status === "failed" ? "Error" : `${percent}%`}
            </span>
          </div>
        </div>

        <Progress value={percent} className="h-1.5 mb-4" />

        {/* Step grid */}
        <div className={`grid gap-2 ${gridClass}`}>
          {visibleSteps.map((s, i) => {
            const Icon = s.icon
            const done    = displayStep > i
            const current = displayStep === i &&
              mode !== "next" && mode !== "done" &&
              item.status !== "draft" && item.status !== "failed"
            const isReview     = s.key === "review"
            const isCopy       = s.key === "copy"
            const reviewActive = isReview && current && isAwaitingReview
            const copyActive   = isCopy && mode === "copy_generating"

            const effectiveDone    = done
            const effectiveCurrent = current
            const showSpinner      = current && isActivelyProcessing

            const stepElapsed = getStepElapsedPercent(s.key as StepKey, item, mode, nowMs)

            // Status label
            let statusLabel = effectiveDone ? "Completado" : !effectiveCurrent ? "" : "En espera..."

            if (s.key === "video" && current)
              statusLabel = mode === "generating"
                ? (stepElapsed ? fmtRemaining(stepElapsed.remainingSec) : "Renderizando...")
                : "En espera de la IA"

            if (s.key === "caption" && current)
              statusLabel = item.caption_status === "processing"
                ? (stepElapsed ? fmtRemaining(stepElapsed.remainingSec) : "Procesando...")
                : "En cola..."

            if (s.key === "caption" && done && item.caption_status === "failed")
              statusLabel = "Omitido (error)"

            if (isCopy && current)
              statusLabel = item.copy_status === "generating"
                ? (stepElapsed ? fmtRemaining(stepElapsed.remainingSec) : "Generando...")
                : "En cola..."

            if (isCopy && done && item.copy_status === "failed")
              statusLabel = "Omitido (error)"

            if (s.key === "publish" && current)
              statusLabel = mode === "publishing"
                ? (stepElapsed ? fmtRemaining(stepElapsed.remainingSec) : "Subiendo a Instagram...")
                : willAutoPublish ? "En cola" : "Listo para publicar"

            if (isReview && current)
              statusLabel = "Toca para revisar"

            if (!effectiveDone && !effectiveCurrent)
              statusLabel =
                s.key === "video"   ? "~5-15 min" :
                s.key === "script"  ? "~1-3 min"  :
                s.key === "caption" ? "~1-3 min"  :
                s.key === "copy"    ? "~10 seg"   : ""

            // Card styles
            const copyCardClass = copyActive
              ? "bg-violet-50 dark:bg-violet-950/30 border-violet-400/60 shadow-sm ring-1 ring-violet-400/30"
              : done
                ? "bg-primary/10 border-primary/30"
                : current
                  ? "border-primary bg-background shadow-sm"
                  : "bg-muted/30 border-transparent"

            const cardClass = isReview
              ? reviewActive
                ? "bg-violet-700 border-violet-600 shadow-md shadow-violet-700/30 cursor-pointer ring-2 ring-violet-400/60 ring-offset-1 hover:bg-violet-600 transition-colors"
                : done
                  ? "bg-violet-100 dark:bg-violet-900/30 border-violet-300/50 dark:border-violet-700/40"
                  : "bg-muted/30 border-transparent"
              : isCopy   ? copyCardClass
              : effectiveDone    ? "bg-primary/10 border-primary/30"
              : effectiveCurrent ? "border-primary bg-background shadow-sm"
              :                    "bg-muted/30 border-transparent"

            const textClass =
              reviewActive ? "text-white"
              : copyActive   ? "text-violet-700 dark:text-violet-300"
              : (effectiveDone || effectiveCurrent ? "text-foreground" : "text-muted-foreground")

            const descClass =
              reviewActive ? "text-violet-200"
              : copyActive   ? "text-violet-500/80 dark:text-violet-400/80"
              : "text-muted-foreground"

            const statusClass =
              reviewActive ? "text-violet-200 font-medium"
              : copyActive   ? "text-violet-500 dark:text-violet-400 font-medium"
              : "text-muted-foreground/70"

            return (
              <div
                key={s.key}
                className={`rounded-lg border p-3 ${cardClass}`}
                onClick={reviewActive ? onOpenReview : undefined}
              >
                <div className="flex items-center gap-2 mb-1">
                  {item.status === "failed" && i === 0 ? (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  ) : effectiveDone ? (
                    <CheckCircle2
                      className={`w-4 h-4 ${isReview || isCopy ? "text-violet-500 dark:text-violet-400" : "text-primary"}`}
                    />
                  ) : showSpinner ? (
                    <Loader2 className={`w-4 h-4 animate-spin ${copyActive ? "text-violet-500" : "text-primary"}`} />
                  ) : reviewActive ? (
                    <Play className="w-4 h-4 text-white" />
                  ) : effectiveCurrent ? (
                    <Clock className="w-4 h-4 text-primary" />
                  ) : (
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className={`text-xs font-bold ${textClass}`}>
                    {i + 1}. {s.label}
                  </span>
                </div>

                <p className={`text-[11px] leading-tight hidden sm:block ${descClass}`}>{s.desc}</p>

                {s.key === "caption" && (
                  <div className="mt-2">
                    <VideoToolsSummary
                      effects={effectiveEffects}
                      captionsEnabled={captionsEnabled}
                      captionStatus={item.caption_status}
                      compact
                    />
                  </div>
                )}

                {stepElapsed ? (
                  <div className="mt-2 space-y-0.5">
                    <div className={`h-1 w-full rounded-full overflow-hidden ${copyActive ? "bg-violet-200/50 dark:bg-violet-800/30" : "bg-primary/15"}`}>
                      <div
                        className={`h-full rounded-full transition-all duration-[5000ms] ease-linear ${copyActive ? "bg-violet-500" : "bg-primary"}`}
                        style={{ width: `${stepElapsed.pct}%` }}
                      />
                    </div>
                    <p className={`text-[10px] font-medium ${statusClass}`}>{statusLabel}</p>
                  </div>
                ) : (
                  <p className={`text-[10px] mt-1 ${statusClass}`}>{statusLabel}</p>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main exported component ───────────────────────────────────────────────────
export function Current() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("awaiting_publish")
  const [reviewOpen, setReviewOpen]   = useState(false)
  const [nowMs, setNowMs]             = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  const { item, mode } = SCENARIOS[scenarioKey]

  const willAutoPublish  = MOCK_AUTOMATION.enabled && MOCK_AUTOMATION.auto_publish
  const captionsEnabled  = MOCK_AUTOMATION.captions_enabled
  const effectiveEffects = resolveVideoToolsEffects(
    MOCK_ACCOUNT_EFFECTS,
    item.video_effects_override,
    item.video_effects,
  )

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Scenario switcher */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(SCENARIOS) as [ScenarioKey, typeof SCENARIOS[ScenarioKey]][]).map(([key, s]) => (
          <button
            key={key}
            onClick={() => setScenarioKey(key)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
              key === scenarioKey
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ReviewModal (stubbed — no real video src or API calls) */}
      <VideoModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={item.topic}
        caption={item.caption}
        hashtags={item.hashtags}
      />

      {/* The timeline card */}
      <PipelineTimelineView
        item={item}
        mode={mode}
        willAutoPublish={willAutoPublish}
        captionsEnabled={captionsEnabled}
        effectiveEffects={effectiveEffects}
        nowMs={nowMs}
        onOpenReview={() => setReviewOpen(true)}
      />
    </div>
  )
}
