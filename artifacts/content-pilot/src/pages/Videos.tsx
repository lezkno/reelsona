import { useGetVideos, usePublishVideo, useScheduleVideo, getGetVideosQueryKey } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { ExternalLink, Play, Clock, AlertTriangle, CheckCircle2, Instagram, CalendarClock, Send } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

export default function Videos() {
  const { data: videos, isLoading } = useGetVideos({ status: 'all' })
  const publishVideo = usePublishVideo()
  const scheduleVideo = useScheduleVideo()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [scheduleDialog, setScheduleDialog] = useState<{ videoId: number; topic: string; current?: string } | null>(null)
  const [scheduleDatetime, setScheduleDatetime] = useState("")

  const minDatetime = () => {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    d.setSeconds(0, 0)
    return d.toISOString().slice(0, 16)
  }

  const handlePublish = (id: number) => {
    publishVideo.mutate({ id, data: {} }, {
      onSuccess: () => {
        toast({ title: "Publicando", description: "El video se está publicando en Instagram." })
        queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo publicar el video.", variant: "destructive" })
      }
    })
  }

  const handleScheduleConfirm = () => {
    if (!scheduleDialog || !scheduleDatetime) return
    scheduleVideo.mutate(
      { id: scheduleDialog.videoId, data: { scheduled_publish_at: new Date(scheduleDatetime).toISOString() } },
      {
        onSuccess: () => {
          toast({
            title: "Publicación programada",
            description: `Se publicará el ${format(new Date(scheduleDatetime), "PPp", { locale: es })}.`,
          })
          queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
          setScheduleDialog(null)
          setScheduleDatetime("")
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo programar la publicación.", variant: "destructive" })
        }
      }
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in">
        <h1 className="text-4xl font-display font-bold">Librería de Videos</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="aspect-[9/16] rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight">Librería de Videos</h1>
        <p className="text-muted-foreground mt-1 text-lg">Todos los Reels generados por HeyGen.</p>
      </div>

      {!videos || videos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Aún no has generado ningún video.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {videos.map((video) => (
            <Card key={video.id} className="overflow-hidden group flex flex-col">
              <div className="aspect-[9/16] bg-muted relative">
                {video.thumbnail_url ? (
                  <img src={video.thumbnail_url} alt="Thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary/10 text-secondary">
                    {video.status === 'generating' ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 rounded-full border-2 border-secondary border-t-transparent animate-spin" />
                        <span className="text-xs font-bold uppercase tracking-wider">Renderizando</span>
                      </div>
                    ) : (
                      <Play className="w-12 h-12 opacity-50" />
                    )}
                  </div>
                )}

                <div className="absolute top-3 left-3">
                  {video.status === 'generating' && <Badge variant="warning" className="shadow-lg"><Clock className="w-3 h-3 mr-1"/> Generando</Badge>}
                  {video.status === 'ready' && <Badge variant="success" className="shadow-lg"><CheckCircle2 className="w-3 h-3 mr-1"/> Listo</Badge>}
                  {video.status === 'published' && <Badge className="shadow-lg bg-blue-500 hover:bg-blue-600"><ExternalLink className="w-3 h-3 mr-1"/> Publicado</Badge>}
                  {video.status === 'failed' && <Badge variant="destructive" className="shadow-lg"><AlertTriangle className="w-3 h-3 mr-1"/> Error</Badge>}
                </div>

                {/* Scheduled indicator */}
                {video.status === 'ready' && video.scheduled_publish_at && (
                  <div className="absolute bottom-3 left-2 right-2">
                    <div className="bg-black/70 text-white text-[10px] rounded px-2 py-1 flex items-center gap-1">
                      <CalendarClock className="w-3 h-3 shrink-0 text-primary" />
                      {format(new Date(video.scheduled_publish_at), "d MMM, HH:mm", { locale: es })}
                    </div>
                  </div>
                )}

                {video.duration_seconds && !video.scheduled_publish_at && (
                  <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs font-medium px-2 py-1 rounded">
                    0:{video.duration_seconds.toString().padStart(2, '0')}
                  </div>
                )}
              </div>

              <CardContent className="p-4 flex-1 flex flex-col">
                <h4 className="font-bold font-display line-clamp-2 text-sm mb-2 flex-1" title={video.topic || 'Video'}>
                  {video.topic || `Video #${video.id}`}
                </h4>

                {video.status === 'ready' && (
                  <div className="flex flex-col gap-1.5 mb-3">
                    <Button
                      size="sm"
                      className="w-full bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 border-0 text-white gap-1.5 text-xs"
                      onClick={() => handlePublish(video.id)}
                      disabled={publishVideo.isPending}
                    >
                      <Instagram className="w-3.5 h-3.5" />
                      Publicar ahora
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs gap-1.5"
                      onClick={() => {
                        setScheduleDialog({ videoId: video.id, topic: video.topic ?? `Video #${video.id}`, current: video.scheduled_publish_at ?? undefined })
                        setScheduleDatetime(
                          video.scheduled_publish_at
                            ? new Date(video.scheduled_publish_at).toISOString().slice(0, 16)
                            : ""
                        )
                      }}
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      {video.scheduled_publish_at ? "Cambiar horario" : "Programar"}
                    </Button>
                  </div>
                )}

                <div className="text-xs text-muted-foreground mt-auto pt-2 border-t flex justify-between items-center">
                  <span>{format(new Date(video.created_at), "dd MMM", { locale: es })}</span>
                  {video.ig_permalink && (
                    <a href={video.ig_permalink} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1">
                      Ver en IG <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Schedule dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={!!scheduleDialog} onOpenChange={(o) => { if (!o) { setScheduleDialog(null); setScheduleDatetime("") } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" />
              Programar publicación
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground line-clamp-2">{scheduleDialog?.topic}</p>
            <div className="space-y-2">
              <Label htmlFor="pub-datetime-v">Fecha y hora de publicación</Label>
              <Input
                id="pub-datetime-v"
                type="datetime-local"
                value={scheduleDatetime}
                min={minDatetime()}
                onChange={(e) => setScheduleDatetime(e.target.value)}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                El video se publicará automáticamente en el horario elegido.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setScheduleDialog(null); setScheduleDatetime("") }}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!scheduleDatetime || scheduleVideo.isPending}
              onClick={handleScheduleConfirm}
              className="gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {scheduleVideo.isPending ? "Guardando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
