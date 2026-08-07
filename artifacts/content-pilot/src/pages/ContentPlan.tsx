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
import { useGetContentPlan, useGenerateContentPlan, useDeleteContentItem, useGenerateVideo, useUpdateContentItem, useCreateContentItem, useGetHeyGenAllLooks, useGenerateScript, usePublishVideo, useGetAutomation, getGetContentPlanQueryKey, type ContentPlanItem } from "@workspace/api-client-react"
import { Textarea } from "@/components/ui/textarea"
import { Wand2, Edit3, Trash2, Video, CheckCircle2, Clock, AlertTriangle, CalendarDays, Plus, Zap, Users, List, Calendar, Loader2, FileText, RefreshCw, Sparkles, Check, X, Send, Bot, Hand, Play } from "lucide-react"
import PipelineTimeline from "@/components/PipelineTimeline"
import CalendarView from "@/components/CalendarView"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState, useRef } from "react"

const statusConfig: Record<string, { label: string, variant: string, icon: any }> = {
  draft: { label: "Borrador", variant: "outline", icon: Edit3 },
  scripted: { label: "Guion Listo", variant: "secondary", icon: CheckCircle2 },
  generating: { label: "Generando Video", variant: "warning", icon: Clock },
  ready: { label: "Video Listo", variant: "success", icon: Video },
  published: { label: "Publicado", variant: "default", icon: CheckCircle2 },
  failed: { label: "Error", variant: "destructive", icon: AlertTriangle },
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
  const [dialogOpen, setDialogOpen] = useState(false)
  const [days, setDays] = useState(7)
  const [postsPerDay, setPostsPerDay] = useState(1)

  // Always fetch everything — filtering is done client-side so tab counts are
  // always accurate and switching tabs is instant (no extra network round-trips).
  const { data: allItems, isLoading } = useGetContentPlan({ limit: 100 })

  // Tab → which statuses to include
  const TAB_STATUSES: Record<string, string[]> = {
    all:        ["draft","scripted","generating","ready","published","failed"],
    draft:      ["draft"],
    scripted:   ["scripted"],
    active:     ["generating","ready"],   // "En Producción"
    published:  ["published"],
    failed:     ["failed"],
  }

  const items = filter === "all"
    ? allItems
    : (allItems ?? []).filter(i => TAB_STATUSES[filter]?.includes(i.status))

  // Count per logical tab (computed once, used for badges)
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
  const deleteItem = useDeleteContentItem()
  const generateVideo = useGenerateVideo()
  const updateItem = useUpdateContentItem()
  const createItem = useCreateContentItem()
  const publishVideo = usePublishVideo()
  const [publishingVideoId, setPublishingVideoId] = useState<number | null>(null)
  const [previewItem, setPreviewItem] = useState<ContentPlanItem | null>(null)
  const [editingTopic, setEditingTopic] = useState<{ id: number; value: string } | null>(null)
  const [suggestingId, setSuggestingId] = useState<number | null>(null)
  const [topicSuggestion, setTopicSuggestion] = useState<{ id: number; topic: string } | null>(null)

  const handleSuggestTopic = async (item: ContentPlanItem) => {
    setSuggestingId(item.id)
    setTopicSuggestion(null)
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""
      const res = await fetch(`${base}/api/content/${item.id}/suggest-topic`, { method: "POST" })
      const data = await res.json()
      if (data.topic) setTopicSuggestion({ id: item.id, topic: data.topic })
      else toast({ title: "Sin sugerencia", description: data.error ?? "Intentá de nuevo.", variant: "destructive" })
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

  // Script review modal state
  const [scriptModalItem, setScriptModalItem] = useState<ContentPlanItem | null>(null)
  const [scriptDraft, setScriptDraft] = useState<{ hook: string; script: string; cta: string } | null>(null)
  const [scriptGenerating, setScriptGenerating] = useState(false)
  const generateScript = useGenerateScript()
  // Tracks which item's generation is currently in-flight so stale callbacks
  // from a cancelled request never overwrite state for a different item.
  const scriptGenerationItemIdRef = useRef<number | null>(null)

  // Only block new video generation when HeyGen is actively rendering.
  // A "ready" item is just waiting for publish — it doesn't consume a HeyGen slot.
  const anyVideoInFlight = (allItems ?? []).some((i) => i.status === "generating")
  const generateBlocked = anyVideoInFlight || generateVideo.isPending

  const closeScriptModal = () => {
    // Clear the in-flight binding so any late-arriving callback is ignored
    scriptGenerationItemIdRef.current = null
    setScriptModalItem(null)
    setScriptDraft(null)
    setScriptGenerating(false)
  }

  /**
   * Open the script review modal.
   * - If the item already has a script, show it immediately.
   * - If not, generate one via AI first (POST /content/script).
   * The callback is bound to item.id via scriptGenerationItemIdRef so that
   * a stale response arriving after the user cancels and opens a different
   * item cannot overwrite the new item's state.
   */
  const handleOpenScriptReview = (item: ContentPlanItem) => {
    // Reset state for the new item before starting
    setScriptModalItem(item)
    setScriptDraft(null)
    setScriptGenerating(false)
    scriptGenerationItemIdRef.current = null

    if (item.hook || item.script || item.cta) {
      // Existing script — show it right away, no generation needed
      setScriptDraft({ hook: item.hook ?? "", script: item.script ?? "", cta: item.cta ?? "" })
    } else {
      // No script yet — generate one, binding the callback to this item's id
      setScriptGenerating(true)
      const boundItemId = item.id
      scriptGenerationItemIdRef.current = boundItemId
      generateScript.mutate({ data: { topic: item.topic } }, {
        onSuccess: (result) => {
          // Ignore if the user closed the modal or opened a different item
          if (scriptGenerationItemIdRef.current !== boundItemId) return
          setScriptDraft({ hook: result.hook, script: result.script, cta: result.cta })
          setScriptGenerating(false)
        },
        onError: (err: any) => {
          if (scriptGenerationItemIdRef.current !== boundItemId) return
          closeScriptModal()
          toast({ title: "No se pudo generar el guion", description: err?.data?.error ?? "Intentá de nuevo.", variant: "destructive" })
        },
      })
    }
  }

  /**
   * User approved the script (possibly with edits).
   * Save it via PATCH (which auto-moves draft→scripted), then trigger video generation.
   */
  const handleApproveAndGenerate = () => {
    if (!scriptModalItem || !scriptDraft) return
    const item = scriptModalItem
    const draft = scriptDraft

    // Save script fields (moves draft to scripted if not already)
    updateItem.mutate(
      { id: item.id, data: { hook: draft.hook, script: draft.script, cta: draft.cta } },
      {
        onSuccess: () => {
          // Now trigger video generation
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
        onError: () => {
          toast({ title: "Error al publicar", description: "Verificá la conexión con Instagram.", variant: "destructive" })
        },
        onSettled: () => setPublishingVideoId(null),
      }
    )
  }

  // "Add video to this day" dialog state
  const [addDay, setAddDay] = useState<Date | null>(null)
  const [addTopic, setAddTopic] = useState("")
  const [addTime, setAddTime] = useState("12:00")

  // Avatar thumbnail + picker
  const { data: allLooks } = useGetHeyGenAllLooks()
  const lookById = new Map((allLooks ?? []).map((l) => [l.id, l]))
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

  const handleGenerate = () => {
    generatePlan.mutate({ data: { days, posts_per_day: postsPerDay } }, {
      onSuccess: (created) => {
        setDialogOpen(false)
        toast({ title: "Plan Generado", description: `Se crearon ${created.length} ideas, programadas según tus días y horarios de Automatización.` })
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
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

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shadow-lg shadow-primary/20 bg-gradient-to-r from-primary to-violet-600">
                <Wand2 className="w-4 h-4" />
                Generar Ideas
              </Button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Generar Plan de Contenido</DialogTitle>
              <DialogDescription>
                Las ideas se programan automáticamente en los días y horarios que configuraste en Automatización, llenando los espacios libres (sin duplicar horarios ya ocupados).
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-2">
                <Label>Días de publicación</Label>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full h-10 rounded-md border bg-background px-3 text-sm">
                  {[3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} días</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Videos por día</Label>
                <select value={postsPerDay} onChange={(e) => setPostsPerDay(Number(e.target.value))} className="w-full h-10 rounded-md border bg-background px-3 text-sm">
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n} video{n > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Total: hasta {days * postsPerDay} ideas nuevas.
            </p>
            <DialogFooter>
              <Button onClick={handleGenerate} disabled={generatePlan.isPending} className="gap-2 w-full">
                <Wand2 className="w-4 h-4" />
                {generatePlan.isPending ? "Generando..." : "Generar y Programar"}
              </Button>
            </DialogFooter>
          </DialogContent>
            </Dialog>
          </div>{/* end button group */}
        </div>{/* end header row */}
      </div>{/* end header */}

      <PipelineTimeline />

      {/* Automation mode banner */}
      <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm shrink-0 ${willAutoPublish ? "border-primary/30 bg-primary/5 text-primary" : "border-muted-foreground/20 bg-muted/40 text-muted-foreground"}`}>
        {willAutoPublish
          ? <><Bot className="w-4 h-4 shrink-0" /><span><strong>Piloto automático activo</strong> — el sistema crea y publica los videos según tu calendario.</span></>
          : <><Hand className="w-4 h-4 shrink-0" /><span><strong>Modo manual</strong> — revisá, generá y publicá cada video cuando estés listo.</span></>
        }
      </div>

      {viewMode === "calendar" ? (
        <CalendarView
          items={items ?? []}
          lookById={lookById}
          onAddDay={(date) => { setAddDay(date); setAddTopic("") }}
          onDelete={handleDelete}
          onGenerateVideo={handleGenerateVideo}
          onProcessNow={handleProcessNow}
          onPublishNow={handlePublishNow}
          onPreview={setPreviewItem}
          onPickAvatar={setAvatarPickerItem}
          generateVideoPending={generateVideo.isPending}
          publishingVideoId={publishingVideoId}
          willAutoPublish={willAutoPublish}
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
                                <Clock className="w-3 h-3" />
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

                                {/* Inline AI suggestion */}
                                {topicSuggestion?.id === item.id && (
                                  <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex flex-col gap-2">
                                    <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                      <Sparkles className="w-3 h-3 text-primary" /> Sugerencia de IA
                                    </p>
                                    <p className="text-sm font-semibold leading-snug">{topicSuggestion.topic}</p>
                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        size="sm"
                                        className="h-7 gap-1 text-xs"
                                        onClick={handleAcceptSuggestion}
                                      >
                                        <Check className="w-3 h-3" /> Usar este
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 text-xs"
                                        disabled={suggestingId === item.id}
                                        onClick={() => handleSuggestTopic(item)}
                                      >
                                        <RefreshCw className="w-3 h-3" /> Otro
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
                                        onClick={() => setTopicSuggestion(null)}
                                      >
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
          // Block closing while any async work is in-flight so a late
          // generateScript callback cannot land in a different item's session.
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
              {" — "}Revisá y editá el guion antes de enviarlo a HeyGen.
            </DialogDescription>
          </DialogHeader>

          {scriptGenerating ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm">Generando guion con IA…</p>
            </div>
          ) : scriptDraft ? (
            <div className="space-y-4 py-2">
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
            <DialogDescription>
              {avatarPickerItem?.topic}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {(allLooks ?? []).map((look) => {
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
                <div className="bg-black">
                  <video
                    src={playUrl}
                    poster={previewItem.thumbnail_url ?? undefined}
                    controls
                    autoPlay={false}
                    className="w-full max-h-[60vh] object-contain"
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
  )
}

function ListVideo(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/></svg>
}
