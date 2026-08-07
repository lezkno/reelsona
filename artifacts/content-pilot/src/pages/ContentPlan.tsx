import { useGetContentPlan, useGenerateContentPlan, useDeleteContentItem, useGenerateVideo, useUpdateContentItem, useCreateContentItem, useProcessContentItemNow, getGetContentPlanQueryKey, type ContentPlanItem } from "@workspace/api-client-react"
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
import { Wand2, Edit3, Trash2, Video, CheckCircle2, Clock, AlertTriangle, CalendarDays, Plus, Zap } from "lucide-react"
import PipelineTimeline from "@/components/PipelineTimeline"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

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
  const [filter, setFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [days, setDays] = useState(7)
  const [postsPerDay, setPostsPerDay] = useState(1)

  const { data: items, isLoading } = useGetContentPlan({ status: filter === "all" ? undefined : filter as any, limit: 100 })
  const generatePlan = useGenerateContentPlan()
  const deleteItem = useDeleteContentItem()
  const generateVideo = useGenerateVideo()
  const updateItem = useUpdateContentItem()
  const createItem = useCreateContentItem()
  const processNow = useProcessContentItemNow()
  const [processingId, setProcessingId] = useState<number | null>(null)

  const handleProcessNow = (id: number) => {
    setProcessingId(id)
    processNow.mutate({ id }, {
      onSuccess: (r) => {
        if (r.success) {
          toast({ title: "Producción iniciada", description: "El video entró al pipeline: guion, video, caption y publicación." })
        } else {
          toast({ title: "No se pudo iniciar", description: r.message, variant: "destructive" })
        }
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.data?.error ?? "No se pudo iniciar la producción.", variant: "destructive" })
      },
      onSettled: () => setProcessingId(null),
    })
  }

  // "Add video to this day" dialog state
  const [addDay, setAddDay] = useState<Date | null>(null)
  const [addTopic, setAddTopic] = useState("")
  const [addTime, setAddTime] = useState("12:00")

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

  const handleGenerateVideo = (id: number) => {
    generateVideo.mutate({ data: { content_plan_id: id } }, {
      onSuccess: () => {
        toast({ title: "Video Generándose", description: "HeyGen está creando el video. Esto puede tardar unos minutos." })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo iniciar la generación del video.", variant: "destructive" })
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
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Plan de Contenido</h1>
          <p className="text-muted-foreground mt-1 text-lg">Tu calendario de ideas a videos publicados.</p>
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
      </div>

      <PipelineTimeline />

      <Tabs value={filter} onValueChange={setFilter} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-muted p-1 mb-6 inline-flex shrink-0">
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="draft">Borradores</TabsTrigger>
          <TabsTrigger value="scripted">Guiones Listos</TabsTrigger>
          <TabsTrigger value="ready">Videos Listos</TabsTrigger>
          <TabsTrigger value="published">Publicados</TabsTrigger>
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
                                    disabled={processingId !== null}
                                    onClick={() => handleProcessNow(item.id)}
                                  >
                                    <Zap className="w-3 h-3" />
                                    {processingId === item.id ? "Iniciando..." : "Crear ahora"}
                                  </Button>
                                )}
                              </>
                            ) : item.scheduled_at && (
                              <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(item.scheduled_at), "MMM d, HH:mm", { locale: es })}
                              </div>
                            )}
                          </div>

                          <div className="flex-1">
                            <h4 className="text-lg font-bold font-display leading-tight mb-2">{item.topic}</h4>
                            {item.hook && (
                              <p className="text-sm text-muted-foreground line-clamp-2 italic border-l-2 border-primary/30 pl-3 py-0.5">
                                "{item.hook}"
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {item.status === 'scripted' && (
                              <Button size="sm" className="gap-1" onClick={() => handleGenerateVideo(item.id)} disabled={generateVideo.isPending}>
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
