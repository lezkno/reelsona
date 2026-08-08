import { useGetContentPlan, useGetAutomation, type ContentPlanItem } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { FileText, UserSquare2, Captions, Send, CheckCircle2, Clock, AlertTriangle, Loader2 } from "lucide-react"

/**
 * Production pipeline:
 * 1. Guion            — AI writes hook, script, CTA, caption and hashtags
 * 2. Video con Avatar — HeyGen renders the video
 * 3. Caption Studio   — FFmpeg burns styled captions (only shown when captionsEnabled)
 * 4. Publicar en IG   — the Reel is uploaded and published
 *
 * When captions are DISABLED globally, step 3 (Caption Studio) is hidden and
 * the pipeline shows only 3 steps.
 */
const STEPS = [
  { key: "script",  label: "Guion",           desc: "La IA escribe el guion y el hook",       eta: "~1 min",    icon: FileText    },
  { key: "video",   label: "Video con Avatar", desc: "HeyGen crea el video con tu avatar",     eta: "~5-15 min", icon: UserSquare2 },
  { key: "caption", label: "Caption Studio",   desc: "Se aplican captions animados al video",  eta: "~2-5 min",  icon: Captions    },
  { key: "publish", label: "Publicar en IG",   desc: "Se sube y publica el Reel",              eta: "~2-5 min",  icon: Send        },
] as const

/**
 * Pipeline display modes.
 *
 *  generating       → HeyGen is actively rendering the video
 *  captioning       → ready, but captions are pending/processing (null or "processing")
 *  awaiting_publish → ready, captions terminal (done/failed/disabled), waiting to publish
 *  scripted_waiting → script done, waiting for video to be generated
 *  next             → upcoming draft/scripted scheduled in the future
 *  done             → all done, showing the last published item
 */
type PipelineMode = "generating" | "captioning" | "awaiting_publish" | "scripted_waiting" | "next" | "done"

/**
 * Determine which step (0-based) is the current/active step and the overall % progress.
 *
 * caption_status values: null | "disabled" | "processing" | "done" | "failed"
 *
 * Step mapping (4-step pipeline):
 *  step 0 → Guion
 *  step 1 → Video
 *  step 2 → Caption Studio
 *  step 3 → Publicar
 *  step 4 → all done
 */
function getProgress(item: ContentPlanItem): { step: number; percent: number } {
  const cs = item.caption_status

  switch (item.status) {
    case "draft":
      return { step: 0, percent: 10 }

    case "scripted":
      return { step: 1, percent: 35 }

    case "generating":
      return { step: 1, percent: 55 }

    case "ready": {
      // Only terminal caption states unlock the publish step.
      if (cs === "done" || cs === "failed" || cs === "disabled") {
        return { step: 3, percent: 90 }
      }
      // null (pending) or "processing" → caption step is still in flight
      return { step: 2, percent: 75 }
    }

    case "published":
      return { step: 4, percent: 100 }

    default:
      return { step: -1, percent: 0 }
  }
}

