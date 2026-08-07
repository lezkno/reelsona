import { useGetContentPlan, useGenerateContentPlan, useDeleteContentItem, useGenerateVideo, getGetContentPlanQueryKey, type ContentPlanItemStatus } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Wand2, Edit3, Trash2, Video, CheckCircle2, Clock, AlertTriangle } from "lucide-react"
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

export default function ContentPlan() {
  const [filter, setFilter] = useState<string>("all")
  const { data: items, isLoading } = useGetContentPlan({ status: filter === "all" ? undefined : filter as any })
  const generatePlan = useGenerateContentPlan()
  const deleteItem = useDeleteContentItem()
  const generateVideo = useGenerateVideo()
  
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const handleGenerate = () => {
    generatePlan.mutate({ data: { days: 7, posts_per_day: 1 } }, {
      onSuccess: () => {
        toast({ title: "Plan Generado", description: "Se han creado nuevas ideas para los próximos 7 días." })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Plan de Contenido</h1>
          <p className="text-muted-foreground mt-1 text-lg">Gestiona el pipeline de ideas a videos publicados.</p>
        </div>
        <Button onClick={handleGenerate} disabled={generatePlan.isPending} className="gap-2 shadow-lg shadow-primary/20 bg-gradient-to-r from-primary to-violet-600">
          <Wand2 className="w-4 h-4" />
          {generatePlan.isPending ? "Generando..." : "Generar Ideas (7 días)"}
        </Button>
      </div>

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
              <Button onClick={handleGenerate} variant="outline">Generar Ahora</Button>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-0">
                {items.map((item) => {
                  const conf = statusConfig[item.status]
                  const Icon = conf.icon
                  
                  return (
                    <div key={item.id} className="group flex flex-col md:flex-row gap-4 p-6 border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <div className="w-48 shrink-0 space-y-2">
                        <Badge variant={conf.variant as any} className="gap-1.5 flex w-fit">
                          <Icon className="w-3 h-3" />
                          {conf.label}
                        </Badge>
                        {item.scheduled_at && (
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
                        {item.status === 'draft' && (
                          <Button variant="secondary" size="sm" className="gap-1" onClick={() => toast({ title: "Modo edición no implementado", description: "El autoguardado funciona en la API pero la UI del editor requiere otra pantalla." })}>
                            <Wand2 className="w-3.5 h-3.5" /> Escribir
                          </Button>
                        )}
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
            </ScrollArea>
          )}
        </div>
      </Tabs>
    </div>
  )
}

function ListVideo(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/></svg>
}
