import { useGetDashboard, useGetVideos, usePublishVideo, useScheduleVideo, useGetInstagramAccount, useGetInstagramPosts, getGetDashboardQueryKey, getGetVideosQueryKey, getGetInstagramAccountQueryKey, getGetInstagramPostsQueryKey, useGetContentPlan, useGetStrategyProfile, useAuthStatus } from "@workspace/api-client-react"
import type { ContentPlanItem, StrategyProfile } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Zap, Play, PlayCircle, BarChart, Calendar, Video, Clock, Instagram, CalendarClock, Send, ExternalLink, Film, Heart, MessageCircle, Map, CheckCircle2, CircleDot, FileText, Loader2, AlertCircle, ArrowRight, ListChecks, Activity } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useState, useEffect } from "react"

export default function Dashboard() {
  const { data: authStatus } = useAuthStatus()
  const isAdmin = authStatus?.user?.role === "admin"
  const { data: dashboard, isLoading } = useGetDashboard()
  const { data: allVideos } = useGetVideos({ status: 'ready' })
  const { data: planData, isLoading: planLoading } = useGetContentPlan({ limit: 10000, status: "all" })
  const { data: strategyData, isLoading: strategyLoading } = useGetStrategyProfile()
  const publishVideo = usePublishVideo()
  const scheduleVideo = useScheduleVideo()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [scheduleDialog, setScheduleDialog] = useState<{ videoId: number; topic: string } | null>(null)
  const [scheduleDatetime, setScheduleDatetime] = useState("")

  const readyVideos = allVideos ?? []

  // Next scheduled reel (for banner) — same order as the content plan:
  // first pending item by scheduled_at ASC regardless of whether the time is past or future.
  const planItems = planData ?? []
  const nextItem = planItems
    .filter(i => {
      if (!i.scheduled_at || ["published", "failed"].includes(i.status)) return false
      return !isNaN(new Date(i.scheduled_at).getTime())
    })
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null

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
        toast({ title: "Error al publicar", description: "Verifica la conexión con Instagram.", variant: "destructive" })
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
        <h1 className="text-2xl sm:text-4xl font-display font-bold">Dashboard</h1>
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

          {/* ── Pipeline Status ──────────────────────────────────────────────────── */}
          <PipelineStatusCard
            planItems={planData ?? []}
            planLoading={planLoading}
            strategyProfile={strategyData?.profile ?? null}
            strategyLoading={strategyLoading}
          />

          {/* ── Actividad reciente ───────────────────────────────────────────────── */}
          <RecentActivityCard planItems={planData ?? []} planLoading={planLoading} />

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
                    <div className="flex items-center gap-2 text-xs font-medium flex-wrap">
                      <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {post.like_count}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> {post.comments_count}</span>
                      {post.plays != null && (
                        <span className="flex items-center gap-1"><Play className="w-3.5 h-3.5" /> {post.plays.toLocaleString()}</span>
                      )}
                      {post.reach != null && (
                        <span className="flex items-center gap-1"><Map className="w-3.5 h-3.5" /> {post.reach.toLocaleString()}</span>
                      )}
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

interface PipelineStatusCardProps {
  planItems: ContentPlanItem[]
  planLoading: boolean
  strategyProfile: StrategyProfile | null
  strategyLoading: boolean
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:      { label: "Borrador",    color: "text-muted-foreground bg-muted",       icon: <FileText className="w-3.5 h-3.5" /> },
  scripted:   { label: "Con Script",  color: "text-blue-600 bg-blue-500/10",         icon: <FileText className="w-3.5 h-3.5" /> },
  generating: { label: "Generando",   color: "text-purple-600 bg-purple-500/10",     icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  ready:      { label: "Listo",       color: "text-emerald-600 bg-emerald-500/10",   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  published:  { label: "Publicado",   color: "text-green-600 bg-green-500/10",       icon: <Play className="w-3.5 h-3.5" /> },
  failed:     { label: "Error",       color: "text-destructive bg-destructive/10",   icon: <AlertCircle className="w-3.5 h-3.5" /> },
}

function PipelineStatusCard({ planItems, planLoading, strategyProfile, strategyLoading }: PipelineStatusCardProps) {
  const loading = planLoading || strategyLoading

  // Strategy completeness
  const steps = strategyProfile?.steps_completed ?? []
  const strategy = strategyLabel(steps)
  const hasStrategy = strategy.done

  // Plan summary
  const hasPlan = planItems.length > 0
  const counts = planItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  // Next scheduled item: first pending item by scheduled_at ASC (same as content plan order),
  // including overdue items that haven't been published yet.
  const nextItem = planItems
    .filter(i => {
      if (!i.scheduled_at || ["published", "failed"].includes(i.status)) return false
      return !isNaN(new Date(i.scheduled_at).getTime())
    })
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null
  const upcoming = nextItem ? new Date(nextItem.scheduled_at!).getTime() : undefined

  // ── Loading skeleton ──
  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="flex gap-2 flex-wrap">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── No strategy yet ──
  if (!strategyProfile) {
    return (
      <Card className="border-dashed border-primary/20 bg-primary/5">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Map className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm">Estudio estratégico pendiente</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Completa el estudio para que ContentPilot pueda generar un plan de contenido personalizado.
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0" asChild>
            <Link href="/audit">
              Iniciar Estudio <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Strategy incomplete ──
  if (!hasStrategy) {
    return (
      <Card className="border-dashed border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
              <CircleDot className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm">{strategy.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                El estudio está en progreso. Termínalo para desbloquear la generación del plan.
              </p>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(["account", "market", "strategy"] as const).map((step) => {
                  const done = steps.includes(step)
                  const labels: Record<string, string> = { account: "Cuenta", market: "Mercado", strategy: "Estrategia" }
                  return (
                    <span
                      key={step}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${done ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                    >
                      {done ? <CheckCircle2 className="w-3 h-3" /> : <CircleDot className="w-3 h-3" />}
                      {labels[step]}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0 border-amber-500/40 hover:bg-amber-500/10" asChild>
            <Link href="/audit">
              {strategy.nextStep} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Strategy done, no plan yet ──
  if (!hasPlan) {
    return (
      <Card className="border-dashed border-secondary/30 bg-secondary/5">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary shrink-0">
              <ListChecks className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">Estrategia lista</p>
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 text-[10px] font-medium px-1.5">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Completa
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Todavía no hay un plan de contenido. Genera los primeros Reels para iniciar el pipeline.
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0" asChild>
            <Link href="/content">
              Generar Plan <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Full pipeline summary ──
  const activeStatuses = ["draft", "scripted", "generating", "ready"] as const
  const totalActive = activeStatuses.reduce((s, k) => s + (counts[k] ?? 0), 0)

  // Items currently rendering in HeyGen
  const generatingItems = planItems.filter(i => i.status === "generating")
  // Next item in the pipeline — same order as the content planner: scheduled_at ASC, then id ASC
  const nextToGenerate = planItems
    .filter(i => (i.status === "scripted" || i.status === "draft") && i.scheduled_at && !isNaN(new Date(i.scheduled_at).getTime()))
    .sort((a, b) => {
      const ta = new Date(a.scheduled_at!).getTime()
      const tb = new Date(b.scheduled_at!).getTime()
      return ta !== tb ? ta - tb : a.id - b.id
    })[0] ?? null

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Left: heading + badge counts */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                <ListChecks className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-sm leading-tight">Pipeline de contenido</p>
                <p className="text-[11px] text-muted-foreground">
                  {totalActive} item{totalActive !== 1 ? "s" : ""} activos · {counts["published"] ?? 0} publicados
                </p>
              </div>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-2">
              {(["draft", "scripted", "generating", "ready", "published", "failed"] as const).map((status) => {
                const count = counts[status]
                if (!count) return null
                const meta = STATUS_META[status]
                return (
                  <span
                    key={status}
                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${meta.color}`}
                  >
                    {meta.icon}
                    {meta.label}
                    <span className="font-bold">{count}</span>
                  </span>
                )
              })}
            </div>
          </div>

          {/* Right: next scheduled + CTA */}
          <div className="flex flex-col gap-2 sm:items-end shrink-0">
            {upcoming && (
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground mb-0.5 flex items-center gap-1 sm:justify-end">
                  <CalendarClock className="w-3 h-3" /> Próx. programado
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {format(new Date(upcoming), "d MMM, HH:mm", { locale: es })}
                </p>
              </div>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <Link href="/content">
                Ver plan <ExternalLink className="w-3 h-3" />
              </Link>
            </Button>
          </div>
        </div>

        {/* ── Generating now + next up ── */}
        {(generatingItems.length > 0 || nextToGenerate) && (
          <div className="border-t pt-4 space-y-3">
            {/* Generating items with animated progress bar */}
            {generatingItems.map(item => (
              <div key={item.id} className="rounded-lg bg-purple-500/5 border border-purple-500/20 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin shrink-0" />
                  <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide">Generando video</p>
                </div>
                <p className="text-sm font-medium text-foreground truncate mb-2">{item.topic}</p>
                {/* Indeterminate progress bar */}
                <div className="h-1.5 w-full rounded-full bg-purple-500/15 overflow-hidden">
                  <div className="h-full w-2/5 rounded-full bg-purple-500 animate-pulse" />
                </div>
              </div>
            ))}

            {/* Next up to generate */}
            {nextToGenerate && (
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 px-4 py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Video className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide mb-0.5">
                    {nextToGenerate.status === "scripted" ? "Próximo a generar" : "Próximo en el plan"}
                  </p>
                  <p className="text-sm font-medium text-foreground truncate">{nextToGenerate.topic}</p>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-500/10" asChild>
                  <Link href="/content">Ver <ArrowRight className="w-3 h-3" /></Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const ACTIVITY_META: Record<string, { label: string; color: string; dot: string; icon: React.ReactNode }> = {
  ready:     { label: "Listo",     color: "text-emerald-700 bg-emerald-500/10", dot: "bg-emerald-500", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  published: { label: "Publicado", color: "text-green-700 bg-green-500/10",     dot: "bg-green-500",   icon: <Play className="w-3.5 h-3.5" /> },
  failed:    { label: "Error",     color: "text-destructive bg-destructive/10", dot: "bg-destructive",  icon: <AlertCircle className="w-3.5 h-3.5" /> },
}
function strategyLabel(steps: string[]): { done: boolean; label: string; nextStep: string } {
  if (steps.includes("strategy")) return { done: true, label: "Estrategia completa", nextStep: "" }
  if (steps.includes("market")) return { done: false, label: "Falta generar estrategia", nextStep: "Continuar" }
  if (steps.includes("account")) return { done: false, label: "Falta el estudio de mercado", nextStep: "Continuar" }
  return { done: false, label: "Estudio estratégico pendiente", nextStep: "Iniciar" }
}

function RecentActivityCard({ planItems, planLoading }: { planItems: ContentPlanItem[]; planLoading: boolean }) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000

  const recentItems = planItems
    .filter(item => {
      if (!["ready", "published", "failed"].includes(item.status)) return false
      return new Date(item.updated_at).getTime() >= cutoff
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 10)

  if (planLoading) {
    return (
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (recentItems.length === 0) return null

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Actividad reciente</p>
            <p className="text-[11px] text-muted-foreground">Últimas 24 horas del pipeline</p>
          </div>
        </div>

        <ul className="space-y-2">
          {recentItems.map(item => {
            const meta = ACTIVITY_META[item.status]
            if (!meta) return null
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors">
                <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>
                  {meta.icon}
                  {meta.label}
                </span>
                <p className="text-sm text-foreground line-clamp-1 flex-1 min-w-0">
                  {item.topic ?? `Item #${item.id}`}
                </p>
                <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                  {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true, locale: es })}
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
