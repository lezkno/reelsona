import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { format, isSameDay } from "date-fns"
import { es } from "date-fns/locale"
import { useGetContentPlan, useGenerateContentPlan, useDeleteContentItem, useGenerateVideo, useUpdateContentItem, useCreateContentItem, useGetHeyGenAllLooks, useGetAvatarConfig, useGenerateScript, usePublishVideo, useGetAutomation, getGetContentPlanQueryKey, type ContentPlanItem, useGetSettings } from "@workspace/api-client-react"
import { useRegenerateScript, useReanalyzeContentPlan, useRescheduleOverdue, type RegenerateCriterion, DEFAULT_VIDEO_EFFECTS } from "@workspace/api-client-react"
import type { VideoEffects } from "@workspace/api-client-react"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Wand2, Edit3, Trash2, Video, CheckCircle2, Clock, AlertTriangle, CalendarDays, Plus, Zap, Users, List, Calendar, Loader2, FileText, RefreshCw, Sparkles, Check, X, Send, Bot, Hand, Play, Share2, ChevronDown, TrendingUp, SlidersHorizontal } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import PipelineTimeline from "@/components/PipelineTimeline"
import CalendarView from "@/components/CalendarView"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState, useRef, useEffect } from "react"
import { useLocation } from "wouter"

const statusConfig: Record<string, { label: string, variant: string, icon: any }> = {
  draft: { label: "Borrador", variant: "outline", icon: Edit3 },
  scripted: { label: "Guion Listo", variant: "secondary", icon: CheckCircle2 },
  generating: { label: "Generando Video", variant: "warning", icon: Clock },
  ready: { label: "Video Listo", variant: "success", icon: Video },
  published: { label: "Publicado", variant: "default", icon: CheckCircle2 },
  failed: { label: "Error", variant: "destructive", icon: AlertTriangle },
}

const CRITERION_OPTIONS: { value: RegenerateCriterion; label: string; description: string }[] = [
  { value: "educational",   label: "🎓 Educativo",     description: "Datos, takeaways, razonamiento claro" },
  { value: "controversial", label: "⚡ Polémico",       description: "Ángulo contra-intuitivo con evidencia real" },
  { value: "storytelling",  label: "📖 Narrativo",     description: "Historia con conflicto y resolución" },
  { value: "sales",         label: "💰 Ventas",         description: "Beneficio claro, CTA específico" },
  { value: "emotional",     label: "❤️ Emocional",     description: "Historia personal, empatía genuina" },
]

/** Returns color class for viral score badge */
function viralScoreColor(score: number | null | undefined): string {
  if (!score && score !== 0) return "bg-muted text-muted-foreground"
  if (score >= 70) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
  if (score >= 40) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
}

function groupByDay(items: ContentPlanItem[]): { date: Date | null, label: string, items: ContentPlanItem[] }[] {
  const groups: { date: Date | null, label: string, items: ContentPlanItem[] }[] = []
  for (const item of items) {
    const date = item.scheduled_at ? new Date(item.scheduled_at) : null
    const existing = groups.find((g) =>
      (g.date === null && date === null) || (g.date && date && isSameDay(g.date, date))
    )
    if (existing) {
      existing.items.push(item)
    } else {
      groups.push({
        date,
        label: date ? format(date, "EEEE d 'de' MMMM", { locale: es }) : "Sin programar",
        items: [item],
      })
    }
  }
  return groups
}

