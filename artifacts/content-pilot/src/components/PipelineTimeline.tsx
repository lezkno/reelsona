import { useState, useEffect, useCallback } from "react"
import {
  useGetContentPlan, useGetAutomation, usePublishVideo, useUpdateContentItem,
  getGetContentPlanQueryKey, type ContentPlanItem,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { VideoModal } from "@/components/VideoModal"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  FileText, UserSquare2, Captions, Send, CheckCircle2,
  Clock, AlertTriangle, Loader2, Play, Eye, Sparkles,
} from "lucide-react"

// ── Step definitions ─────────────────────────────────────────────────────────
const BASE_STEPS = [
  { key: "script",  label: "Guion",           desc: "La IA escribe el guion y el hook",       icon: FileText,    estimatedMs: 60_000  },
  { key: "video",   label: "Video con Avatar", desc: "HeyGen crea el video con tu avatar",     icon: UserSquare2, estimatedMs: 600_000 },
  { key: "caption", label: "Caption Studio",   desc: "Se aplican captions animados al video",  icon: Captions,    estimatedMs: 150_000 },
  { key: "copy",    label: "Descripción e IG", desc: "La IA genera descripción y hashtags",    icon: Sparkles,    estimatedMs: 15_000  },
  { key: "review",  label: "Revisión Manual",  desc: "Aprueba el video antes de publicarlo",   icon: Eye,         estimatedMs: 0       },
  { key: "publish", label: "Publicar en IG",   desc: "Se sube y publica el Reel",              icon: Send,        estimatedMs: 120_000 },
] as const

type StepKey = typeof BASE_STEPS[number]["key"]
type PipelineMode = "generating" | "captioning" | "copy_generating" | "publishing" | "awaiting_publish" | "scripted_waiting" | "next" | "done"

// ── Progress mapping ─────────────────────────────────────────────────────────
// Returns a 0-based semantic step index using the full 6-step scale and an
// overall % for the macro progress bar.
//   0=script  1=video  2=caption  3=copy  4=review/publish  5=done
function getProgress(item: ContentPlanItem): { step: number; percent: number } {
  const cs = item.caption_status
  const copyDone = item.copy_status === "done" || item.copy_status === "failed"
  switch (item.status) {
    case "draft":      return { step: 0, percent: 8  }
    case "scripted":   return { step: 1, percent: 30 }
    case "generating": return { step: 1, percent: 50 }
    case "ready": {
      if (cs === "done" || cs === "failed" || cs === "disabled") {
        if (copyDone) return { step: 4, percent: 83 }  // → review or publish
        return { step: 3, percent: 75 }                 // copy in progress
      }
      return { step: 2, percent: 65 }                   // caption in progress
    }
    case "published":  return { step: 5, percent: 100 }
    default:           return { step: -1, percent: 0  }
  }
}

/** Among multiple candidates, pick the one most recently touched (updated_at DESC). */
function mostRecent(candidates: ContentPlanItem[]): ContentPlanItem | undefined {
  return candidates.reduce<ContentPlanItem | undefined>((best, cur) => {
    if (!best) return cur
    return new Date(cur.updated_at) > new Date(best.updated_at) ? cur : best
  }, undefined)
}

