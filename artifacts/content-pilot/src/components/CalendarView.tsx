import { useState } from "react"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, addMonths, subMonths, isSameDay, isSameMonth, startOfDay } from "date-fns"
import { es } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight, Plus, Trash2, Video, CheckCircle2, Clock, AlertTriangle, Edit3, Zap, Users, Send, Loader2, Play } from "lucide-react"
import type { ContentPlanItem } from "@workspace/api-client-react"

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-muted-foreground/40",
  scripted: "bg-blue-500",
  generating: "bg-amber-500",
  ready: "bg-emerald-500",
  published: "bg-primary",
  failed: "bg-destructive",
}
const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador", scripted: "Guion", generating: "Generando",
  ready: "Listo para publicar", published: "Publicado", failed: "Error",
}
const STATUS_ICON: Record<string, any> = {
  draft: Edit3, scripted: CheckCircle2, generating: Clock,
  ready: Video, published: CheckCircle2, failed: AlertTriangle,
}

interface Props {
  items: ContentPlanItem[]
  lookById: Map<string, { name: string; image_url: string | null }>
  onAddDay: (date: Date) => void
  onDelete: (id: number) => void
  onGenerateVideo: (id: number) => void
  onProcessNow: (id: number) => void
  onPublishNow: (videoId: number) => void
  onPreview: (item: ContentPlanItem) => void
  onPickAvatar: (item: ContentPlanItem) => void
  generateVideoPending: boolean
  publishingVideoId: number | null
  willAutoPublish: boolean
  /** Days of week (0=Sun…6=Sat) that are active in the automation schedule */
  scheduledDays?: number[]
}

type CalView = "month" | "week" | "day"

