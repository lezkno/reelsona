import { useState, useEffect, useCallback } from "react"
import { motion, useReducedMotion } from "framer-motion"
import {
  useGetContentPlan, useGetAutomation, usePublishVideo, useUpdateContentItem,
  useGetSettings, getGetContentPlanQueryKey, type ContentPlanItem,
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
import {
  VideoToolsSummary,
  resolveVideoToolsEffects,
} from "@/components/VideoToolsSummary"

// ── Step definitions ─────────────────────────────────────────────────────────
const BASE_STEPS = [
  { key: "script",  label: "Guion",            desc: "La IA escribe el guion y el hook",                  icon: FileText,    estimatedMs: 60_000  },
  { key: "video",   label: "Video con Avatar",  desc: "La IA crea el video con tu avatar",                 icon: UserSquare2, estimatedMs: 600_000 },
  { key: "caption", label: "Studio de Efectos", desc: "Se aplican captions y efectos visuales al video",  icon: Captions,    estimatedMs: 150_000 },
  { key: "copy",    label: "Descripción e IG",  desc: "La IA genera descripción y hashtags",              icon: Sparkles,    estimatedMs: 15_000  },
  { key: "review",  label: "Revisión Manual",   desc: "Aprueba el video antes de publicarlo",             icon: Eye,         estimatedMs: 0       },
  { key: "publish", label: "Publicar en IG",    desc: "Se sube y publica el Reel en Instagram",           icon: Send,        estimatedMs: 120_000 },
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
    case "scripting":  return { step: 0, percent: 20 }
    case "scripted":   return { step: 1, percent: 30 }
    case "generating": return { step: 1, percent: 50 }
    case "ready": {
      // Video is actively uploading to Instagram — advance past review to publish step
      if (item.video_status === "publishing") return { step: 5, percent: 92 }
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

  // Priority 5 — script actively being generated
  const scripting = mostRecent(items.filter((i) => i.status === "scripting"))
  if (scripting) return { item: scripting, mode: "scripted_waiting" }

  // Priority 6 — scripted (script done, video not yet started)
  const scripted = mostRecent(items.filter((i) => i.status === "scripted"))
  if (scripted) return { item: scripted, mode: "scripted_waiting" }

  // Priority 7 — next upcoming draft
  const upcoming = items
    .filter((i) => (i.status === "draft" || i.status === "scripting") && i.scheduled_at)
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
  const { data: settings } = useGetSettings()
  const [reviewOpen, setReviewOpen] = useState(false)
  const reduceMotion = useReducedMotion()

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
  const effectiveEffects = resolveVideoToolsEffects(
    settings?.video_effects,
    (item as any).video_effects_override,
    (item as any).video_effects,
  )
  const hasActiveEffect = effectiveEffects.zoom || effectiveEffects.ai_broll
  const hasEffectsStudioWork = captionsEnabled || hasActiveEffect

  // Build the visible steps for this mode.
  //   auto   + captions:   script video caption copy         publish  (5)
  //   auto   - captions:   script video         copy               publish  (4)
  //   manual + captions:   script video caption copy review  publish  (6)
  //   manual - captions:   script video         copy review  publish  (5)
  const visibleSteps = BASE_STEPS.filter((s) => {
    if (s.key === "caption" && !hasEffectsStudioWork) return false
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
    visibleSteps.length <= 3 ? "grid-cols-2 sm:grid-cols-3" :
    visibleSteps.length === 4 ? "grid-cols-2 sm:grid-cols-4" :
    visibleSteps.length === 5 ? "grid-cols-2 sm:grid-cols-5" :
    visibleSteps.length === 6 ? "grid-cols-2 sm:grid-cols-6" :
                                "grid-cols-3 sm:grid-cols-4"   // 7 steps → 2 rows on sm

  return (
    <>
      {item.video_id && (
        <ReviewModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          item={item}
        />
      )}

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.5, ease: "easeOut" }}
      >
      <Card className="relative isolate overflow-hidden rounded-[1.6rem] border border-[#e4e7ed] bg-[linear-gradient(135deg,#fffefa_0%,#f7f8fb_58%,#f2effa_100%)] shadow-[0_24px_70px_rgba(50,49,80,0.12)] before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(#d9dce5_0.7px,transparent_0.7px)] before:bg-[length:17px_17px] before:opacity-40 shrink-0">
        <CardContent className="relative p-4 sm:p-6 lg:p-8">
          {/* Header row */}
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#c8494d]">
                {getHeaderLabel(mode, willAutoPublish)}
              </p>
              <h3 className="truncate font-display text-xl font-bold tracking-[-0.03em] text-[#172031] sm:text-2xl">{item.topic}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {item.scheduled_at && (
                <span className="flex items-center gap-1.5 text-[11px] text-[#697387]">
                  <Clock className="h-3.5 w-3.5" />
                  {mode === "next" ? "Comienza el " : ""}
                  {format(new Date(item.scheduled_at), "EEE d MMM, HH:mm", { locale: es })}
                </span>
              )}
              <span className={`font-display text-2xl font-bold ${item.status === "failed" ? "text-destructive" : "text-[#c8494d]"}`}>
                {item.status === "failed" ? "Error" : `${percent}%`}
              </span>
            </div>
          </div>

          <Progress value={percent} className="mb-6 h-2 overflow-hidden rounded-full bg-[#e7e9ef] [&>div]:bg-[linear-gradient(90deg,#f06459,#f59a62_52%,#6656c8)]" />

          {/* Step grid */}
          <div className={`grid gap-2 sm:gap-3 ${gridClass}`}>
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

              // Spinner only for steps that are actively processing
              const showSpinner = current && isActivelyProcessing

              // Per-step elapsed bar
              const stepElapsed = getStepElapsedPercent(s.key as StepKey, item, mode, nowMs)

              // ── Status label ──────────────────────────────────────
              // Use effectiveDone / effectiveCurrent for cover; plain done/current elsewhere.
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
                statusLabel = "Tocá para revisar"

              if (!effectiveDone && !effectiveCurrent)
                statusLabel = s.key === "video"   ? "~5-15 min" :
                              s.key === "script"  ? "~1-3 min"  :
                              s.key === "caption" ? "~1-3 min"  :
                              s.key === "copy"    ? "~10 seg"   : ""

              // ── Card styles ───────────────────────────────────────
              const copyCardClass = copyActive
                ? "border-[#aaa0e8] bg-[#f0eefc] shadow-sm ring-1 ring-[#6656c8]/20"
                : done
                  ? "border-[#bde5d3] bg-[#e2f6ef]"
                  : current
                    ? "border-[#f1b2a8] bg-white shadow-sm"
                    : "border-transparent bg-[#eef1f6]/75"

              const cardClass = isReview
                ? reviewActive
                  ? "border-[#6656c8] bg-[linear-gradient(145deg,#6656c8,#5142a5)] shadow-md shadow-[#5242a5]/30 ring-2 ring-[#aaa0e8]/60 ring-offset-1 hover:shadow-lg"
                  : done
                    ? "border-[#c9c2ef] bg-[#efedfc]"
                    : "border-transparent bg-[#eef1f6]/75"
                : isCopy   ? copyCardClass
                : effectiveDone    ? "border-[#bde5d3] bg-[#e2f6ef]"
                : effectiveCurrent ? "border-[#f1b2a8] bg-white shadow-sm"
                :                    "border-transparent bg-[#eef1f6]/75"

              const textClass   = reviewActive ? "text-white"
                                : copyActive   ? "text-[#5142a5]"
                                : (effectiveDone || effectiveCurrent ? "text-[#172031]" : "text-[#697387]")
              const descClass   = reviewActive ? "text-[#dcd7ff]"
                                : copyActive   ? "text-[#6656c8]/80"
                                : "text-[#697387]"
              const statusClass = reviewActive ? "font-medium text-[#dcd7ff]"
                                : copyActive   ? "font-medium text-[#6656c8]"
                                : "text-[#8b94a4]"

              return (
                <motion.div
                  key={s.key}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reduceMotion ? 0 : i * 0.07, duration: reduceMotion ? 0 : 0.38, ease: "easeOut" }}
                  className={`group min-h-[145px] rounded-2xl border p-3.5 transition-[transform,box-shadow,border-color,background-color] duration-200 hover:-translate-y-1 hover:shadow-[0_12px_23px_rgba(42,50,74,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f06459]/40 sm:min-h-[158px] ${reviewActive ? "cursor-pointer" : ""} ${cardClass}`}
                  onClick={reviewActive ? () => setReviewOpen(true) : undefined}
                  tabIndex={reviewActive ? 0 : undefined}
                  role={reviewActive ? "button" : undefined}
                  onKeyDown={reviewActive ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setReviewOpen(true)
                    }
                  } : undefined}
                >
                  <div className="mb-3 flex items-center gap-2">
                    {item.status === "failed" && i === 0 ? (
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                    ) : effectiveDone ? (
                      <CheckCircle2 className={`w-4 h-4 ${isReview || isCopy ? "text-violet-500 dark:text-violet-400" : "text-primary"}`} />
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

                  <p className={`hidden text-[10px] leading-tight sm:block ${descClass}`}>{s.desc}</p>

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
                </motion.div>
              )
            })}
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </>
  )
}
