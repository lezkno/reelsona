import { useGetVideos, usePublishVideo, getGetVideosQueryKey } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink, Play, Clock, AlertTriangle, CheckCircle2, Instagram } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"

export default function Videos() {
  const { data: videos, isLoading } = useGetVideos({ status: 'all' })
  const publishVideo = usePublishVideo()
  const { toast } = useToast()
  const queryClient = useQueryClient()

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

                {video.duration_seconds && (
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
                  <Button size="sm" className="w-full mt-2 mb-3 bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 border-0" onClick={() => handlePublish(video.id)} disabled={publishVideo.isPending}>
                    <Instagram className="w-4 h-4 mr-2" />
                    Publicar Ahora
                  </Button>
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
    </div>
  )
}
