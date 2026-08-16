import {
  useGetVideos, usePublishVideo, useScheduleVideo, useDeleteVideo, useRetryVideo, useReapplyCaptions,
  useGetContentItem, useUpdateContentItem, useGetHeyGenAllLooks,
  getGetVideosQueryKey, getGetContentPlanQueryKey,
} from "@workspace/api-client-react"
import type { Video } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { VideoModal } from "@/components/VideoModal"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { ExternalLink, Play, Clock, AlertTriangle, CheckCircle2, Instagram, CalendarClock, Send, Trash2, CheckSquare, Square, X, RotateCcw, Loader2, Eye, Wand2, Download } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState, useCallback, useEffect } from "react"

// ── Video preview modal with caption/hashtag editing ─────────────────────────
function VideoPreviewModal({ video, onClose }: { video: Video | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: contentItem } = useGetContentItem(
    video?.content_plan_id ?? 0,
    { query: { enabled: !!video?.content_plan_id } as any }
  )
  const updateItem = useUpdateContentItem()

  const handleSaveCaption = useCallback(async (caption: string, hashtags: string) => {
    if (!contentItem?.id) return
    await new Promise<void>((resolve, reject) =>
      updateItem.mutate(
        { id: contentItem.id, data: { caption, hashtags } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
            resolve()
          },
          onError: reject,
        }
      )
    )
  }, [contentItem?.id, updateItem, queryClient])

  const handleRegenerateCaption = useCallback(async () => {
    if (!contentItem?.id) throw new Error("No item")
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""
    const res = await fetch(`${base}/api/content/${contentItem.id}/regenerate-caption`, {
      method: "POST",
      credentials: "include",
    })
    if (!res.ok) throw new Error("Error al regenerar caption")
    return res.json() as Promise<{ caption: string; hashtags: string }>
  }, [contentItem?.id])

  return (
    <VideoModal
      open={!!video}
      onClose={onClose}
      title={video?.topic ?? `Video #${video?.id}`}
      subtitle={video?.captioned_video_url ? "Con captions aplicados" : "Video generado"}
      headerIcon={Eye}
      videoSrc={video?.captioned_video_url}
      fallbackSrc={video?.video_url}
      thumbnailSrc={video?.thumbnail_url}
      caption={contentItem?.caption}
      hashtags={contentItem?.hashtags}
      onSaveCaption={contentItem ? handleSaveCaption : undefined}
      onRegenerateCaption={contentItem ? handleRegenerateCaption : undefined}
      dismissLabel="Cerrar"
    />
  )
}

// ── Circular video progress overlay ──────────────────────────────────────────
// Shows a blurred overlay with a blue SVG ring + percentage, matching the
// reference design. Progress uses a two-phase curve so it never hard-plateaus
// for long-running videos (WaveSpeed can take 5-15 minutes):
//
//   Phase 1 (fast, tau=80s):   0% → ~70% — feels responsive in the first 3 min.
//   Phase 2 (slow, tau=600s):  adds 0% → ~23% very slowly — keeps advancing.
//   Hard cap: 93% (never claims "done").
//   Plateau oscillation: when ≥ 88%, the value gently waves ±2% so the ring
//   looks alive instead of frozen.
function computeGeneratingProgress(createdAt: string | null | undefined): number {
  if (!createdAt) return 8;
  const elapsed = (Date.now() - new Date(createdAt as string).getTime()) / 1000;
  const fast = 70  * (1 - Math.exp(-elapsed / 80));   // 0 → 70% quickly
  const slow = 23  * (1 - Math.exp(-elapsed / 600));  // 0 → 23% very slowly
  const base = Math.min(93, Math.max(8, Math.round(fast + slow)));
  // Near the top: add a ±2% sine-wave so the number keeps moving visibly
  if (base >= 88) {
    const wave = Math.round(Math.sin(elapsed / 15) * 2);
    return Math.min(93, Math.max(84, base + wave));
  }
  return base;
}

