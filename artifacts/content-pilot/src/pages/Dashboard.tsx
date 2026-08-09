import { useGetDashboard, useGetVideos, usePublishVideo, useScheduleVideo, useGetInstagramAccount, useGetInstagramPosts, getGetDashboardQueryKey, getGetVideosQueryKey, getGetInstagramAccountQueryKey, getGetInstagramPostsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Zap, Play, BarChart, Calendar, Video, Clock, Instagram, CalendarClock, Send, ExternalLink, Film, Heart, MessageCircle } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useState, useEffect } from "react"

export default function Dashboard() {
  const { data: dashboard, isLoading } = useGetDashboard()
  const { data: allVideos } = useGetVideos({ status: 'ready' })
  const publishVideo = usePublishVideo()
  const scheduleVideo = useScheduleVideo()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [scheduleDialog, setScheduleDialog] = useState<{ videoId: number; topic: string } | null>(null)
  const [scheduleDatetime, setScheduleDatetime] = useState("")

  const readyVideos = allVideos ?? []

  // Refresh Instagram data every time the user opens / focuses the app
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetInstagramPostsQueryKey() })
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [queryClient])

  const { data: igStatus } = useGetInstagramAccount()
  const igConnected = !!(igStatus?.connected && igStatus.account)
  const { data: igPosts, isLoading: igPostsLoading } = useGetInstagramPosts({ limit: 12 })

  // Minimum datetime = now + 5 min (rounded to nearest minute)
  const minDatetime = () => {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    d.setSeconds(0, 0)
    return d.toISOString().slice(0, 16)
  }

  const handlePublishNow = (id: number) => {
    publishVideo.mutate({ id, data: {} }, {
      onSuccess: () => {
        toast({ title: "¡Publicado!", description: "El video fue enviado a Instagram." })
        queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
      },
      onError: () => {
        toast({ title: "Error al publicar", description: "Verificá la conexión con Instagram.", variant: "destructive" })
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
      <div className="space-y-6">
        <h1 className="text-4xl font-display font-bold">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Resumen de tu máquina de contenido</p>
        </div>
      </div>

      {!dashboard?.account_connected && (
        <Card className="border-dashed bg-secondary/5 border-secondary/20">
          <CardContent className="p-8 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-secondary/20 flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-secondary" />
            </div>
            <h3 className="text-xl font-bold font-display mb-2">Conecta tu cuenta de Instagram</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              Para que ContentPilot pueda analizar tu contenido y publicar automáticamente, necesitas conectar tu cuenta de Instagram.
            </p>
            <Button asChild>
              <Link href="/connect">Conectar Instagram</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {dashboard && (
        <>
          {/* Status Banner */}
          <Card className="overflow-hidden border-none shadow-md bg-gradient-to-r from-sidebar to-sidebar-accent text-sidebar-foreground">
            <div className="p-5 md:p-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div className={`w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center ${dashboard.automation_enabled ? 'bg-primary/20 text-primary' : 'bg-sidebar-foreground/10 text-sidebar-foreground/50'}`}>
                    <Zap className="w-6 h-6 md:w-8 md:h-8" />
                  </div>
                  {dashboard.automation_enabled && (
                    <div className="absolute top-0 right-0 w-3 h-3 md:w-4 md:h-4 rounded-full bg-green-500 border-2 border-sidebar" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl md:text-2xl font-bold font-display text-white">
                    {dashboard.automation_enabled ? "Automatización Activa" : "Automatización Pausada"}
                  </h2>
                  <p className="text-sm text-sidebar-foreground/70 line-clamp-2">
                    {dashboard.automation_enabled
                      ? "Tu sistema está produciendo y publicando contenido."
                      : "Activa la automatización para que el contenido se genere solo."}
                  </p>
                </div>
              </div>
              <div className="bg-black/20 rounded-lg p-3 md:p-4 backdrop-blur-sm">
                <p className="text-xs md:text-sm font-medium text-sidebar-foreground/60 mb-1">Próxima publicación</p>
                <div className="text-white font-bold text-sm flex items-center gap-2 flex-wrap">
                  <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
                  {dashboard.next_scheduled_at ? format(new Date(dashboard.next_scheduled_at), "PPp", { locale: es }) : "No programada"}
                </div>
              </div>
            </div>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Video className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Videos Generados</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.videos_generated_total}</h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-600">
                    <Play className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Publicados</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.videos_published_total}</h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                    <Calendar className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">En Cola (Listos)</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.content_items_ready}</h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600">
                    <BarChart className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Generando Ahora</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.videos_generating_now}</h3>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Listos para publicar ─────────────────────────────────────────────── */}
          {readyVideos.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-display font-bold flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    Listos para publicar
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {readyVideos.length} video{readyVideos.length !== 1 ? "s" : ""} esperando — publicalos ahora o programalos para más tarde.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/videos">Ver todos</Link>
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {readyVideos.map((video) => (
                  <Card key={video.id} className="overflow-hidden flex flex-col border-emerald-500/20 hover:border-emerald-500/40 transition-colors">
                    {/* Thumbnail */}
                    <div className="aspect-[9/16] max-h-56 bg-muted relative overflow-hidden">
                      {video.thumbnail_url ? (
                        <img src={video.thumbnail_url} alt="Thumbnail" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                          <Video className="w-10 h-10 opacity-30" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <Badge className="absolute top-2 left-2 bg-emerald-500 hover:bg-emerald-500 text-white text-[10px]">
                        Listo
                      </Badge>
                      {video.scheduled_publish_at && (
                        <div className="absolute bottom-2 left-2 right-2">
                          <div className="bg-black/70 text-white text-[10px] rounded px-2 py-1 flex items-center gap-1">
                            <CalendarClock className="w-3 h-3 shrink-0 text-primary" />
                            {format(new Date(video.scheduled_publish_at), "d MMM, HH:mm", { locale: es })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Info + actions */}
                    <CardContent className="p-3 flex flex-col gap-2 flex-1">
                      <p className="text-sm font-semibold line-clamp-2 leading-tight flex-1" title={video.topic ?? ""}>
                        {video.topic ?? `Video #${video.id}`}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Creado {format(new Date(video.created_at), "d MMM", { locale: es })}
                        {video.duration_seconds ? ` · 0:${String(video.duration_seconds).padStart(2, "0")}` : ""}
                      </p>

                      {/* Publish now */}
                      <Button
                        size="sm"
                        className="w-full h-8 text-xs gap-1.5 bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 border-0 text-white"
                        disabled={publishVideo.isPending}
                        onClick={() => handlePublishNow(video.id)}
                      >
                        <Instagram className="w-3.5 h-3.5" />
                        Publicar ahora
                      </Button>

                      {/* Schedule or update schedule */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs gap-1.5"
                        onClick={() => {
                          setScheduleDialog({ videoId: video.id, topic: video.topic ?? `Video #${video.id}` })
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Reels publicados en Instagram ──────────────────────────────────────── */}
      {igConnected && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-display font-bold flex items-center gap-2">
                <Film className="w-5 h-5 text-primary" />
                Reels Publicados
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">Tus publicaciones más recientes en Instagram.</p>
            </div>
          </div>

          {igPostsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
              ))}
            </div>
          ) : !igPosts || igPosts.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No se encontraron publicaciones en tu cuenta.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {igPosts.map((post) => (
                <a
                  key={post.id}
                  href={post.permalink ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-[9/16] rounded-xl overflow-hidden border bg-muted"
                >
                  {post.thumbnail_url ? (
                    <img
                      src={post.thumbnail_url}
                      alt={post.caption ?? "Reel"}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Film className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
                    <div className="flex items-center gap-3 text-xs font-medium">
                      <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {post.like_count}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> {post.comments_count}</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    {post.caption && (
                      <p className="text-[11px] mt-1 line-clamp-2 opacity-80">{post.caption}</p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Schedule dialog ────────────────────────────────────────────────────── */}
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
              <Label htmlFor="pub-datetime">Fecha y hora de publicación</Label>
              <Input
                id="pub-datetime"
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