function pickActiveItem(items: ContentPlanItem[]): { item: ContentPlanItem; mode: PipelineMode } | null {
  // Priority 1 — video actively rendering in HeyGen
  const generating = mostRecent(items.filter((i) => i.status === "generating"))
  if (generating) return { item: generating, mode: "generating" }

  // Priority 2 — ready but captions still pending / processing
  const captioning = mostRecent(
    items.filter((i) => i.status === "ready" && (i.caption_status === null || i.caption_status === "processing"))
  )
  if (captioning) return { item: captioning, mode: "captioning" }

  // Priority 3 — captions terminal but copy not yet generated
  const copyGenerating = mostRecent(
    items.filter(
      (i) => i.status === "ready" &&
        (i.caption_status === "done" || i.caption_status === "failed" || i.caption_status === "disabled") &&
        (i.copy_status === null || i.copy_status === "generating")
    )
  )
  if (copyGenerating) return { item: copyGenerating, mode: "copy_generating" }

  // Priority 4 — video actively being published to Instagram (container uploading)
  const publishing = mostRecent(
    items.filter((i) => i.status === "ready" && i.video_status === "publishing")
  )
  if (publishing) return { item: publishing, mode: "publishing" }

  // Priority 5 — ready with terminal caption + copy, waiting to publish
  const awaitingPublish = mostRecent(
    items.filter(
      (i) => i.status === "ready" &&
        (i.caption_status === "done" || i.caption_status === "failed" || i.caption_status === "disabled") &&
        (i.copy_status === "done" || i.copy_status === "failed")
    )
  )
  if (awaitingPublish) return { item: awaitingPublish, mode: "awaiting_publish" }

  // Priority 5 — scripted (script done, video not yet started)
  const scripted = mostRecent(items.filter((i) => i.status === "scripted"))
  if (scripted) return { item: scripted, mode: "scripted_waiting" }

  // Priority 6 — next upcoming draft
  const upcoming = items
    .filter((i) => i.status === "draft" && i.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
  if (upcoming[0]) return { item: upcoming[0], mode: "next" }

  // Priority 7 — last published
  const lastPublished = mostRecent(items.filter((i) => i.status === "published"))
  if (lastPublished) return { item: lastPublished, mode: "done" }

  return null
}

function getHeaderLabel(mode: PipelineMode, willAutoPublish: boolean | undefined): string {
  switch (mode) {
    case "generating":       return "Producción en curso"
    case "captioning":       return "Aplicando captions al video"
    case "copy_generating":  return "Generando descripción e IG copy"
    case "publishing":       return "Publicando en Instagram..."
    case "awaiting_publish": return willAutoPublish
      ? "En cola para publicar automáticamente"
      : "Video listo — revisa y aprueba para publicar"
    case "scripted_waiting": return willAutoPublish
      ? "Guion listo — el sistema generará el video"
      : "Guion listo — revisa y genera el video"
    case "next":             return "Próximo video en cola"
    case "done":             return "Último video producido"
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

// ── Review Modal (uses shared VideoModal) ────────────────────────────────────
function ReviewModal({
  open, onClose, item,
}: {
  open: boolean
  onClose: () => void
  item: ContentPlanItem
}) {
  const queryClient   = useQueryClient()
  const publishVideo  = usePublishVideo()
  const updateItem    = useUpdateContentItem()

  const handleApprove = () => {
    if (!item.video_id) return
    onClose()   // close immediately so the pipeline shows the publishing step
    publishVideo.mutate(
      { id: item.video_id, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
        },
      }
    )
  }

  const handleSaveCaption = useCallback(async (caption: string, hashtags: string) => {
    await new Promise<void>((resolve, reject) =>
      updateItem.mutate(
        { id: item.id, data: { caption, hashtags } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
            resolve()
          },
          onError: reject,
        }
      )
    )
  }, [item.id, updateItem, queryClient])

  const handleRegenerateCaption = useCallback(async () => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""
    const res = await fetch(`${base}/api/content/${item.id}/regenerate-caption`, {
      method: "POST",
      credentials: "include",
    })
    if (!res.ok) throw new Error("Error al regenerar caption")
    return res.json() as Promise<{ caption: string; hashtags: string }>
  }, [item.id])

  return (
    <VideoModal
      open={open}
      onClose={onClose}
      title={item.topic}
      subtitle="Revisa el video antes de publicarlo en Instagram."
      headerIcon={Eye}
      videoSrc={item.captioned_video_url}
      fallbackSrc={item.video_url}
      caption={item.caption}
      hashtags={item.hashtags}
      onSaveCaption={handleSaveCaption}
      onRegenerateCaption={handleRegenerateCaption}
      onApprove={handleApprove}
      approveLabel="Aprobar y Publicar en IG"
      isApproving={publishVideo.isPending}
      dismissLabel="Revisar después"
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PipelineTimeline() {
  const { data: items } = useGetContentPlan({ limit: 100 }, { query: { refetchInterval: 15000 } as any })
  const { data: automation }  = useGetAutomation({ query: { refetchInterval: 10000 } as any })
  const [reviewOpen, setReviewOpen] = useState(false)

  // Tick every 5 s for elapsed-time bars
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  const active = items ? pickActiveItem(items) : null
  if (!active) return null

  const { item, mode } = active
  const { step, percent } = getProgress(item)
  const willAutoPublish = automation?.enabled && automation?.auto_publish
  const captionsEnabled = automation?.captions_enabled ?? true
  const isManual = !willAutoPublish

  // Build the visible steps for this mode:
  //   auto   + captions:    script video caption copy         publish    (5 steps)
  //   auto   + no captions: script video         copy         publish    (4 steps)
  //   manual + captions:    script video caption copy review  publish    (6 steps)
  //   manual + no captions: script video         copy review  publish    (5 steps)
  const visibleSteps = BASE_STEPS.filter((s) => {
    if (s.key === "caption" && !captionsEnabled) return false
    if (s.key === "review"  && !isManual)        return false
    return true
  })

  // Map the semantic step index to the visible key.
  // getProgress uses: 0=script 1=video 2=caption 3=copy 4=review/publish 5=done
  const activeKey: StepKey | null =
    step === 0 ? "script"  :
    step === 1 ? "video"   :
    step === 2 ? "caption" :
    step === 3 ? "copy"    :
    step === 4 ? (isManual ? "review" : "publish") :
    step === 5 ? "publish" : null

  const displayStep = activeKey ? visibleSteps.findIndex((s) => s.key === activeKey) : -1

  const isActivelyProcessing = mode === "generating" || mode === "captioning" || mode === "copy_generating" || mode === "publishing"
  const isAwaitingReview     = mode === "awaiting_publish" && isManual

  const gridClass =
    visibleSteps.length === 3 ? "grid-cols-3" :
    visibleSteps.length === 4 ? "grid-cols-2 sm:grid-cols-4" :
    visibleSteps.length === 5 ? "grid-cols-2 sm:grid-cols-5" :
                                "grid-cols-2 sm:grid-cols-6"

  return (
    <>
      {item.video_id && (
        <ReviewModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          item={item}
        />
      )}

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
              {item.scheduled_at && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {mode === "next" ? "Comienza el " : ""}
                  {format(new Date(item.scheduled_at), "EEE d MMM, HH:mm", { locale: es })}
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

              // Spinner only for steps that are actively processing
              const showSpinner = current && isActivelyProcessing

              // Per-step elapsed bar
              const stepElapsed = getStepElapsedPercent(s.key as StepKey, item, mode, nowMs)

              // ── Status label ──────────────────────────────────────
              let statusLabel = done ? "Completado" : !current ? "" : "En espera..."

              if (s.key === "video" && current)
                statusLabel = mode === "generating"
                  ? (stepElapsed ? fmtRemaining(stepElapsed.remainingSec) : "Renderizando...")
                  : "En espera de HeyGen"

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
                statusLabel = "Tocá para revisar"

              if (!done && !current)
                statusLabel = s.key === "video"   ? "~5-15 min" :
                              s.key === "script"  ? "~1-3 min"  :
                              s.key === "caption" ? "~1-3 min"  :
                              s.key === "copy"    ? "~10 seg"   : ""

              // ── Card styles ───────────────────────────────────────
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
                : isCopy ? copyCardClass
                : done    ? "bg-primary/10 border-primary/30"
                : current ? "border-primary bg-background shadow-sm"
                :           "bg-muted/30 border-transparent"

              const textClass   = reviewActive ? "text-white"
                                : copyActive   ? "text-violet-700 dark:text-violet-300"
                                : (done || current ? "text-foreground" : "text-muted-foreground")
              const descClass   = reviewActive ? "text-violet-200"
                                : copyActive   ? "text-violet-500/80 dark:text-violet-400/80"
                                : "text-muted-foreground"
              const statusClass = reviewActive ? "text-violet-200 font-medium"
                                : copyActive   ? "text-violet-500 dark:text-violet-400 font-medium"
                                : "text-muted-foreground/70"

              return (
                <div
                  key={s.key}
                  className={`rounded-lg border p-3 ${cardClass}`}
                  onClick={reviewActive ? () => setReviewOpen(true) : undefined}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {item.status === "failed" && i === 0 ? (
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                    ) : done ? (
                      <CheckCircle2 className={`w-4 h-4 ${isReview ? "text-violet-500 dark:text-violet-400" : isCopy ? "text-violet-500 dark:text-violet-400" : "text-primary"}`} />
                    ) : showSpinner ? (
                      <Loader2 className={`w-4 h-4 animate-spin ${copyActive ? "text-violet-500" : "text-primary"}`} />
                    ) : reviewActive ? (
                      <Play className="w-4 h-4 text-white" />
                    ) : current ? (
                      <Clock className="w-4 h-4 text-primary" />
                    ) : (
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className={`text-xs font-bold ${textClass}`}>
                      {i + 1}. {s.label}
                    </span>
                  </div>

                  <p className={`text-[11px] leading-tight hidden sm:block ${descClass}`}>{s.desc}</p>

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
    </>
  )
}