export default function ContentPlan() {
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list")
  const [filter, setFilter] = useState<string>("all")
  const { data: settings } = useGetSettings()
  const [localEffects, setLocalEffects] = useState<VideoEffects>(DEFAULT_VIDEO_EFFECTS)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [days, setDays] = useState(7)
  const [location, navigate] = useLocation()

  // Auto-open the generate dialog when coming from the strategy wizard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("generate") === "1") {
      setDialogOpen(true)
      // Clean the URL without triggering a navigation
      const clean = window.location.pathname
      window.history.replaceState(null, "", clean)
    }
  }, [location])

  const { data: allItems, isLoading } = useGetContentPlan(
    { limit: 100 },
    {
      query: {
        // Poll every 5 s while any item is generating a video or processing captions/effects
        refetchInterval: (query: any) => {
          const data = query?.state?.data
          if (!Array.isArray(data)) return false
          const anyActive = (data as ContentPlanItem[]).some(item =>
            item.status === 'generating' ||
            ((item.caption_status === null || item.caption_status === 'processing') &&
              (item.status === 'ready' || item.status === 'published'))
          )
          return anyActive ? 5000 : false
        },
      } as any,
    }
  )

  const TAB_STATUSES: Record<string, string[]> = {
    all:        ["draft","scripted","generating","ready","published","failed"],
    draft:      ["draft"],
    scripted:   ["scripted"],
    active:     ["generating","ready"],
    published:  ["published"],
    failed:     ["failed"],
  }

  const items = filter === "all"
    ? allItems
    : (allItems ?? []).filter(i => TAB_STATUSES[filter]?.includes(i.status))

  const counts = {
    all:       (allItems ?? []).length,
    draft:     (allItems ?? []).filter(i => i.status === "draft").length,
    scripted:  (allItems ?? []).filter(i => i.status === "scripted").length,
    active:    (allItems ?? []).filter(i => i.status === "generating" || i.status === "ready").length,
    published: (allItems ?? []).filter(i => i.status === "published").length,
    failed:    (allItems ?? []).filter(i => i.status === "failed").length,
  }
  const { data: automation } = useGetAutomation()
  const willAutoPublish = !!(automation?.enabled && automation?.auto_publish)

  const generatePlan = useGenerateContentPlan()
  const reanalyzePlan = useReanalyzeContentPlan()
  const deleteItem = useDeleteContentItem()
  const generateVideo = useGenerateVideo()
  const updateItem = useUpdateContentItem()
  const createItem = useCreateContentItem()
  const publishVideo = usePublishVideo()
  const regenerateScript = useRegenerateScript()
  const [publishingVideoId, setPublishingVideoId] = useState<number | null>(null)
  const [previewItem, setPreviewItem] = useState<ContentPlanItem | null>(null)
  const [editingTopic, setEditingTopic] = useState<{ id: number; value: string } | null>(null)
  const [suggestingId, setSuggestingId] = useState<number | null>(null)
  const [topicSuggestion, setTopicSuggestion] = useState<{ id: number; topic: string } | null>(null)
  const [criterionMenuId, setCriterionMenuId] = useState<number | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null)

  const handleSuggestTopic = async (item: ContentPlanItem) => {
    setSuggestingId(item.id)
    setTopicSuggestion(null)
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""
      const res = await fetch(`${base}/api/content/${item.id}/suggest-topic`, { method: "POST" })
      const data = await res.json()
      if (data.topic) setTopicSuggestion({ id: item.id, topic: data.topic })
      else toast({ title: "Sin sugerencia", description: data.error ?? "Intenta de nuevo.", variant: "destructive" })
    } catch {
      toast({ title: "Error", description: "No se pudo conectar con la IA.", variant: "destructive" })
    } finally {
      setSuggestingId(null)
    }
  }

  const handleAcceptSuggestion = () => {
    if (!topicSuggestion) return
    updateItem.mutate({ id: topicSuggestion.id, data: { topic: topicSuggestion.topic } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
        toast({ title: "Tema actualizado", description: "El nuevo tema fue guardado." })
      },
      onError: () => toast({ title: "Error", description: "No se pudo guardar el tema.", variant: "destructive" }),
    })
    setTopicSuggestion(null)
  }

  const handleRegenerateWithCriterion = (item: ContentPlanItem, criterion: RegenerateCriterion) => {
    setRegeneratingId(item.id)
    setCriterionMenuId(null)
    regenerateScript.mutate({ id: item.id, criterion }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
        const label = CRITERION_OPTIONS.find(c => c.value === criterion)?.label ?? criterion
        toast({ title: "Guion regenerado", description: `Guion regenerado con enfoque ${label}.` })
      },
      onError: (err: any) => {
        toast({ title: "Error al regenerar", description: err?.data?.error ?? "Intenta de nuevo.", variant: "destructive" })
      },
      onSettled: () => setRegeneratingId(null),
    })
  }

  // Script review modal state
  const [scriptModalItem, setScriptModalItem] = useState<ContentPlanItem | null>(null)
  const [scriptDraft, setScriptDraft] = useState<{ hook: string; script: string; cta: string } | null>(null)
  const [scriptGenerating, setScriptGenerating] = useState(false)
  const [hookCandidates, setHookCandidates] = useState<string[]>([])
  const [hookSelectionReason, setHookSelectionReason] = useState<string>("")
  const [showHookCandidates, setShowHookCandidates] = useState(false)
  const generateScript = useGenerateScript()
  const scriptGenerationItemIdRef = useRef<number | null>(null)

  const anyVideoInFlight = (allItems ?? []).some((i) => i.status === "generating")
  const generateBlocked = anyVideoInFlight || generateVideo.isPending

  // Overdue items: draft/scripted with a past scheduled date
  const now = new Date()
  const overdueItems = (allItems ?? []).filter(
    (i) => (i.status === "draft" || i.status === "scripted") && i.scheduled_at && new Date(i.scheduled_at) < now
  )
  const overdueCount = overdueItems.length
  const [overdueDialogOpen, setOverdueDialogOpen] = useState(false)
  const rescheduleOverdue = useRescheduleOverdue()

  const closeScriptModal = () => {
    scriptGenerationItemIdRef.current = null
    setScriptModalItem(null)
    setScriptDraft(null)
    setScriptGenerating(false)
    setHookCandidates([])
    setHookSelectionReason("")
    setShowHookCandidates(false)
  }

  const handleOpenScriptReview = (item: ContentPlanItem) => {
    setScriptModalItem(item)
    setScriptDraft(null)
    setScriptGenerating(false)
    setHookCandidates([])
    setHookSelectionReason("")
    setShowHookCandidates(false)
    scriptGenerationItemIdRef.current = null
    // Init per-video effects from item override or account default
    const itemOverride = (item as any).video_effects_override as VideoEffects | null
    setLocalEffects(itemOverride ?? settings?.video_effects ?? DEFAULT_VIDEO_EFFECTS)

    if (item.hook || item.script || item.cta) {
      setScriptDraft({ hook: item.hook ?? "", script: item.script ?? "", cta: item.cta ?? "" })
      // Load stored hook candidates if available
      if (item.hook_candidates) {
        try {
          const candidates = JSON.parse(item.hook_candidates) as string[]
          setHookCandidates(candidates)
        } catch { /* no-op */ }
      }
      if (item.hook_selection_reason) {
        setHookSelectionReason(item.hook_selection_reason)
      }
    } else {
      setScriptGenerating(true)
      const boundItemId = item.id
      scriptGenerationItemIdRef.current = boundItemId
      generateScript.mutate({ data: { topic: item.topic } }, {
        onSuccess: (result) => {
          if (scriptGenerationItemIdRef.current !== boundItemId) return
          setScriptDraft({ hook: result.hook, script: result.script, cta: result.cta })
          if (result.hook_candidates?.length) setHookCandidates(result.hook_candidates)
          if (result.hook_selection_reason) setHookSelectionReason(result.hook_selection_reason)
          setScriptGenerating(false)
        },
        onError: (err: any) => {
          if (scriptGenerationItemIdRef.current !== boundItemId) return
          closeScriptModal()
          toast({ title: "No se pudo generar el guion", description: err?.data?.error ?? "Intenta de nuevo.", variant: "destructive" })
        },
      })
    }
  }

  const handleApproveAndGenerate = () => {
    if (!scriptModalItem || !scriptDraft) return
    const item = scriptModalItem
    const draft = scriptDraft

    updateItem.mutate(
      { id: item.id, data: { hook: draft.hook, script: draft.script, cta: draft.cta, video_effects_override: localEffects } },
      {
        onSuccess: () => {
          generateVideo.mutate(
            { data: { content_plan_id: item.id } },
            {
              onSuccess: () => {
                setScriptModalItem(null)
                setScriptDraft(null)
                toast({ title: "Video Generándose", description: "HeyGen está creando el video. Esto puede tardar unos minutos." })
                queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
              },
              onError: (err: any) => {
                const msg = err?.data?.error ?? "No se pudo iniciar la generación del video."
                toast({ title: "Error al generar video", description: msg, variant: "destructive" })
                queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
              },
            }
          )
        },
        onError: (err: any) => {
          toast({ title: "Error al guardar guion", description: err?.data?.error ?? "No se pudo guardar el guion.", variant: "destructive" })
        },
      }
    )
  }

  const handleProcessNow = (id: number) => {
    const item = items?.find((i) => i.id === id)
    if (item) handleOpenScriptReview(item)
  }

  const handleGenerateVideo = (id: number) => {
    const item = items?.find((i) => i.id === id)
    if (item) handleOpenScriptReview(item)
  }

  const handlePublishNow = (videoId: number) => {
    setPublishingVideoId(videoId)
    publishVideo.mutate(
      { id: videoId, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
          toast({ title: "¡Publicado!", description: "El video fue enviado a Instagram." })
        },
        onError: (err: any) => {
          const detail: string =
            err?.response?.data?.error ||
            err?.message ||
            "Verifica la conexión con Instagram."
          toast({ title: "Error al publicar", description: detail, variant: "destructive" })
        },
        onSettled: () => setPublishingVideoId(null),
      }
    )
  }

  const [addDay, setAddDay] = useState<Date | null>(null)
  const [addTopic, setAddTopic] = useState("")
  const [addTime, setAddTime] = useState("12:00")

  const { data: allLooks } = useGetHeyGenAllLooks()
  const { data: avatarConfig } = useGetAvatarConfig()
  const lookById = new Map((allLooks ?? []).map((l) => [l.id, l]))
  const selectedAvatarIds = new Set(avatarConfig?.selected_avatar_ids ?? [])
  const pickerLooks = (allLooks ?? []).filter((l) => selectedAvatarIds.has(l.id))
  const [avatarPickerItem, setAvatarPickerItem] = useState<ContentPlanItem | null>(null)

  const handleSaveTopic = (id: number, value: string) => {
    const trimmed = value.trim()
    setEditingTopic(null)
    if (!trimmed) return
    updateItem.mutate({ id, data: { topic: trimmed } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() }),
      onError: () => toast({ title: "Error", description: "No se pudo guardar el título.", variant: "destructive" }),
    })
  }

  const handlePickAvatar = (itemId: number, avatarId: string) => {
    updateItem.mutate({ id: itemId, data: { avatar_id: avatarId } }, {
      onSuccess: () => {
        setAvatarPickerItem(null)
        toast({ title: "Avatar actualizado", description: "Este video usará el look elegido." })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: () => toast({ title: "Error", description: "No se pudo cambiar el avatar.", variant: "destructive" })
    })
  }

  const { toast } = useToast()
  const queryClient = useQueryClient()

  const derivedPostsPerDay = Math.max(1, (automation?.posting_times as string[] | undefined)?.length ?? 1)

  const handleGenerate = () => {
    generatePlan.mutate({ data: { days, posts_per_day: derivedPostsPerDay } }, {
      onSuccess: (created) => {
        setDialogOpen(false)
        toast({ title: "Plan Generado", description: `Se crearon ${created.length} ideas, programadas según tu configuración de Automatización.` })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.data?.error ?? "No se pudo generar el plan.", variant: "destructive" })
      }
    })
  }

  const handleDelete = (id: number) => {
    deleteItem.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Eliminado", description: "El contenido ha sido eliminado." })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      }
    })
  }

  const handleReschedule = (id: number, value: string) => {
    if (!value) return
    updateItem.mutate({ id, data: { scheduled_at: new Date(value).toISOString() } }, {
      onSuccess: () => {
        toast({ title: "Reprogramado", description: "Se actualizó la fecha de publicación." })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      }
    })
  }

  const handleAddToDay = () => {
    if (!addDay) return
    const [hh, mm] = addTime.split(":").map(Number)
    const scheduled = new Date(addDay)
    scheduled.setHours(hh, mm, 0, 0)
    createItem.mutate({ data: { topic: addTopic.trim() || undefined, scheduled_at: scheduled.toISOString() } }, {
      onSuccess: () => {
        setAddDay(null)
        setAddTopic("")
        toast({ title: "Video agregado", description: `Programado para el ${format(scheduled, "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}.` })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo agregar el video.", variant: "destructive" })
      }
    })
  }

  const groups = items ? groupByDay(items) : []

  const handleRescheduleOverdue = () => {
    rescheduleOverdue.mutate(undefined, {
      onSuccess: (data) => {
        setOverdueDialogOpen(false)
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
        toast({
          title: `${data.rescheduled} ${data.rescheduled === 1 ? "publicación reagendada" : "publicaciones reagendadas"}`,
          description: "Los contenidos fueron distribuidos en los próximos slots disponibles.",
        })
      },
      onError: (err: any) => {
        toast({ title: "Error al reagendar", description: err?.data?.error ?? "Intenta de nuevo.", variant: "destructive" })
      },
    })
  }

  return (
    <TooltipProvider>
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">

      {/* ── Overdue items banner ─────────────────────────────────────────────── */}
      {overdueCount > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 shrink-0">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm leading-tight">
                {overdueCount === 1
                  ? "1 publicación con fecha vencida"
                  : `${overdueCount} publicaciones con fechas vencidas`}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {overdueCount === 1
                  ? "Este contenido no fue procesado mientras el sistema estuvo pausado."
                  : "Estos contenidos no fueron procesados mientras el sistema estuvo pausado."}{" "}
                El sistema no los generará automáticamente hasta que los reagendes.
              </p>
            </div>
          </div>
          <Dialog open={overdueDialogOpen} onOpenChange={setOverdueDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 shrink-0">
                <CalendarDays className="w-4 h-4 mr-1.5" />
                Reagendar {overdueCount === 1 ? "publicación" : `${overdueCount} publicaciones`}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Reagendar contenidos vencidos</DialogTitle>
                <DialogDescription>
                  {overdueCount === 1
                    ? "Hay 1 contenido con fecha pasada."
                    : `Hay ${overdueCount} contenidos con fechas pasadas.`}{" "}
                  Se distribuirán en los próximos slots disponibles según los días, horarios y frecuencia que configuraste en Automatización.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border bg-muted/40 divide-y max-h-48 overflow-y-auto">
                {overdueItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.status === "scripted" ? "bg-violet-500" : "bg-muted-foreground"}`} />
                    <span className="flex-1 truncate text-foreground/80">{item.topic ?? "Sin título"}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {item.scheduled_at ? new Date(item.scheduled_at).toLocaleDateString("es", { day: "numeric", month: "short" }) : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Se colocarán después del último contenido ya programado, sin solapar fechas existentes.
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOverdueDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleRescheduleOverdue} disabled={rescheduleOverdue.isPending}>
                  {rescheduleOverdue.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reagendando…</> : "Confirmar y reagendar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="flex flex-col gap-3 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">Plan de Contenido</h1>
            <p className="text-muted-foreground mt-1">Tu calendario de ideas a videos publicados.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle */}
            <div className="flex rounded-lg border overflow-hidden">
              <button type="button" onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-r ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                <List className="w-4 h-4" /> Lista
              </button>
              <button type="button" onClick={() => setViewMode("calendar")}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                <Calendar className="w-4 h-4" /> Calendario
              </button>
            </div>

            <Button
              variant="outline"
              className="gap-2"
              disabled={reanalyzePlan.isPending}
              onClick={() => reanalyzePlan.mutate(undefined, {
                onSuccess: (data) => {
                  queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
                  toast({ title: "Temas actualizados", description: `${data.updated} tema${data.updated !== 1 ? "s" : ""} re-analizados con tu estrategia.` })
                },
                onError: (e: any) => toast({ title: "Error", description: e?.message ?? "No se pudo re-analizar.", variant: "destructive" }),
              })}
            >
              {reanalyzePlan.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Analizando…</>
                : <><Sparkles className="w-4 h-4" /> Re-analizar con estrategia</>}
            </Button>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shadow-lg shadow-primary/20 bg-gradient-to-r from-primary to-violet-600">
                <Wand2 className="w-4 h-4" />
                Generar Ideas
              </Button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Generar Ideas de Contenido</DialogTitle>
              <DialogDescription>
                La IA revisa tu plan actual y genera ideas nuevas para los espacios libres, según tu programación de Automatización.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              {/* Automation schedule summary */}
              {(() => {
                const DAY_SHORT: Record<number, string> = { 0: "Dom", 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb" }
                const configDays   = (automation?.days_of_week  as number[] | undefined) ?? []
                const configTimes  = (automation?.posting_times as string[]  | undefined) ?? []
                const futureItems  = (items ?? []).filter(i => i.scheduled_at && new Date(i.scheduled_at) > new Date())
                const lastItem     = futureItems.length > 0
                  ? futureItems.reduce((a, b) =>
                      new Date(a.scheduled_at!) > new Date(b.scheduled_at!) ? a : b)
                  : null

                return (
                  <div className="rounded-xl border bg-muted/30 p-4 space-y-3 text-sm">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tu configuración de Automatización</p>

                    <div className="flex items-start gap-3">
                      <CalendarDays className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium leading-tight">Días activos</p>
                        {configDays.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {[1,2,3,4,5,6,0].map((d) => (
                              <span key={d} className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${configDays.includes(d) ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground opacity-40"}`}>
                                {DAY_SHORT[d]}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5">Sin días configurados — configura Automatización primero.</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium leading-tight">Horarios · {derivedPostsPerDay} publicación{derivedPostsPerDay !== 1 ? "es" : ""} por día</p>
                        {configTimes.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {configTimes.map((t) => (
                              <span key={t} className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">{t}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5">Sin horarios configurados.</p>
                        )}
                      </div>
                    </div>

                    {lastItem && (
                      <div className="flex items-start gap-3 pt-1 border-t">
                        <Zap className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium leading-tight">Continúa desde</p>
                          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                            {format(new Date(lastItem.scheduled_at!), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              <div className="space-y-2">
                <Label className="text-sm font-medium">¿Cuántos días de publicación planificar?</Label>
                <div className="flex gap-2">
                  {[3, 5, 7, 10, 14].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays(d)}
                      className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-all ${
                        days === d
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Hasta {days * derivedPostsPerDay} ideas nuevas · sin pisar horarios ya ocupados.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleGenerate} disabled={generatePlan.isPending} className="gap-2 w-full">
                <Wand2 className="w-4 h-4" />
                {generatePlan.isPending ? "Generando ideas…" : "Generar y Programar"}
              </Button>
            </DialogFooter>
          </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <PipelineTimeline />

      {/* Automation mode banner */}
      <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm shrink-0 ${willAutoPublish ? "border-primary/30 bg-primary/5 text-primary" : "border-muted-foreground/20 bg-muted/40 text-muted-foreground"}`}>
        {willAutoPublish
          ? <><Bot className="w-4 h-4 shrink-0" /><span><strong>Piloto automático activo</strong> — el sistema crea y publica los videos según tu calendario.</span></>
          : <><Hand className="w-4 h-4 shrink-0" /><span><strong>Modo manual</strong> — revisa, genera y publica cada video cuando estés listo.</span></>
        }
      </div>

      {viewMode === "calendar" ? (
        <CalendarView
          items={items ?? []}
          lookById={lookById}
          onAddDay={(date) => {
            setAddDay(date)
            setAddTopic("")
            const times = (automation?.posting_times as string[] | undefined) ?? ["12:00"]
            const occupiedTimes = (items ?? [])
              .filter((i) => i.scheduled_at && isSameDay(new Date(i.scheduled_at), date))
              .map((i) => format(new Date(i.scheduled_at!), "HH:mm"))
            const available = times.find((t) => !occupiedTimes.includes(t)) ?? times[0] ?? "12:00"
            setAddTime(available)
          }}
          onDelete={handleDelete}
          onGenerateVideo={handleGenerateVideo}
          onProcessNow={handleProcessNow}
          onPublishNow={handlePublishNow}
          onPreview={setPreviewItem}
          onPickAvatar={setAvatarPickerItem}
          generateVideoPending={generateVideo.isPending}
          publishingVideoId={publishingVideoId}
          willAutoPublish={willAutoPublish}
          scheduledDays={(automation?.days_of_week as number[] | undefined) ?? []}
        />
      ) : (
      <Tabs value={filter} onValueChange={setFilter} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-muted p-1 mb-6 inline-flex shrink-0 flex-wrap gap-y-1">
          {([ 
            { value: "all",       label: "Todos" },
            { value: "draft",     label: "Borradores" },
            { value: "scripted",  label: "Guión listo" },
            { value: "active",    label: "En producción" },
            { value: "published", label: "Publicados" },
            ...(counts.failed > 0 ? [{ value: "failed", label: "Con errores" }] : []),
          ] as { value: string; label: string }[]).map(({ value, label }) => {
            const n = counts[value as keyof typeof counts] ?? 0
            const isEmpty = value !== "all" && n === 0
            return (
              <TabsTrigger
                key={value}
                value={value}
                disabled={isEmpty}
                className={isEmpty ? "opacity-35 cursor-not-allowed" : ""}
              >
                {label}
                {n > 0 && (
                  <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none
                    ${filter === value
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-foreground/10 text-foreground/70"
                    }`}>
                    {n}
                  </span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <div className="flex-1 bg-card border rounded-xl shadow-sm overflow-hidden flex flex-col relative">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !items || items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <ListVideo className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-bold font-display mb-2">No hay contenido en esta vista</h3>
              <p className="text-muted-foreground max-w-sm mb-6">Genera un nuevo plan o cambia el filtro para ver tus ideas.</p>
              <Button onClick={() => setDialogOpen(true)} variant="outline">Generar Ahora</Button>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-0">
                {groups.map((group) => (
                  <div key={group.label}>
                    <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur px-6 py-2 border-b flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-primary" />
                      <span className="text-sm font-bold font-display capitalize">{group.label}</span>
                      <span className="text-xs text-muted-foreground">· {group.items.length} video{group.items.length > 1 ? "s" : ""}</span>
                      {group.date && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 gap-1 text-xs text-primary hover:text-primary"
                          onClick={() => { setAddDay(group.date); setAddTopic("") }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Agregar video
                        </Button>
                      )}
                    </div>
                    {group.items.map((item) => {
                      const conf = statusConfig[item.status]
                      const Icon = conf.icon
                      const canRegenerate = item.status === "draft" || item.status === "scripted"

                      return (
                        <div key={item.id} className="group flex flex-col md:flex-row gap-4 p-6 border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <div className="w-48 shrink-0 space-y-2">
                            <Badge variant={conf.variant as any} className="gap-1.5 flex w-fit">
                              <Icon className="w-3 h-3" />
                              {conf.label}
                            </Badge>
                            {item.status !== "published" ? (
                              <>
                                <input
                                  type="datetime-local"
                                  className="w-full text-xs rounded-md border bg-background px-2 py-1 text-muted-foreground"
                                  value={item.scheduled_at ? format(new Date(item.scheduled_at), "yyyy-MM-dd'T'HH:mm") : ""}
                                  onChange={(e) => handleReschedule(item.id, e.target.value)}
                                />
                                {(item.status === "draft" || item.status === "scripted") && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-7 gap-1 text-xs border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
                                    disabled={generateBlocked}
                                    onClick={() => handleProcessNow(item.id)}
                                  >
                                    <Zap className="w-3 h-3" />
                                    Revisar guion
                                  </Button>
                                )}
                                {/* Regenerar con enfoque dropdown */}
                                {canRegenerate && (
                                  <div className="relative">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="w-full h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                                      disabled={regeneratingId === item.id}
                                      onClick={() => setCriterionMenuId(criterionMenuId === item.id ? null : item.id)}
                                    >
                                      {regeneratingId === item.id ? (
                                        <><Loader2 className="w-3 h-3 animate-spin" /> Regenerando…</>
                                      ) : (
                                        <><RefreshCw className="w-3 h-3" /> Regenerar guion <ChevronDown className="w-3 h-3 ml-auto" /></>
                                      )}
                                    </Button>
                                    {criterionMenuId === item.id && (
                                      <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover shadow-lg py-1">
                                        {CRITERION_OPTIONS.map((opt) => (
                                          <button
                                            key={opt.value}
                                            type="button"
                                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                                            onClick={() => handleRegenerateWithCriterion(item, opt.value)}
                                          >
                                            <div className="font-medium">{opt.label}</div>
                                            <div className="text-xs text-muted-foreground">{opt.description}</div>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {item.status === "ready" && item.video_id != null && (() => {
                                  const captionTerminal = item.caption_status === "done" || item.caption_status === "failed" || item.caption_status === "disabled"
                                  const playUrl = item.captioned_video_url || item.video_url
                                  if (!captionTerminal) {
                                    return (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground py-1">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Captions...
                                      </div>
                                    )
                                  }
                                  return (
                                    <div className="space-y-1.5">
                                      {playUrl && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="w-full h-7 gap-1 text-xs"
                                          onClick={() => setPreviewItem(item)}
                                        >
                                          <Play className="w-3 h-3" /> Ver video
                                        </Button>
                                      )}
                                      {willAutoPublish ? (
                                        <div className="flex items-center gap-1 text-xs text-primary py-0.5">
                                          <CheckCircle2 className="w-3 h-3" /> Auto-publicación
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          className="w-full h-7 gap-1 text-xs bg-gradient-to-r from-pink-500 to-orange-400 hover:from-pink-600 hover:to-orange-500 text-white border-0"
                                          disabled={publishingVideoId === item.video_id}
                                          onClick={() => handlePublishNow(item.video_id!)}
                                        >
                                          <Send className="w-3 h-3" />
                                          {publishingVideoId === item.video_id ? "Publicando..." : "Publicar en IG"}
                                        </Button>
                                      )}
                                    </div>
                                  )
                                })()}
                              </>
                            ) : item.scheduled_at && (
                              <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                {item.status === "published"
                                  ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                                  : <Clock className="w-3 h-3" />}
                                {item.status === "published" ? "Publicado " : ""}
                                {format(new Date(item.scheduled_at), "MMM d, HH:mm", { locale: es })}
                              </div>
                            )}
                          </div>

                          <div className="flex-1">
                            <div className="flex items-start gap-3 mb-2">
                              {(() => {
                                const look = item.avatar_id ? lookById.get(item.avatar_id) : null
                                const canChange = item.status === "draft" || item.status === "scripted"
                                return (
                                  <button
                                    type="button"
                                    title={look ? `Avatar: ${look.name}${canChange ? " · clic para cambiar" : ""}` : canChange ? "Elegir avatar para este video" : "Avatar en rotación"}
                                    onClick={() => canChange && setAvatarPickerItem(item)}
                                    className={`shrink-0 w-11 h-11 rounded-full overflow-hidden border-2 ${canChange ? "border-primary/40 hover:border-primary cursor-pointer" : "border-muted cursor-default"} bg-muted flex items-center justify-center`}
                                  >
                                    {look?.image_url ? (
                                      <img src={look.image_url} alt={look.name} className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                      <Users className="w-5 h-5 text-muted-foreground" />
                                    )}
                                  </button>
                                )
                              })()}
                              <div className="flex-1 min-w-0">
                                {item.status === "draft" && editingTopic?.id === item.id ? (
                                  <input
                                    autoFocus
                                    className="text-lg font-bold font-display leading-tight pt-1.5 bg-transparent border-b-2 border-primary outline-none w-full"
                                    value={editingTopic.value}
                                    onChange={(e) => setEditingTopic({ id: item.id, value: e.target.value })}
                                    onBlur={() => handleSaveTopic(item.id, editingTopic.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleSaveTopic(item.id, editingTopic.value)
                                      if (e.key === "Escape") setEditingTopic(null)
                                    }}
                                  />
                                ) : (
                                  <div className="flex items-start gap-1.5">
                                    <h4
                                      className={`text-lg font-bold font-display leading-tight pt-1.5 flex-1 min-w-0 ${item.status === "draft" ? "cursor-text hover:text-primary transition-colors" : ""}`}
                                      title={item.status === "draft" ? "Clic para editar el título" : undefined}
                                      onClick={() => item.status === "draft" && setEditingTopic({ id: item.id, value: item.topic })}
                                    >
                                      {item.topic}
                                      {item.status === "draft" && (
                                        <Edit3 className="inline-block w-3.5 h-3.5 ml-1.5 opacity-0 group-hover:opacity-40 transition-opacity align-middle" />
                                      )}
                                    </h4>
                                    {item.status === "draft" && (
                                      <button
                                        type="button"
                                        title="Generar nuevo tema con IA"
                                        disabled={suggestingId === item.id}
                                        onClick={() => handleSuggestTopic(item)}
                                        className="mt-1.5 shrink-0 p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                                      >
                                        {suggestingId === item.id
                                          ? <RefreshCw className="w-4 h-4 animate-spin" />
                                          : <Sparkles className="w-4 h-4" />
                                        }
                                      </button>
                                    )}
                                  </div>
                                )}

                                {/* ── Viral Editorial Engine metadata ──────────── */}
                                {(() => {
                                  const fx = item.video_effects_override ?? settings?.video_effects
                                  const hasActiveEffect = fx && (fx.zoom || fx.ai_broll || fx.text_cards)
                                  return (item.viral_score != null || item.editorial_angle || item.share_reason || hasActiveEffect)
                                })() && (
                                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                    {/* Viral score badge */}
                                    {item.viral_score != null && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-default ${viralScoreColor(item.viral_score)}`}>
                                            <TrendingUp className="w-2.5 h-2.5" />
                                            {item.viral_score}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="max-w-[200px] text-xs">
                                          Score viral: {item.viral_score}/100
                                          {item.novelty_level && ` · Novedad: ${item.novelty_level}`}
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {/* Editorial angle chip */}
                                    {item.editorial_angle && (
                                      <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                                        Formato {item.editorial_angle}
                                      </span>
                                    )}
                                    {/* Share reason tooltip */}
                                    {item.share_reason && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 cursor-default">
                                            <Share2 className="w-2.5 h-2.5" /> Compartible
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                                          {item.share_reason}
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {/* Avatar talking-head fit badge */}
                                    {item.visual_dependency && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-default ${
                                            item.visual_dependency === "low"
                                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                              : item.visual_dependency === "medium"
                                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                          }`}>
                                            <Video className="w-2.5 h-2.5" />
                                            {item.visual_dependency === "low" ? "Avatar ✓" : item.visual_dependency === "medium" ? "Avatar ~" : "Avatar ⚠"}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="max-w-[240px] text-xs space-y-1">
                                          <p className="font-semibold">
                                            {item.visual_dependency === "low" && "✓ Apto para talking-head"}
                                            {item.visual_dependency === "medium" && "~ Compatible con soporte visual simple"}
                                            {item.visual_dependency === "high" && "⚠ Alta dependencia visual — considerar reformular"}
                                          </p>
                                          {item.avatar_fit_reason && <p className="text-muted-foreground">{item.avatar_fit_reason}</p>}
                                          {item.suggested_visual_support && (() => {
                                            try {
                                              const supports = JSON.parse(item.suggested_visual_support) as string[];
                                              return <p className="text-muted-foreground">Soporte: {supports.join(", ")}</p>;
                                            } catch { return null; }
                                          })()}
                                          {item.format_fit_score != null && <p className="text-muted-foreground">Fit score: {Math.round(item.format_fit_score)}/100</p>}
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {/* Video effects badges (override or account default) */}
                                    {(() => {
                                      const fx = item.video_effects_override ?? settings?.video_effects
                                      if (!fx) return null
                                      const active = [
                                        fx.zoom       && "Zoom",
                                        fx.ai_broll   && "B-roll",
                                        fx.text_cards && "Texto",
                                      ].filter(Boolean) as string[]
                                      if (active.length === 0) return null
                                      return active.map((label) => (
                                        <span key={label} className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                                          <SlidersHorizontal className="w-2.5 h-2.5" /> {label}
                                        </span>
                                      ))
                                    })()}
                                  </div>
                                )}
                                {/* ─────────────────────────────────────────────── */}

                                {/* Inline AI suggestion */}
                                {topicSuggestion?.id === item.id && (
                                  <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex flex-col gap-2">
                                    <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                      <Sparkles className="w-3 h-3 text-primary" /> Sugerencia de IA
                                    </p>
                                    <p className="text-sm font-semibold leading-snug">{topicSuggestion.topic}</p>
                                    <div className="flex items-center gap-1.5">
                                      <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleAcceptSuggestion}>
                                        <Check className="w-3 h-3" /> Usar este
                                      </Button>
                                      <Button
                                        size="sm" variant="outline" className="h-7 gap-1 text-xs"
                                        disabled={suggestingId === item.id}
                                        onClick={() => handleSuggestTopic(item)}
                                      >
                                        <RefreshCw className="w-3 h-3" /> Otro
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setTopicSuggestion(null)}>
                                        <X className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            {item.hook && (
                              <p className="text-sm text-muted-foreground line-clamp-2 italic border-l-2 border-primary/30 pl-3 py-0.5">
                                "{item.hook}"
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {item.status === 'scripted' && (
                              <Button size="sm" className="gap-1" onClick={() => handleGenerateVideo(item.id)} disabled={generateBlocked || generateVideo.isPending}>
                                <Video className="w-3.5 h-3.5" /> Generar Video
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(item.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </Tabs>
      )}

      {/* ── Script Review Modal ───────────────────────────────────────────── */}
      <Dialog
        open={scriptModalItem !== null}
        onOpenChange={(open) => {
          if (!open && !scriptGenerating && !updateItem.isPending && !generateVideo.isPending) {
            closeScriptModal()
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Revisar guion
            </DialogTitle>
            <DialogDescription>
              {scriptModalItem?.topic && (
                <span className="font-medium">{scriptModalItem.topic}</span>
              )}
              {" — "}Revisa y edita el guion antes de enviarlo a HeyGen.
            </DialogDescription>
          </DialogHeader>

          {scriptGenerating ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm">Generando guion con IA…</p>
            </div>
          ) : scriptDraft ? (
            <div className="space-y-4 py-2">
              {/* Hook candidates section */}
              {hookCandidates.length > 0 && (
                <div className="rounded-xl border bg-primary/5 p-3 space-y-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full text-left"
                    onClick={() => setShowHookCandidates(v => !v)}
                  >
                    <TrendingUp className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold text-primary flex-1">
                      {hookCandidates.length} hooks evaluados — ganador seleccionado por IA
                    </span>
                    <ChevronDown className={`w-4 h-4 text-primary transition-transform ${showHookCandidates ? "rotate-180" : ""}`} />
                  </button>
                  {showHookCandidates && (
                    <div className="space-y-2 pt-1">
                      {hookCandidates.map((candidate, idx) => {
                        const isWinner = candidate === scriptDraft.hook
                        return (
                          <div
                            key={idx}
                            className={`rounded-lg p-2.5 text-sm border ${isWinner ? "border-primary/40 bg-primary/10" : "border-border bg-background"}`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${isWinner ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                {isWinner ? <Check className="w-3 h-3" /> : idx + 1}
                              </span>
                              <p className={`leading-snug ${isWinner ? "font-medium" : "text-muted-foreground"}`}>
                                {candidate}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                      {hookSelectionReason && (
                        <p className="text-xs text-muted-foreground italic pl-1 pt-1">
                          <strong>Razón de selección:</strong> {hookSelectionReason}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hook de apertura</Label>
                <Textarea
                  value={scriptDraft.hook}
                  onChange={(e) => setScriptDraft((d) => d ? { ...d, hook: e.target.value } : d)}
                  placeholder="El gancho que captura la atención en los primeros segundos…"
                  className="min-h-[70px] text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guion completo</Label>
                <Textarea
                  value={scriptDraft.script}
                  onChange={(e) => setScriptDraft((d) => d ? { ...d, script: e.target.value } : d)}
                  placeholder="El guion que leerá el avatar…"
                  className="min-h-[180px] text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CTA (llamada a la acción)</Label>
                <Textarea
                  value={scriptDraft.cta}
                  onChange={(e) => setScriptDraft((d) => d ? { ...d, cta: e.target.value } : d)}
                  placeholder="Qué debe hacer el espectador al final…"
                  className="min-h-[60px] text-sm"
                />
              </div>
            </div>
          ) : null}

          {/* ── Per-video effects override ────────────────────────────────── */}
          {scriptDraft && !scriptGenerating && (
            <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Efectos para este video</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "zoom" as const,       label: "Zoom",       desc: "Ken Burns" },
                  { key: "ai_broll" as const,   label: "B-roll IA",  desc: "gpt-image-1" },
                  { key: "text_cards" as const, label: "Cards",      desc: "Stats / CTA" },
                ] as const).map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight truncate">{label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
                    </div>
                    <Switch
                      checked={localEffects[key]}
                      onCheckedChange={(v) => setLocalEffects((e: VideoEffects) => ({ ...e, [key]: v }))}
                      className="shrink-0 scale-90"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              onClick={closeScriptModal}
              disabled={scriptGenerating || updateItem.isPending || generateVideo.isPending}
            >
              Cancelar
            </Button>
            <Button
              className="gap-2 sm:flex-1 bg-gradient-to-r from-primary to-violet-600 shadow-lg shadow-primary/20"
              disabled={scriptGenerating || !scriptDraft || updateItem.isPending || generateVideo.isPending || generateBlocked}
              onClick={handleApproveAndGenerate}
            >
              {updateItem.isPending || generateVideo.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Enviando a HeyGen…</>
              ) : (
                <><Video className="w-4 h-4" /> Aprobar y generar video</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={avatarPickerItem !== null} onOpenChange={(open) => !open && setAvatarPickerItem(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Elegir avatar para este video</DialogTitle>
            <DialogDescription>{avatarPickerItem?.topic}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {pickerLooks.map((look) => {
              const isCurrent = avatarPickerItem?.avatar_id === look.id
              return (
                <button
                  key={look.id}
                  type="button"
                  disabled={updateItem.isPending}
                  onClick={() => avatarPickerItem && handlePickAvatar(avatarPickerItem.id, look.id)}
                  className={`relative rounded-lg overflow-hidden border-2 text-left transition-all ${isCurrent ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/40"}`}
                >
                  <div className="aspect-[3/4] bg-muted">
                    {look.image_url ? (
                      <img src={look.image_url} alt={look.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Users className="w-6 h-6" /></div>
                    )}
                  </div>
                  {isCurrent && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
                    <p className="text-white text-[10px] font-medium truncate">{look.group_name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Video Preview Modal ───────────────────────────────────────────── */}
      <Dialog open={previewItem !== null} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base leading-snug">{previewItem?.topic}</DialogTitle>
            <DialogDescription className="text-xs">
              {previewItem?.caption_status === "done"
                ? "Con captions aplicados"
                : "Video generado por HeyGen"}
            </DialogDescription>
          </DialogHeader>
          {previewItem && (() => {
            const playUrl = previewItem.captioned_video_url || previewItem.video_url
            if (!playUrl) return <div className="px-4 pb-4 text-sm text-muted-foreground">URL no disponible.</div>
            return (
              <>
                <div className="w-full aspect-[9/16] overflow-hidden bg-black">
                  <video
                    key={previewItem.id}
                    src={playUrl}
                    poster={previewItem.thumbnail_url ?? undefined}
                    controls
                    playsInline
                    preload="auto"
                    onError={(e) => {
                      const el = e.currentTarget
                      if (previewItem.video_url && el.src !== previewItem.video_url) {
                        el.src = previewItem.video_url
                        el.load()
                      }
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="px-4 py-3 flex gap-2">
                  {!willAutoPublish && previewItem.video_id != null && (
                    <Button
                      className="flex-1 gap-2 bg-gradient-to-r from-pink-500 to-orange-400 hover:from-pink-600 hover:to-orange-500 text-white border-0"
                      disabled={publishingVideoId === previewItem.video_id}
                      onClick={() => {
                        handlePublishNow(previewItem.video_id!)
                        setPreviewItem(null)
                      }}
                    >
                      <Send className="w-4 h-4" />
                      {publishingVideoId === previewItem.video_id ? "Publicando..." : "Publicar en Instagram"}
                    </Button>
                  )}
                  {willAutoPublish && (
                    <p className="text-xs text-primary flex items-center gap-1.5 flex-1">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      Se publicará automáticamente en el horario programado.
                    </p>
                  )}
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={addDay !== null} onOpenChange={(open) => !open && setAddDay(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar video</DialogTitle>
            <DialogDescription>
              {addDay && <>Se programará para el <span className="font-medium capitalize">{format(addDay, "EEEE d 'de' MMMM", { locale: es })}</span>.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {addDay && automation?.days_of_week && !(automation.days_of_week as number[]).includes(addDay.getDay()) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Este día no está en tu programación de automatización. El item se procesará, pero no se publicará automáticamente en el horario habitual.</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Tema del video</Label>
              <input
                type="text"
                value={addTopic}
                onChange={(e) => setAddTopic(e.target.value)}
                placeholder="Dejalo vacío y la IA genera el tema"
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Hora de publicación</Label>
              {automation?.posting_times && (automation.posting_times as string[]).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(automation.posting_times as string[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAddTime(t)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                        addTime === t
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="time"
                value={addTime}
                onChange={(e) => setAddTime(e.target.value)}
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddToDay} disabled={createItem.isPending} className="gap-2 w-full">
              <Plus className="w-4 h-4" />
              {createItem.isPending ? "Agregando..." : "Agregar al plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}

function ListVideo(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/></svg>
}