function ItemPill({ item, lookById, onDelete, onGenerateVideo, onProcessNow, onPublishNow, onPreview, onPickAvatar, generateVideoPending, publishingVideoId, willAutoPublish, compact = false }: {
  item: ContentPlanItem
  lookById: Map<string, { name: string; image_url: string | null }>
  onDelete: (id: number) => void
  onGenerateVideo: (id: number) => void
  onProcessNow: (id: number) => void
  onPublishNow: (videoId: number) => void
  onPreview: (item: ContentPlanItem) => void
  onPickAvatar: (item: ContentPlanItem) => void
  generateVideoPending: boolean
  publishingVideoId: number | null
  willAutoPublish: boolean
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const look = item.avatar_id ? lookById.get(item.avatar_id) : null
  const canChange = item.status === "draft" || item.status === "scripted"
  const Icon = STATUS_ICON[item.status] ?? Edit3
  const dot = STATUS_COLOR[item.status] ?? "bg-muted-foreground/40"

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`group w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium flex items-center gap-1 truncate transition-colors ${dot === "bg-primary" ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-muted hover:bg-muted/80"}`}
      >
        <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot} ${item.status === "ready" ? "animate-pulse" : ""}`} />
        <span className="truncate">{item.topic}</span>
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 flex items-start gap-2 hover:bg-muted/40 transition-colors"
      >
        {/* Avatar thumbnail */}
        <div
          onClick={(e) => { if (canChange) { e.stopPropagation(); onPickAvatar(item) } }}
          className={`shrink-0 w-9 h-9 rounded-full overflow-hidden border-2 ${canChange ? "border-primary/40 hover:border-primary cursor-pointer" : "border-muted cursor-default"} bg-muted flex items-center justify-center`}
        >
          {look?.image_url
            ? <img src={look.image_url} alt={look.name} className="w-full h-full object-cover" loading="lazy" />
            : <Users className="w-4 h-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[item.status]}</span>
            {item.scheduled_at && (
              <span className="text-[11px] text-muted-foreground ml-auto">
                {format(new Date(item.scheduled_at), "HH:mm")}
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-tight truncate">{item.topic}</p>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 flex flex-wrap gap-2 border-t pt-2">
          {(item.status === "draft" || item.status === "scripted") && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-primary border-primary/30"
              onClick={() => onProcessNow(item.id)}>
              <Zap className="w-3 h-3" /> Revisar guion
            </Button>
          )}
          {item.status === "scripted" && (
            <Button size="sm" className="h-7 gap-1 text-xs" disabled={generateVideoPending}
              onClick={() => onGenerateVideo(item.id)}>
              <Video className="w-3 h-3" /> Generar video
            </Button>
          )}
          {item.status === "ready" && item.video_id != null && (item.captioned_video_url || item.video_url) && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
              onClick={() => onPreview(item)}>
              <Play className="w-3 h-3" /> Ver video
            </Button>
          )}
          {item.status === "ready" && item.video_id != null && (() => {
            const captionTerminal = item.caption_status === "done" || item.caption_status === "failed" || item.caption_status === "disabled"
            if (!captionTerminal) {
              return (
                <span className="h-7 flex items-center gap-1 text-xs text-muted-foreground px-2 rounded border bg-muted/40">
                  <Loader2 className="w-3 h-3 animate-spin" /> Aplicando captions...
                </span>
              )
            }
            if (willAutoPublish) {
              return (
                <span className="h-7 flex items-center gap-1 text-xs text-primary px-2 rounded border border-primary/30 bg-primary/5">
                  <CheckCircle2 className="w-3 h-3" /> Se publicará automáticamente
                </span>
              )
            }
            return (
              <Button
                size="sm"
                className="h-7 gap-1 text-xs bg-gradient-to-r from-pink-500 to-orange-400 hover:from-pink-600 hover:to-orange-500 text-white border-0"
                disabled={publishingVideoId === item.video_id}
                onClick={() => onPublishNow(item.video_id!)}
              >
                <Send className="w-3 h-3" />
                {publishingVideoId === item.video_id ? "Publicando..." : "Publicar en Instagram"}
              </Button>
            )
          })()}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
            onClick={() => onDelete(item.id)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

export default function CalendarView({ items, lookById, onAddDay, onDelete, onGenerateVideo, onProcessNow, onPublishNow, onPreview, onPickAvatar, generateVideoPending, publishingVideoId, willAutoPublish, scheduledDays }: Props) {
  const [view, setView] = useState<CalView>("month")
  const [current, setCurrent] = useState(startOfDay(new Date()))

  const itemsOnDay = (day: Date) =>
    items.filter((i) => i.scheduled_at && isSameDay(new Date(i.scheduled_at), day))

  /** Is this weekday active in the automation schedule? */
  const isScheduledDay = (day: Date) => scheduledDays ? scheduledDays.includes(day.getDay()) : false

  // ── Month view ──────────────────────────────────────────────────────────────
  function MonthView() {
    const monthStart = startOfMonth(current)
    const monthEnd = endOfMonth(current)
    const start = startOfWeek(monthStart, { weekStartsOn: 1 })
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 })
    const days: Date[] = []
    let d = start
    while (d <= end) { days.push(d); d = addDays(d, 1) }

    return (
      <div className="flex flex-col h-full">
        {/* Week day headers */}
        <div className="grid grid-cols-7 border-b shrink-0">
          {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map((n) => (
            <div key={n} className="py-2 text-center text-xs font-semibold text-muted-foreground">{n}</div>
          ))}
        </div>
        {/* Day cells */}
        <div className="grid grid-cols-7 flex-1 divide-x divide-y">
          {days.map((day) => {
            const dayItems = itemsOnDay(day)
            const isToday = isSameDay(day, new Date())
            const inMonth = isSameMonth(day, current)
            const schedDay = inMonth && isScheduledDay(day)
            return (
              <div key={day.toISOString()}
                className={`min-h-[90px] p-1 flex flex-col gap-0.5 ${!inMonth ? "bg-muted/30" : ""} ${isToday ? "bg-primary/5" : ""} ${schedDay ? "border-b-2 border-b-emerald-500/40" : ""}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => { setCurrent(day); setView("day") }}
                      className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-colors hover:bg-primary hover:text-primary-foreground ${isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"} ${!inMonth ? "opacity-40" : ""}`}
                    >
                      {format(day, "d")}
                    </button>
                    {schedDay && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Día programado" />}
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddDay(day)}
                    className="opacity-0 hover:opacity-100 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-opacity [&]:opacity-100"
                    title="Agregar video"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {dayItems.slice(0, 3).map((item) => (
                  <ItemPill key={item.id} item={item} lookById={lookById}
                    onDelete={onDelete} onGenerateVideo={onGenerateVideo}
                    onProcessNow={onProcessNow} onPublishNow={onPublishNow} onPreview={onPreview} onPickAvatar={onPickAvatar}
                    generateVideoPending={generateVideoPending}
                    publishingVideoId={publishingVideoId} willAutoPublish={willAutoPublish} compact />
                ))}
                {dayItems.length > 3 && (
                  <button type="button" onClick={() => { setCurrent(day); setView("day") }}
                    className="text-[10px] text-primary font-medium pl-1">
                    +{dayItems.length - 3} más
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Week view ───────────────────────────────────────────────────────────────
  function WeekView() {
    const weekStart = startOfWeek(current, { weekStartsOn: 1 })
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-7 border-b shrink-0">
          {days.map((day) => {
            const isToday = isSameDay(day, new Date())
            const schedDay = isScheduledDay(day)
            return (
              <div key={day.toISOString()} className={`p-2 text-center border-r last:border-0 ${schedDay ? "border-b-2 border-b-emerald-500/50" : ""}`}>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  {format(day, "EEE", { locale: es })}
                  {schedDay && <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />}
                </p>
                <button
                  type="button"
                  onClick={() => { setCurrent(day); setView("day") }}
                  className={`mx-auto mt-0.5 w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center transition-colors hover:bg-primary hover:text-primary-foreground ${isToday ? "bg-primary text-primary-foreground" : ""}`}
                >
                  {format(day, "d")}
                </button>
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-7 divide-x flex-1 overflow-y-auto">
          {days.map((day) => {
            const dayItems = itemsOnDay(day)
            const isToday = isSameDay(day, new Date())
            return (
              <div key={day.toISOString()} className={`p-2 space-y-2 ${isToday ? "bg-primary/5" : ""}`}>
                {dayItems.map((item) => (
                  <ItemPill key={item.id} item={item} lookById={lookById}
                    onDelete={onDelete} onGenerateVideo={onGenerateVideo}
                    onProcessNow={onProcessNow} onPublishNow={onPublishNow} onPreview={onPreview} onPickAvatar={onPickAvatar}
                    generateVideoPending={generateVideoPending}
                    publishingVideoId={publishingVideoId} willAutoPublish={willAutoPublish} />
                ))}
                <button
                  type="button"
                  onClick={() => onAddDay(day)}
                  className="w-full border border-dashed rounded-lg py-1.5 text-xs text-muted-foreground hover:text-primary hover:border-primary transition-colors flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Agregar
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Day view ────────────────────────────────────────────────────────────────
  function DayView() {
    const dayItems = itemsOnDay(current)
    const isToday = isSameDay(current, new Date())

    return (
      <div className="flex flex-col h-full">
        <div className={`p-4 border-b shrink-0 ${isToday ? "bg-primary/5" : ""}`}>
          <p className="text-2xl font-display font-bold capitalize">
            {format(current, "EEEE d 'de' MMMM", { locale: es })}
          </p>
          <p className="text-sm text-muted-foreground">{dayItems.length} video{dayItems.length !== 1 ? "s" : ""} programado{dayItems.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {dayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <p className="text-sm">No hay videos programados para este día</p>
            </div>
          ) : (
            dayItems.map((item) => (
              <ItemPill key={item.id} item={item} lookById={lookById}
                onDelete={onDelete} onGenerateVideo={onGenerateVideo}
                onProcessNow={onProcessNow} onPublishNow={onPublishNow} onPreview={onPreview} onPickAvatar={onPickAvatar}
                generateVideoPending={generateVideoPending}
                publishingVideoId={publishingVideoId} willAutoPublish={willAutoPublish} />
            ))
          )}
          <button
            type="button"
            onClick={() => onAddDay(current)}
            className="w-full border border-dashed rounded-lg py-3 text-sm text-muted-foreground hover:text-primary hover:border-primary transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Agregar video a este día
          </button>
        </div>
      </div>
    )
  }

  // ── Nav helpers ──────────────────────────────────────────────────────────────
  const prev = () => {
    if (view === "month") setCurrent(subMonths(current, 1))
    else if (view === "week") setCurrent(subWeeks(current, 1))
    else setCurrent(addDays(current, -1))
  }
  const next = () => {
    if (view === "month") setCurrent(addMonths(current, 1))
    else if (view === "week") setCurrent(addWeeks(current, 1))
    else setCurrent(addDays(current, 1))
  }
  const todayLabel = () => {
    if (view === "month") return format(current, "MMMM yyyy", { locale: es })
    if (view === "week") {
      const ws = startOfWeek(current, { weekStartsOn: 1 })
      const we = endOfWeek(current, { weekStartsOn: 1 })
      return `${format(ws, "d MMM", { locale: es })} – ${format(we, "d MMM yyyy", { locale: es })}`
    }
    return format(current, "d 'de' MMMM yyyy", { locale: es })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Calendar toolbar */}
      <div className="flex items-center gap-2 mb-3 shrink-0 flex-wrap">
        {/* View switcher */}
        <div className="flex rounded-lg border overflow-hidden">
          {(["month", "week", "day"] as CalView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-0 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              {v === "month" ? "Mes" : v === "week" ? "Semana" : "Día"}
            </button>
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="w-7 h-7" onClick={prev}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" size="icon" className="w-7 h-7" onClick={next}><ChevronRight className="w-4 h-4" /></Button>
        </div>

        <span className="text-sm font-semibold capitalize flex-1">{todayLabel()}</span>

        <Button variant="outline" size="sm" className="text-xs h-7"
          onClick={() => setCurrent(startOfDay(new Date()))}>
          Hoy
        </Button>
      </div>

      {/* Calendar body */}
      <div className="flex-1 bg-card border rounded-xl shadow-sm overflow-hidden flex flex-col min-h-0">
        {view === "month" && <MonthView />}
        {view === "week" && <WeekView />}
        {view === "day" && <DayView />}
      </div>
    </div>
  )
}