function pickActiveItem(items: ContentPlanItem[]): { item: ContentPlanItem; mode: PipelineMode } | null {
  // Priority 1: video is actively rendering in HeyGen
  const generating = items.find((i) => i.status === "generating")
  if (generating) return { item: generating, mode: "generating" }

  // Priority 2: ready but caption is still pending/processing
  const captioning = items.find(
    (i) => i.status === "ready" && (i.caption_status === null || i.caption_status === "processing")
  )
  if (captioning) return { item: captioning, mode: "captioning" }

  // Priority 3: ready with terminal caption — waiting to be published
  const awaitingPublish = items.find(
    (i) =>
      i.status === "ready" &&
      (i.caption_status === "done" || i.caption_status === "failed" || i.caption_status === "disabled")
  )
  if (awaitingPublish) return { item: awaitingPublish, mode: "awaiting_publish" }

  // Priority 4: scripted item (script done, video not yet started)
  const scripted = items.find((i) => i.status === "scripted")
  if (scripted) return { item: scripted, mode: "scripted_waiting" }

  // Priority 5: upcoming draft items scheduled in the future
  const upcoming = items
    .filter((i) => i.status === "draft" && i.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
  if (upcoming[0]) return { item: upcoming[0], mode: "next" }

  // Priority 6: last published (summary state)
  const lastPublished = [...items].reverse().find((i) => i.status === "published")
  if (lastPublished) return { item: lastPublished, mode: "done" }

  return null
}

function getHeaderLabel(mode: PipelineMode, willAutoPublish: boolean | undefined): string {
  switch (mode) {
    case "generating":       return "Producción en curso"
    case "captioning":       return "Aplicando captions al video"
    case "awaiting_publish": return willAutoPublish ? "En cola para publicar automáticamente" : "Listo para publicar manualmente"
    case "scripted_waiting": return willAutoPublish ? "Guion listo — el sistema generará el video" : "Guion listo — revisá y generá el video"
    case "next":             return "Próximo video en cola"
    case "done":             return "Último video producido"
  }
}

export default function PipelineTimeline() {
  const { data: items } = useGetContentPlan({ limit: 100 }, { query: { refetchInterval: 15000 } as any })
  const { data: automation } = useGetAutomation({ query: { refetchInterval: 10000 } as any })

  const active = items ? pickActiveItem(items) : null
  if (!active) return null

  const { item, mode } = active
  const { step, percent } = getProgress(item)
  const willAutoPublish = automation?.enabled && automation?.auto_publish

  // Caption Studio step is shown only when captions are globally enabled.
  // When captions are disabled, the step is hidden and the pipeline shows 3 steps.
  const captionsEnabled = automation?.captions_enabled ?? true
  const visibleSteps = captionsEnabled ? STEPS : STEPS.filter((s) => s.key !== "caption")

  // Remap step index when caption step is hidden (shift steps 3+ down by 1)
  const displayStep = !captionsEnabled && step >= 2 ? step - 1 : step

  // Only show a spinner when something is actively processing — not when waiting.
  const isActivelyProcessing = mode === "generating" || mode === "captioning"

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent shrink-0">
      <CardContent className="p-5">
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

        <div className={`grid gap-2 ${visibleSteps.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
          {visibleSteps.map((s, i) => {
            const Icon = s.icon
            const done    = displayStep > i
            // "current" means this step is the active/next one — not for draft or failed items
            const current = displayStep === i && mode !== "next" && mode !== "done" && item.status !== "draft" && item.status !== "failed"
            const failed  = item.status === "failed"
            // Spinner only when something is genuinely running
            const showSpinner = current && isActivelyProcessing

            // ── Status label ──────────────────────────────────────────────
            let statusLabel = done ? "Completado" : current ? "En espera..." : s.eta

            // Video step: distinguish rendering vs. queued
            if (s.key === "video" && current) {
              statusLabel = mode === "generating" ? "Renderizando..." : "En espera de HeyGen"
            }

            // Caption step: distinguish null (queued) vs. processing
            if (s.key === "caption" && current) {
              statusLabel = item.caption_status === "processing" ? "Procesando..." : "En cola..."
            }
            if (s.key === "caption" && done && item.caption_status === "failed") {
              statusLabel = "Omitido (error)"
            }

            // Publish step: be explicit about what's needed
            if (s.key === "publish" && current) {
              statusLabel = willAutoPublish ? "En cola para publicar" : "Publicar manualmente"
            }

            return (
              <div
                key={s.key}
                className={`rounded-lg border p-3 transition-colors ${
                  done    ? "bg-primary/10 border-primary/30" :
                  current ? "border-primary bg-background shadow-sm" :
                            "bg-muted/30 border-transparent"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {failed && i === 0 ? (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  ) : done ? (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  ) : showSpinner ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : current ? (
                    <Clock className="w-4 h-4 text-primary" />
                  ) : (
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className={`text-xs font-bold ${done || current ? "text-foreground" : "text-muted-foreground"}`}>
                    {i + 1}. {s.label}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight hidden sm:block">{s.desc}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">{statusLabel}</p>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