function CircularVideoProgress({
  progress,
  label,
  ringColor = '#3b82f6',
}: {
  progress: number;
  label: string;
  ringColor?: string;
}) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(100, progress));
  const offset = circ * (1 - pct / 100);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px]">
      {/* Ring + percentage */}
      <div className="relative flex items-center justify-center w-16 h-16">
        <svg
          width="64" height="64"
          className="absolute inset-0 -rotate-90"
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx="32" cy="32" r={r}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="3.5"
          />
          {/* Progress arc */}
          <circle
            cx="32" cy="32" r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${circ}`}
            strokeDashoffset={`${offset}`}
          />
        </svg>
        <span className="relative z-10 text-white text-sm font-bold tabular-nums">
          {pct}%
        </span>
      </div>
      <span className="mt-3 text-white/80 text-[11px] font-medium tracking-wide px-4 text-center">
        {label}
      </span>
    </div>
  );
}

export default function Videos() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Avatar look images — used as blurred backgrounds while a video is generating
  const { data: allLooks } = useGetHeyGenAllLooks()
  const lookImageById = new Map((allLooks ?? []).map((l) => [l.id, l.image_url]))

  const { data: videos, isLoading } = useGetVideos(
    { status: 'all' },
    {
      query: {
        // Poll every 5 s while any video is rendering, publishing, processing captions/effects,
        // OR while a cover regeneration is in flight.
        refetchInterval: (query: any) => {
          const data = query?.state?.data
          if (!Array.isArray(data)) return 10000
          const anyActive = data.some((v: any) =>
            v.status === 'generating' ||
            v.status === 'publishing' ||
            ((v.caption_status === null || v.caption_status === 'processing') &&
              (v.status === 'ready' || v.status === 'published'))
          )
          // Fast poll (5 s) while something is in-flight; slow poll (10 s) otherwise
          // so scheduler-created videos appear without needing a manual refresh.
          return anyActive ? 5000 : 10000
        },
      } as any,
    }
  )

  const publishVideo = usePublishVideo()
  const scheduleVideo = useScheduleVideo()
  const deleteVideo = useDeleteVideo()
  const retryVideo = useRetryVideo()
  const reapplyCaptions = useReapplyCaptions()

  const [scheduleDialog, setScheduleDialog] = useState<{ videoId: number; topic: string; current?: string } | null>(null)
  const [scheduleDatetime, setScheduleDatetime] = useState("")
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null)

  // ── Publish confirmation ──────────────────────────────────────────────────
  const [publishConfirm, setPublishConfirm] = useState<Video | null>(null)

  // ── Delete state ──────────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<{ ids: number[]; label: string } | null>(null)
  const [downloading, setDownloading] = useState<Record<string, boolean>>({})

  const downloadFile = useCallback(async (url: string, filename: string, key: string) => {
    setDownloading(prev => ({ ...prev, [key]: true }))
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch {
      toast({ title: "Error al descargar", description: "No se pudo descargar el archivo.", variant: "destructive" })
    } finally {
      setDownloading(prev => ({ ...prev, [key]: false }))
    }
  }, [toast])

  const toggleSelect = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  const handleDeleteConfirmed = () => {
    if (!confirmDelete) return
    const ids = confirmDelete.ids
    Promise.all(ids.map(id => deleteVideo.mutateAsync({ id }))).then(() => {
      queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
      queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      toast({ title: ids.length === 1 ? "Video eliminado" : `${ids.length} videos eliminados` })
      setConfirmDelete(null)
      exitSelectMode()
    }).catch(() => {
      toast({ title: "Error al eliminar", variant: "destructive" })
      setConfirmDelete(null)
    })
  }

  const askDelete = (ids: number[], label: string) => setConfirmDelete({ ids, label })

  // ── Retry ─────────────────────────────────────────────────────────────────
  const handleRetry = (video: Video) => {
    retryVideo.mutate({ id: video.id }, {
      onSuccess: () => {
        toast({ title: "Reintentando", description: "El ítem volvió al estado 'Guión listo'. Puedes generarlo de nuevo." })
        queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo reintentar el video.", variant: "destructive" })
      }
    })
  }

  // ── Publish / schedule ────────────────────────────────────────────────────
  /** Opens the confirmation dialog before publishing */
  const handlePublish = (video: Video) => {
    setPublishConfirm(video)
  }

  const handlePublishConfirmed = () => {
    if (!publishConfirm) return
    const id = publishConfirm.id
    setPublishConfirm(null)
    publishVideo.mutate({ id, data: {} }, {
      onSuccess: () => {
        toast({ title: "Publicando", description: "El video se está publicando en Instagram." })
        queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
      },
      onError: (err: any) => {
        const detail = err?.response?.data?.error || err?.message || "No se pudo publicar el video."
        toast({ title: "Error", description: detail, variant: "destructive" })
      }
    })
  }

  const handleScheduleConfirm = () => {
    if (!scheduleDialog || !scheduleDatetime) return
    scheduleVideo.mutate(
      { id: scheduleDialog.videoId, data: { scheduled_publish_at: new Date(scheduleDatetime).toISOString() } },
      {
        onSuccess: () => {
          toast({ title: "Publicación programada", description: `Se publicará el ${format(new Date(scheduleDatetime), "PPp", { locale: es })}.` })
          queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
          setScheduleDialog(null)
          setScheduleDatetime("")
        },
        onError: () => toast({ title: "Error", description: "No se pudo programar la publicación.", variant: "destructive" })
      }
    )
  }

  const minDatetime = () => {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    d.setSeconds(0, 0)
    return d.toISOString().slice(0, 16)
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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-4xl font-display font-bold tracking-tight">Librería de Videos</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-lg">Todos los Reels generados.</p>
        </div>

        {videos && videos.length > 0 && (
          <div className="flex flex-wrap gap-2 sm:pt-1 shrink-0">
            {selectMode ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    selected.size === videos.length
                      ? setSelected(new Set())
                      : setSelected(new Set(videos.map(v => v.id)))
                  }
                >
                  {selected.size === videos.length
                    ? <><CheckSquare className="w-4 h-4" /> Deselec. todo</>
                    : <><Square className="w-4 h-4" /> Selec. todo</>
                  }
                </Button>
                {selected.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5"
                    onClick={() => askDelete([...selected], `${selected.size} video${selected.size > 1 ? "s" : ""}`)}
                  >
                    <Trash2 className="w-4 h-4" /> Eliminar ({selected.size})
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={exitSelectMode}>
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectMode(true)}>
                <CheckSquare className="w-4 h-4" /> Seleccionar
              </Button>
            )}
          </div>
        )}
      </div>

      {!videos || videos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Aún no has generado ningún video.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {videos.map((video) => {
            const isSelected = selected.has(video.id)
            const hasPlayable = !!(video.captioned_video_url || video.video_url)
            const captionStatus = (video as any).caption_status as string | null

            {/* Look up the avatar preview image for use as blurred background */}
            const avatarBgUrl = lookImageById.get((video as any).avatar_id ?? '') ?? null

            return (
              <Card
                key={video.id}
                className={`overflow-hidden group flex flex-col transition-all ${selectMode && isSelected ? "ring-2 ring-destructive" : selectMode ? "ring-1 ring-border" : ""}`}
              >
                <div
                  className="aspect-[9/16] bg-muted relative"
                  onClick={() => selectMode && toggleSelect(video.id)}
                >
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : avatarBgUrl ? (
                    /* Avatar preview as blurred background while generating */
                    <img
                      src={avatarBgUrl}
                      alt=""
                      aria-hidden="true"
                      className="w-full h-full object-cover scale-110"
                    />
                  ) : (
                    /* Fallback — no avatar image available */
                    <div className="w-full h-full bg-zinc-900" />
                  )}

                  {/* ── Generating overlay (blue ring + %) ──────────────────── */}
                  {video.status === 'generating' && (
                    <CircularVideoProgress
                      progress={computeGeneratingProgress((video as any).created_at ?? (video as any).updated_at)}
                      label="Generando video…"
                      ringColor="#3b82f6"
                    />
                  )}

                  {/* ── Applying effects overlay (violet ring + %) ───────────── */}
                  {video.status === 'ready' &&
                   (captionStatus === null || captionStatus === 'processing') && (
                    <CircularVideoProgress
                      progress={computeGeneratingProgress((video as any).created_at)}
                      label="Aplicando efectos…"
                      ringColor="#a855f7"
                    />
                  )}

                  {/* ── Publishing overlay ───────────────────────────────────── */}
                  {video.status === 'publishing' && !video.thumbnail_url && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px]">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-400 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-wider text-white/80">Publicando…</span>
                    </div>
                  )}

                  {/* Select checkbox overlay */}
                  {selectMode && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${isSelected ? "bg-destructive border-destructive" : "bg-white/20 border-white"}`}>
                        {isSelected && <CheckSquare className="w-5 h-5 text-white" />}
                      </div>
                    </div>
                  )}

                  {/* Play overlay (only in normal mode) */}
                  {!selectMode && hasPlayable && (
                    <button
                      onClick={() => setPreviewVideo(video)}
                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors"
                      aria-label="Reproducir video"
                    >
                      <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                        <Play className="w-6 h-6 text-black fill-black ml-0.5" />
                      </div>
                    </button>
                  )}

                  {/* Main status badge */}
                  <div className="absolute top-3 left-3">
                    {video.status === 'generating' && <Badge variant="warning" className="shadow-lg"><Clock className="w-3 h-3 mr-1"/> Generando</Badge>}
                    {video.status === 'ready' && (captionStatus === null || captionStatus === 'processing') && (
                      <Badge variant="warning" className="shadow-lg"><Clock className="w-3 h-3 mr-1"/> Aplicando captions…</Badge>
                    )}
                    {video.status === 'ready' && (captionStatus === 'done' || captionStatus === 'failed' || captionStatus === 'disabled') && (
                      <Badge variant="success" className="shadow-lg"><CheckCircle2 className="w-3 h-3 mr-1"/> Listo</Badge>
                    )}
                    {video.status === 'publishing' && (
                      <Badge className="shadow-lg bg-blue-500 hover:bg-blue-600"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Publicando…</Badge>
                    )}
                    {video.status === 'published' && <Badge className="shadow-lg bg-blue-500 hover:bg-blue-600"><ExternalLink className="w-3 h-3 mr-1"/> Publicado</Badge>}
                    {video.status === 'failed' && <Badge variant="destructive" className="shadow-lg"><AlertTriangle className="w-3 h-3 mr-1"/> Error</Badge>}
                  </div>

                  {/* Delete button (normal mode, appears on hover) */}
                  {!selectMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); askDelete([video.id], video.topic ?? `Video #${video.id}`) }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                      aria-label="Eliminar video"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {video.status === 'ready' && video.scheduled_publish_at && (
                    <div className="absolute bottom-3 left-2 right-2">
                      <div className="bg-black/70 text-white text-[10px] rounded px-2 py-1 flex items-center gap-1">
                        <CalendarClock className="w-3 h-3 shrink-0 text-primary" />
                        {format(new Date(video.scheduled_publish_at), "d MMM, HH:mm", { locale: es })}
                      </div>
                    </div>
                  )}

                  {video.duration_seconds && !video.scheduled_publish_at && video.status !== 'published' && (
                    <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs font-medium px-2 py-1 rounded">
                      0:{video.duration_seconds.toString().padStart(2, '0')}
                    </div>
                  )}
                </div>

                <CardContent className="p-4 flex-1 flex flex-col">
                  <h4 className="font-bold font-display line-clamp-2 text-sm mb-2 flex-1" title={video.topic || 'Video'}>
                    {video.topic || `Video #${video.id}`}
                  </h4>

                  {/* Error message for failed videos */}
                  {video.status === 'failed' && (video as any).error_message && (
                    <p className="text-[11px] text-destructive mb-2 line-clamp-3 leading-relaxed">
                      {(video as any).error_message}
                    </p>
                  )}

                  {/* Caption status badge */}
                  {video.status !== 'published' && video.status !== 'failed' && captionStatus && (
                    <div className="mb-2">
                      {captionStatus === 'processing' && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-yellow-600 border-yellow-300 bg-yellow-50">
                          <Clock className="w-3 h-3" /> Aplicando captions
                        </Badge>
                      )}
                      {captionStatus === 'done' && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-green-700 border-green-300 bg-green-50">
                          <CheckCircle2 className="w-3 h-3" /> Captions listos
                        </Badge>
                      )}
                      {captionStatus === 'failed' && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-destructive border-destructive/30 bg-destructive/5">
                          <AlertTriangle className="w-3 h-3" /> Captions fallaron
                        </Badge>
                      )}
                      {captionStatus === 'disabled' && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                          Sin captions
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Video effects badges */}
                  {(() => {
                    const fx = video.video_effects
                    if (!fx) return null
                    const active = [
                      fx.zoom       && "Zoom",
                      fx.ai_broll   && "B-roll",
                    ].filter(Boolean) as string[]
                    if (active.length === 0) return null
                    return (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {active.map((label) => (
                          <Badge key={label} variant="outline" className="text-[10px] gap-0.5 text-violet-600 border-violet-300 bg-violet-50 dark:text-violet-400 dark:border-violet-700 dark:bg-violet-950/40">
                            <Wand2 className="w-2.5 h-2.5" /> {label}
                          </Badge>
                        ))}
                      </div>
                    )
                  })()}

                  {/* Publishing spinner — shown while Instagram is processing */}
                  {!selectMode && video.status === 'publishing' && (
                    <div className="flex flex-col gap-1.5 mb-3">
                      <Button
                        size="sm"
                        className="w-full bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] opacity-80 border-0 text-white gap-1.5 text-xs"
                        disabled
                      >
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Publicando…
                      </Button>
                    </div>
                  )}

                  {/* Action buttons — ready videos */}
                  {!selectMode && video.status === 'ready' && (captionStatus === 'done' || captionStatus === 'failed' || captionStatus === 'disabled') && (
                    <div className="flex flex-col gap-1.5 mb-3">
                      <Button
                        size="sm"
                        className="w-full bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 border-0 text-white gap-1.5 text-xs"
                        onClick={() => handlePublish(video)}
                        disabled={publishVideo.isPending}
                      >
                        <Instagram className="w-3.5 h-3.5" /> Publicar ahora
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs gap-1.5"
                        onClick={() => {
                          setScheduleDialog({ videoId: video.id, topic: video.topic ?? `Video #${video.id}`, current: video.scheduled_publish_at ?? undefined })
                          setScheduleDatetime(video.scheduled_publish_at ? new Date(video.scheduled_publish_at).toISOString().slice(0, 16) : "")
                        }}
                      >
                        <CalendarClock className="w-3.5 h-3.5" />
                        {video.scheduled_publish_at ? "Cambiar horario" : "Programar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs gap-1.5"
                        disabled={reapplyCaptions.isPending}
                        onClick={() => {
                          reapplyCaptions.mutate({ id: video.id }, {
                            onSuccess: () => {
                              queryClient.invalidateQueries({ queryKey: getGetVideosQueryKey() })
                              queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
                              toast({ title: "Re-procesando efectos", description: "Los efectos se están aplicando. El video se actualizará automáticamente." })
                            },
                            onError: (err: any) => toast({ title: "Error", description: err?.message ?? "No se pudo re-aplicar los efectos", variant: "destructive" }),
                          })
                        }}
                      >
                        {reapplyCaptions.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        {reapplyCaptions.isPending ? "Aplicando…" : "Re-aplicar efectos"}
                      </Button>
                      {(video.captioned_video_url || video.video_url) && (
                        <Button
                          size="sm" variant="outline"
                          className="w-full text-xs gap-1.5"
                          disabled={!!downloading[`video-${video.id}`]}
                          onClick={() => {
                            const url = video.captioned_video_url ?? video.video_url ?? ""
                            const name = (video.topic ?? `video-${video.id}`).replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 60) + ".mp4"
                            downloadFile(url, name, `video-${video.id}`)
                          }}
                        >
                          {downloading[`video-${video.id}`] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Descargar video
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Download button for published videos */}
                  {!selectMode && video.status === 'published' && (video.captioned_video_url || video.video_url) && (
                    <div className="flex flex-col gap-1.5 mb-3">
                      <Button
                        size="sm" variant="outline"
                        className="w-full text-xs gap-1.5"
                        disabled={!!downloading[`video-${video.id}`]}
                        onClick={() => {
                          const url = video.captioned_video_url ?? video.video_url ?? ""
                          const name = (video.topic ?? `video-${video.id}`).replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 60) + ".mp4"
                          downloadFile(url, name, `video-${video.id}`)
                        }}
                      >
                        {downloading[`video-${video.id}`] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        Descargar video
                      </Button>
                    </div>
                  )}

                  {/* Retry button for failed videos */}
                  {!selectMode && video.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs gap-1.5 mb-3"
                      onClick={() => handleRetry(video)}
                      disabled={retryVideo.isPending}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {retryVideo.isPending ? "Reintentando…" : "Reintentar generación"}
                    </Button>
                  )}

                  <div className="text-xs text-muted-foreground mt-auto pt-2 border-t flex justify-between items-center">
                    <span>
                      {video.status === 'published' && (video as any).published_at
                        ? format(new Date((video as any).published_at), "d MMM, HH:mm", { locale: es })
                        : format(new Date(video.created_at), "dd MMM", { locale: es })}
                    </span>
                    {video.ig_permalink && (
                      <a href={video.ig_permalink} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1">
                        Ver en IG <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Video preview modal ───────────────────────────────────────────────── */}
      <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />

      {/* ── Publish confirmation dialog ──────────────────────────────────────── */}
      <AlertDialog open={!!publishConfirm} onOpenChange={(o) => { if (!o) setPublishConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Instagram className="w-5 h-5" /> Publicar en Instagram
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground line-clamp-2">{publishConfirm?.topic ?? `Video #${publishConfirm?.id}`}</p>
                {publishConfirm && (
                  <p>
                    {(publishConfirm as any).caption_status === 'done'
                      ? "✅ Este video tiene captions quemados aplicados."
                      : (publishConfirm as any).caption_status === 'disabled'
                      ? "ℹ️ Este video se publicará sin captions."
                      : "⚠️ Los captions de este video fallaron — se publicará sin captions."}
                  </p>
                )}
                <p>¿Confirmar publicación? Esta acción no se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePublishConfirmed}
              className="bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] text-white border-0 hover:opacity-90"
            >
              Publicar ahora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm delete dialog ────────────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" /> Eliminar video{confirmDelete && confirmDelete.ids.length > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              {confirmDelete && confirmDelete.ids.length === 1
                ? <>¿Eliminar <span className="font-medium">"{confirmDelete.label}"</span>? Esta acción no se puede deshacer. Si el video está vinculado a un ítem del plan de contenidos, el ítem volverá al estado "Guión listo".</>
                : <>¿Eliminar {confirmDelete?.ids.length} videos seleccionados? Esta acción no se puede deshacer.</>
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteVideo.isPending}
              onClick={handleDeleteConfirmed}
              className="gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              {deleteVideo.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Schedule dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!scheduleDialog} onOpenChange={(o) => { if (!o) { setScheduleDialog(null); setScheduleDatetime("") } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" /> Programar publicación
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
              <p className="text-[11px] text-muted-foreground">El video se publicará automáticamente en el horario elegido.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setScheduleDialog(null); setScheduleDatetime("") }}>Cancelar</Button>
            <Button size="sm" disabled={!scheduleDatetime || scheduleVideo.isPending} onClick={handleScheduleConfirm} className="gap-1.5">
              <Send className="w-3.5 h-3.5" />
              {scheduleVideo.isPending ? "Guardando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
