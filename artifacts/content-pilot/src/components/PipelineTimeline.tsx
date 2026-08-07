import { useGetContentPlan, type ContentPlanItem } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { FileText, UserSquare2, Send, CheckCircle2, Clock, AlertTriangle, Loader2 } from "lucide-react"

/**
 * Production pipeline (matches the automation engine):
 * 1. Guion + Caption  — AI writes hook, script, CTA, caption and hashtags (~1 min)
 * 2. Video con Avatar — HeyGen renders the video with the rotating avatar (~5-15 min)
 * 3. Publicar en IG   — the Reel is uploaded and published on Instagram (~2-5 min)
 */
const STEPS = [
  { key: "script", label: "Guion y Caption", desc: "La IA escribe el guion, hook y caption", eta: "~1 min", icon: FileText },
  { key: "video", label: "Video con Avatar", desc: "HeyGen crea el video con tu avatar", eta: "~5-15 min", icon: UserSquare2 },
  { key: "publish", label: "Publicar en Instagram", desc: "Se sube y publica el Reel", eta: "~2-5 min", icon: Send },
] as const

// status → { currentStep (0-based, -1 = not started, 3 = all done), percent }
const STATUS_MAP: Record<string, { step: number, percent: number }> = {
  draft: { step: -1, percent: 0 },
  scripted: { step: 1, percent: 35 },
  generating: { step: 1, percent: 60 },
  ready: { step: 2, percent: 85 },
  published: { step: 3, percent: 100 },
  failed: { step: -1, percent: 0 },
}

function pickActiveItem(items: ContentPlanItem[]): { item: ContentPlanItem, mode: "processing" | "next" | "done" } | null {
  const inProcess = items.find((i) => i.status === "generating")
    ?? items.find((i) => i.status === "ready")
  if (inProcess) return { item: inProcess, mode: "processing" }

  const now = Date.now()
  const upcoming = items
    .filter((i) => (i.status === "draft" || i.status === "scripted") && i.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
  const due = upcoming.find((i) => new Date(i.scheduled_at!).getTime() <= now)
  if (due) return { item: due, mode: "processing" }
  if (upcoming[0]) return { item: upcoming[0], mode: "next" }

  const lastPublished = [...items].reverse().find((i) => i.status === "published")
  if (lastPublished) return { item: lastPublished, mode: "done" }
  return null
}

export default function PipelineTimeline() {
  const { data: items } = useGetContentPlan({ limit: 100 }, { query: { refetchInterval: 30000 } as any })

  const active = items ? pickActiveItem(items) : null
  if (!active) return null

  const { item, mode } = active
  const { step, percent } = STATUS_MAP[item.status] ?? { step: -1, percent: 0 }
  const scheduled = item.scheduled_at ? new Date(item.scheduled_at) : null

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent shrink-0">
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
              {mode === "next" ? "Próximo video en cola" : mode === "done" ? "Último video producido" : "Producción en curso"}
            </p>
            <h3 className="font-display font-bold truncate">{item.topic}</h3>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {scheduled && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {mode === "next" ? "Comienza el " : ""}{format(scheduled, "EEE d MMM, HH:mm", { locale: es })}
              </span>
            )}
            <span className={`text-lg font-bold font-display ${item.status === "failed" ? "text-destructive" : "text-primary"}`}>
              {item.status === "failed" ? "Error" : `${percent}%`}
            </span>
          </div>
        </div>

        <Progress value={percent} className="h-1.5 mb-4" />

        <div className="grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done = step > i
            const current = step === i && mode !== "next" && item.status !== "draft" && item.status !== "failed"
            const failed = item.status === "failed"
            return (
              <div key={s.key} className={`rounded-lg border p-3 transition-colors ${done ? "bg-primary/10 border-primary/30" : current ? "border-primary bg-background shadow-sm" : "bg-muted/30 border-transparent"}`}>
                <div className="flex items-center gap-2 mb-1">
                  {failed && i === 0 ? (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  ) : done ? (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  ) : current ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className={`text-xs font-bold ${done || current ? "text-foreground" : "text-muted-foreground"}`}>
                    {i + 1}. {s.label}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight hidden sm:block">{s.desc}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">{done ? "Completado" : current ? "En proceso..." : s.eta}</p>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
