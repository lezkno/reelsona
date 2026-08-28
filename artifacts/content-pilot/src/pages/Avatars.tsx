import { useGetHeyGenVoices, useGetAvatarConfig, useUpdateAvatarConfig, getGetAvatarConfigQueryKey, getGetHeyGenVoicesQueryKey, AvatarConfigRotationStrategy } from "@workspace/api-client-react"
import {
  usePublicHeyGenAvatarGroups,
  useGetV3GroupLooks,
  useWavespeedPersonas,
  useDeleteWavespeedPersona,
  usePatchWavespeedPersona,
  usePatchWavespeedLook,
  useDeleteWavespeedLook,
  useWavespeedPersonaLooksStatus,
  useWavespeedVoices,
  useWavespeedVoiceStatus,
  useDeleteWavespeedVoice,
  useUpdateWavespeedVoice,
  useGenerateWavespeedPersonaLooks,
  fetchVoicePreview,
  WAVESPEED_PERSONAS_KEY,
  type WavespeedPersonaWithLooks,
  type WavespeedLookRow,
  type WavespeedVoiceRow,
} from "@workspace/api-client-react"
import { CreateWavespeedAvatarDialog } from "./CreateWavespeedAvatarDialog"
import { CloneWavespeedVoiceDialog } from "./CloneWavespeedVoiceDialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Slider } from "@/components/ui/slider"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { canUseFeature } from "@/lib/access"
import { useAccessState } from "@/hooks/useAccessState"
import { PremiumModal } from "@/components/PremiumModal"
import {
  Users, Save, CheckCircle2, Image as ImageIcon, Play, Square,
  Plus, Camera, CameraOff, Mic, RefreshCw, Upload, Loader2, AlertCircle, ChevronDown, Sparkles, Video,
  Trash2, Lock, ZoomIn, X, Volume2, Search, Pencil, SlidersHorizontal, Check,
} from "lucide-react"

// ── Rotation strategy sentinel ────────────────────────────────────────────────
const LOOK_DEFAULT_VOICE_SENTINEL = "avatar_default"

// ── Types ─────────────────────────────────────────────────────────────────────

type V3Group = {
  id: string
  name: string
  preview_image_url: string | null
  preview_video_url: string | null
  looks_count: number
  status: string | null
}

type V3Look = {
  id: string                // already has tp: prefix for photo_avatar
  name: string
  preview_image_url: string | null
  is_talking_photo: boolean
  avatar_type: string
}

type PreviewOrientation = "vertical" | "horizontal" | "unavailable"

/**
 * Preview assets are the only orientation signal provided by HeyGen's public
 * avatar catalog. Natural image dimensions work cross-origin and let the
 * picker fail closed when a preview is missing, square, or cannot be loaded.
 */
function usePreviewOrientations(urls: Array<string | null | undefined>) {
  const [orientations, setOrientations] = useState<Record<string, PreviewOrientation>>({})
  const resolvedUrls = useRef(new Set<string>())
  const urlKey = Array.from(new Set(urls.filter((url): url is string => Boolean(url))))
    .sort()
    .join("\u0001")

  useEffect(() => {
    if (!urlKey) return
    let cancelled = false

    for (const url of urlKey.split("\u0001")) {
      if (resolvedUrls.current.has(url)) continue
      resolvedUrls.current.add(url)

      const image = new Image()
      image.onload = () => {
        if (cancelled) return
        const isVertical = image.naturalHeight > image.naturalWidth
        setOrientations(prev => ({ ...prev, [url]: isVertical ? "vertical" : "horizontal" }))
      }
      image.onerror = () => {
        if (!cancelled) setOrientations(prev => ({ ...prev, [url]: "unavailable" }))
      }
      image.src = url
    }

    return () => { cancelled = true }
  }, [urlKey])

  return orientations
}

type VoiceOption = {
  voice_id: string
  name: string
  language: string
  gender: string | null
  preview_audio_url: string | null
  is_cloned: boolean
  is_mine?: boolean
  speed?: number | null
  /** Pitch adjustment percentage (-50…+50). Applied via SSML <prosody pitch> at generation time. */
  pitch?: number | null
  /** Cloned voice processing status from heygen_cloned_voices: pending | ready | failed | null */
  status?: string | null
  /**
   * Stable DB row PK for owned cloned voices (unchanged when voice_id is promoted from
   * voice_clone_id → final usable voice_id on completion). Used for toast tracking so a
   * pending → ready transition is detected even when voice_id changes.
   */
  clone_id?: number
}

// ── LookVoiceInline ───────────────────────────────────────────────────────────

function LookVoiceInline({
  lookId,
  voiceOverride,
  voiceOptions,
  onChangeVoice,
  isPublic = false,
}: {
  lookId: string
  voiceOverride: string | undefined
  voiceOptions: VoiceOption[]
  onChangeVoice: (lookId: string, voiceId: string) => void
  isPublic?: boolean
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const selectValue = voiceOverride && voiceOverride !== LOOK_DEFAULT_VOICE_SENTINEL ? voiceOverride : LOOK_DEFAULT_VOICE_SENTINEL
  const selectedVoice = voiceOptions.find((v) => v.voice_id === selectValue)

  const togglePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isPlaying) { audioRef.current?.pause(); audioRef.current = null; setIsPlaying(false); return }
    if (!selectedVoice?.preview_audio_url) return
    const audio = new Audio(selectedVoice.preview_audio_url)
    audioRef.current = audio
    audio.onended = () => setIsPlaying(false)
    audio.onerror = () => setIsPlaying(false)
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
  }

  const noVoiceWarning = isPublic && selectValue === LOOK_DEFAULT_VOICE_SENTINEL

  return (
    <div className="flex flex-col gap-0.5 mt-1.5 px-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setIsPlaying(false) }
            onChangeVoice(lookId, v)
          }}
        >
          <SelectTrigger className={`h-7 text-[11px] flex-1 bg-background/80 ${noVoiceWarning ? "border-amber-400/70" : "border-border/60"}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value={LOOK_DEFAULT_VOICE_SENTINEL}>
              <span className="text-[11px] font-medium text-primary">Predeterminada</span>
            </SelectItem>
            {voiceOptions.map((v) => (
              <SelectItem key={v.voice_id} value={v.voice_id}>
                <span className="text-[11px]">
                  {v.name}
                  {v.is_cloned ? " · clonada" : ""}
                  {v.gender === "male" ? " · masc." : v.gender === "female" ? " · fem." : ""}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          disabled={!selectedVoice?.preview_audio_url} onClick={togglePreview}
          title={selectedVoice?.preview_audio_url ? "Escuchar muestra" : "Sin muestra"}>
          {isPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </Button>
      </div>
      {noVoiceWarning && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 leading-tight">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Los avatares públicos necesitan voz asignada
        </p>
      )}
    </div>
  )
}

// ── LooksDialogV3 ─────────────────────────────────────────────────────────────

// Studio avatar looks can't be deleted via HeyGen API
const isLookDeletable = (look: V3Look) =>
  look.avatar_type !== "studio_avatar" && look.avatar_type !== "model_index"

function LooksDialogV3({
  group,
  isOwned,
  selectedIds,
  voiceOverrides,
  voiceOptions,
  onToggle,
  onChangeVoice,
  onClose,
  onLooksLoaded,
  verticalOnly = false,
  onDeselect,
  saveStatus = "idle",
  onPlanRequired,
}: {
  group: V3Group
  isOwned?: boolean
  selectedIds: Set<string>
  voiceOverrides: Record<string, string>
  voiceOptions: VoiceOption[]
  onToggle: (id: string) => void
  onChangeVoice: (lookId: string, voiceId: string) => void
  onClose: () => void
  onLooksLoaded?: (groupId: string, looks: V3Look[]) => void
  /** Public HeyGen avatars are kept vertical so they always fit the Reel canvas. */
  verticalOnly?: boolean
  /** Remove stale public horizontal looks that were selected before filtering existed. */
  onDeselect?: (ids: string[]) => void
  saveStatus?: "idle" | "saving" | "saved"
  /** Called when a plan-gated action is attempted without an active plan. */
  onPlanRequired?: () => void
}) {
  const { data, isLoading, refetch } = useGetV3GroupLooks(group.id, isOwned)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const lookDialogAccessState = useAccessState()
  const [forDelete, setForDelete] = useState<Set<string>>(new Set())
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deleteLook = { mutateAsync: async (_id: string) => ({ ok: true }) }
  const deleteGroup = { mutateAsync: async (_id: string) => ({ ok: true }) }

  const [selectMode, setSelectMode] = useState(false)
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [lightboxLook, setLightboxLook] = useState<V3Look | null>(null)
  const [hoveredLookId, setHoveredLookId] = useState<string | null>(null)


  const looks: V3Look[] = data?.looks ?? []
  const lookOrientations = usePreviewOrientations(
    verticalOnly ? looks.map(look => look.preview_image_url) : [],
  )
  const verticalLooks = useMemo(
    () => verticalOnly
      // Do not fail closed while a CDN preview is loading or cannot expose its
      // dimensions. The preview itself is still a valid asset; only an
      // explicitly measured horizontal image should be removed.
      ? looks.filter(look => look.preview_image_url && lookOrientations[look.preview_image_url] !== "horizontal")
      : looks,
    [looks, lookOrientations, verticalOnly],
  )
  const staleHorizontalSelection = useMemo(
    () => verticalOnly
      ? looks
          .filter(look => look.preview_image_url && lookOrientations[look.preview_image_url] === "horizontal" && selectedIds.has(look.id))
          .map(look => look.id)
      : [],
    [looks, lookOrientations, selectedIds, verticalOnly],
  )
  const deletableLooks = looks.filter(isLookDeletable)
  const allDeletableSelected = deletableLooks.length > 0 && deletableLooks.every(l => forDelete.has(l.id))

  const selectedInGroup = verticalLooks.filter(l => selectedIds.has(l.id))
  const visibleLooks = showOnlySelected ? selectedInGroup : verticalLooks

  // Reset filter when dialog opens/closes or when leaving select mode
  useEffect(() => { if (selectMode) setShowOnlySelected(false) }, [selectMode])

  useEffect(() => {
    if (verticalLooks.length > 0) onLooksLoaded?.(group.id, verticalLooks)
  }, [group.id, onLooksLoaded, verticalLooks])

  useEffect(() => {
    if (staleHorizontalSelection.length > 0) onDeselect?.(staleHorizontalSelection)
  }, [onDeselect, staleHorizontalSelection])

  const toggleForDelete = (id: string) => {
    setForDelete(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allDeletableSelected) {
      setForDelete(new Set())
    } else {
      setForDelete(new Set(deletableLooks.map(l => l.id)))
    }
  }

  const handleDeleteSelected = async () => {
    setDeleting(true)
    let failed = 0
    for (const id of Array.from(forDelete)) {
      try {
        await deleteLook.mutateAsync(id)
      } catch {
        failed++
      }
    }
    await refetch()
    queryClient.invalidateQueries({ queryKey: ["heygen", "my-avatar-groups"] })
    setForDelete(new Set())
    setSelectMode(false)
    setDeleting(false)
    if (failed > 0) {
      toast({ title: `${failed} look(s) no se pudieron eliminar`, variant: "destructive" })
    } else {
      toast({ title: "Looks eliminados correctamente" })
    }
  }

  const handleDeleteGroup = async () => {
    setDeleting(true)
    try {
      await deleteGroup.mutateAsync(group.id)
      queryClient.invalidateQueries({ queryKey: ["heygen", "my-avatar-groups"] })
      onClose()
    } catch (err: any) {
      toast({ title: "Error al eliminar el avatar", description: err?.message, variant: "destructive" })
      setConfirmDeleteGroup(false)
      setDeleting(false)
    }
  }

  const exitSelectMode = () => { setSelectMode(false); setForDelete(new Set()) }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !deleting) onClose() }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">

          {/* ── Confirm delete group ── */}
          {confirmDeleteGroup ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2">
                  <Trash2 className="w-5 h-5" />
                  Eliminar avatar completo
                </DialogTitle>
                <DialogDescription>
                  Se eliminarán permanentemente el grupo <strong>{group.name}</strong> y todos sus looks. Esta acción no se puede deshacer.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 px-1 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive text-center">
                ¿Confirmas que quieres eliminar <strong>{group.name}</strong> y sus {group.looks_count} look{group.looks_count !== 1 ? "s" : ""}?
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirmDeleteGroup(false)} disabled={deleting}>Cancelar</Button>
                <Button variant="destructive" onClick={handleDeleteGroup} disabled={deleting} className="gap-2">
                  {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {deleting ? "Eliminando…" : "Sí, eliminar todo"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <DialogTitle>{group.name}</DialogTitle>
                    <DialogDescription>
                      {selectMode
                        ? "Selecciona los looks que quieres eliminar."
                        : "Elige los looks que quieres usar. Al seleccionar un look puedes asignarle una voz."}
                    </DialogDescription>
                  </div>
                  {isOwned && !selectMode && (
                    <button
                      type="button"
                      title="Eliminar avatar completo"
                      onClick={() => setConfirmDeleteGroup(true)}
                      className="mt-0.5 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </DialogHeader>

              {/* Select-all bar */}
              {selectMode && deletableLooks.length > 0 && (
                <div className="flex items-center gap-3 px-1 py-2 border-b">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                      ${allDeletableSelected ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                      {allDeletableSelected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    Seleccionar todos
                  </button>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {forDelete.size} seleccionado{forDelete.size !== 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {/* Filter bar — only in normal mode with selections */}
              {!selectMode && selectedInGroup.length > 0 && !isLoading && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOnlySelected(v => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors
                      ${showOnlySelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                      }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {showOnlySelected ? "Ver todos" : `Ver solo seleccionados (${selectedInGroup.length})`}
                  </button>
                </div>
              )}

              {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-lg" />)}
                </div>
              ) : looks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Este avatar no tiene looks disponibles</p>
                </div>
              ) : visibleLooks.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    {verticalOnly && !showOnlySelected
                      ? "Este avatar no tiene looks verticales disponibles"
                      : "Ningún look seleccionado en este avatar"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {visibleLooks.map((look) => {
                    const isSelected = selectedIds.has(look.id)
                    const markedForDelete = forDelete.has(look.id)
                    const deletable = isLookDeletable(look)

                    return (
                      <div key={look.id} className="flex flex-col">
                        {/*
                          Card: outer div owns sizing + borders.
                          Inside: image fills the space.
                          Selection overlay sits at z-10 (full area, handles clicks).
                          Badges / name are at z-20 (pointer-events-none).
                          Zoom button is at z-30 — sibling to the overlay, never bubbles to it.
                        */}
                        <div
                          onMouseEnter={() => setHoveredLookId(look.id)}
                          onMouseLeave={() => setHoveredLookId(null)}
                          className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all
                            ${selectMode
                              ? markedForDelete
                                ? "border-destructive ring-2 ring-destructive/30"
                                : deletable
                                  ? "border-border"
                                  : "border-border opacity-50"
                              : isSelected
                                ? "border-primary ring-2 ring-primary/30"
                                : "border-transparent"
                            }`}
                        >
                          {/* Image */}
                          {look.preview_image_url ? (
                            <img src={look.preview_image_url} alt={look.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="absolute inset-0 bg-muted flex items-center justify-center text-muted-foreground">
                              <ImageIcon className="w-8 h-8" />
                            </div>
                          )}

                          {/* Selection overlay — z-10 */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (selectMode) { if (deletable) toggleForDelete(look.id) }
                              else onToggle(look.id)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                if (selectMode) { if (deletable) toggleForDelete(look.id) }
                                else onToggle(look.id)
                              }
                            }}
                            className={`absolute inset-0 z-10 ${selectMode && !deletable ? "cursor-not-allowed" : "cursor-pointer"}`}
                          />

                          {/* Type badge — z-20, no pointer events */}
                          <div className={`absolute top-2 left-2 z-20 pointer-events-none flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm
                            ${look.is_talking_photo ? "bg-orange-500/90 text-white" : "bg-green-600/90 text-white"}`}>
                            {look.is_talking_photo ? <Camera className="w-2.5 h-2.5" /> : <Video className="w-2.5 h-2.5" />}
                            {look.is_talking_photo ? "Foto" : "Avatar"}
                          </div>

                          {/* Selection / delete indicator — z-20, no pointer events */}
                          <div className={`absolute top-2 right-2 z-20 pointer-events-none w-6 h-6 rounded-full flex items-center justify-center transition-colors
                            ${selectMode
                              ? !deletable ? "bg-black/40 text-white/50"
                                : markedForDelete ? "bg-destructive text-white"
                                : "bg-black/30 text-white/60 border border-white/30"
                              : isSelected ? "bg-primary text-primary-foreground"
                              : "bg-black/30 text-white/60 border border-white/30"
                            }`}>
                            {selectMode
                              ? (!deletable ? <Lock className="w-3 h-3" /> : markedForDelete ? <CheckCircle2 className="w-4 h-4" /> : null)
                              : (isSelected ? <CheckCircle2 className="w-5 h-5" /> : null)}
                          </div>

                          {/* Name gradient — z-20, no pointer events */}
                          <div className="absolute bottom-0 inset-x-0 z-20 pointer-events-none bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                            <p className="text-white text-xs font-medium truncate">{look.name}</p>
                          </div>

                          {/* Zoom button — z-30, real sibling to overlay so no event conflict */}
                          {look.preview_image_url && !selectMode && (
                            <button
                              type="button"
                              onClick={() => setLightboxLook(look)}
                              className={`absolute bottom-8 right-2 z-30 p-1.5 rounded-md bg-black/60 text-white transition-opacity hover:bg-black/80
                                ${hoveredLookId === look.id ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                              title="Ampliar imagen"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Non-deletable notice in select mode */}
                        {selectMode && !deletable && (
                          <p className="text-[10px] text-muted-foreground text-center mt-1">No eliminable vía API</p>
                        )}

                        {!selectMode && isSelected && (
                          <LookVoiceInline
                            lookId={look.id}
                            voiceOverride={voiceOverrides[look.id]}
                            voiceOptions={voiceOptions}
                            onChangeVoice={onChangeVoice}
                            isPublic={!isOwned}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <DialogFooter className="flex-col sm:flex-row gap-2">
                {selectMode ? (
                  <>
                    <Button variant="outline" onClick={exitSelectMode} disabled={deleting} className="sm:mr-auto">
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteSelected}
                      disabled={forDelete.size === 0 || deleting}
                      className="gap-2"
                    >
                      {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {deleting ? "Eliminando…" : `Eliminar${forDelete.size > 0 ? ` (${forDelete.size})` : ""}`}
                    </Button>
                  </>
                ) : (
                  <>
                    {false && isOwned && deletableLooks.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => setSelectMode(true)}
                        className="gap-2 sm:mr-auto text-destructive border-destructive/40 hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar looks
                      </Button>
                    )}
                    {false && isOwned && looks.length > 0 && (
                      <Button variant="outline" onClick={() => {
                        if (!canUseFeature(lookDialogAccessState, "create_look")) {
                          onPlanRequired?.()
                          return
                        }
                        return
                      }} className="gap-2">
                        <Plus className="w-4 h-4" />
                        Nuevo look
                      </Button>
                    )}
                    {/* Auto-save status indicator */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto">
                      {saveStatus === "saving" && (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Guardando…</span>
                        </>
                      )}
                      {saveStatus === "saved" && (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600">Guardado</span>
                        </>
                      )}
                    </div>
                    <Button variant="outline" onClick={onClose}>Cerrar</Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>


      {/* ── Lightbox ── */}
      {lightboxLook && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightboxLook(null)}
        >
          <div
            className="relative max-w-sm w-full mx-4 flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              type="button"
              onClick={() => setLightboxLook(null)}
              className="absolute -top-3 -right-3 z-10 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Image */}
            <img
              src={lightboxLook.preview_image_url!}
              alt={lightboxLook.name}
              className="w-full max-h-[75vh] object-contain rounded-xl shadow-2xl"
            />

            {/* Caption */}
            <div className="text-center">
              <p className="text-white font-semibold text-sm">{lightboxLook.name}</p>
              <p className="text-white/50 text-xs mt-0.5">
                {lightboxLook.is_talking_photo ? "Avatar foto" : "Avatar digital"}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Audio quality analysis ────────────────────────────────────────────────────

type AudioIssue = { level: "error" | "warning"; message: string }
type AudioQualityResult = {
  duration: number
  rmsDb: number
  clippingRatio: number
  silenceRatio: number
  issues: AudioIssue[]
  hasBlocker: boolean
}

async function analyzeAudioBlob(blob: Blob): Promise<AudioQualityResult> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const ch = decoded.getChannelData(0)
    const n = ch.length
    const duration = decoded.duration
    let sumSq = 0, clipped = 0, silent = 0
    for (let i = 0; i < n; i++) {
      const s = Math.abs(ch[i])
      sumSq += s * s
      if (s > 0.98) clipped++
      if (s < 0.005) silent++
    }
    const rms = Math.sqrt(sumSq / n)
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100
    const clippingRatio = clipped / n
    const silenceRatio = silent / n
    const issues: AudioIssue[] = []
    if (duration < 30)
      issues.push({ level: "error", message: "Duración insuficiente — mínimo 30 segundos" })
    if (rmsDb < -42)
      issues.push({ level: "error", message: "Señal demasiado débil o silencio total — revisá el micrófono" })
    else if (rmsDb < -32)
      issues.push({ level: "warning", message: "Nivel de audio bajo — grabá más cerca del micrófono" })
    if (silenceRatio > 0.80)
      issues.push({ level: "error", message: "Más del 80 % es silencio — ¿olvidaste hablar?" })
    else if (silenceRatio > 0.55)
      issues.push({ level: "warning", message: "Muchas pausas — intentá hablar con más continuidad" })
    if (clippingRatio > 0.002)
      issues.push({ level: "warning", message: "Distorsión detectada — bajá el volumen del micrófono" })
    return { duration, rmsDb, clippingRatio, silenceRatio, issues, hasBlocker: issues.some(i => i.level === "error") }
  } finally {
    ctx.close()
  }
}

function AudioQualityPanel({ result, analyzing }: { result: AudioQualityResult | null; analyzing: boolean }) {
  if (analyzing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        Analizando calidad del audio…
      </div>
    )
  }
  if (!result) return null

  const fmtDur = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`
  const levelLabel = result.rmsDb > -20 ? "Bueno" : result.rmsDb > -32 ? "Moderado" : result.rmsDb > -42 ? "Bajo" : "Muy bajo"
  const silencePct = Math.round(result.silenceRatio * 100)

  const rows: { label: string; value: string; state: "ok" | "warn" | "error" }[] = [
    {
      label: "Duración",
      value: fmtDur(result.duration),
      state: result.duration >= 60 ? "ok" : result.duration >= 30 ? "warn" : "error",
    },
    {
      label: "Nivel de audio",
      value: levelLabel,
      state: result.rmsDb > -32 ? "ok" : result.rmsDb > -42 ? "warn" : "error",
    },
    {
      label: "Silencios / pausas",
      value: `${silencePct} %`,
      state: result.silenceRatio < 0.30 ? "ok" : result.silenceRatio < 0.55 ? "warn" : "error",
    },
    {
      label: "Distorsión",
      value: result.clippingRatio > 0.002 ? `${(result.clippingRatio * 100).toFixed(2)} %` : "Sin detectar",
      state: result.clippingRatio <= 0.002 ? "ok" : "warn",
    },
  ]

  const borderClass = result.hasBlocker
    ? "border-destructive/40 bg-destructive/5"
    : result.issues.length > 0
      ? "border-amber-400/40 bg-amber-500/5"
      : "border-emerald-400/40 bg-emerald-500/5"

  return (
    <div className={`rounded-lg border px-3 py-2.5 space-y-2.5 ${borderClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Análisis de calidad</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {rows.map(r => (
          <div key={r.label} className="flex items-start gap-1.5">
            {r.state === "ok"
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
              : r.state === "warn"
                ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                : <X className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />}
            <div>
              <p className="text-[10px] text-muted-foreground leading-none">{r.label}</p>
              <p className="text-xs font-medium leading-tight">{r.value}</p>
            </div>
          </div>
        ))}
      </div>
      {result.issues.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/40">
          {result.issues.map((issue, i) => (
            <p key={i} className={`text-[11px] flex items-start gap-1.5 leading-snug
              ${issue.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
              {issue.level === "error"
                ? <X className="w-3 h-3 shrink-0 mt-0.5" />
                : <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />}
              {issue.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AssignVoiceDialog ─────────────────────────────────────────────────────────

function AssignVoiceDialog({
  voice, lookGroupMap, allGroups, voiceOverrides, onAssign, onClose,
}: {
  voice: VoiceOption
  lookGroupMap: Record<string, string>
  allGroups: V3Group[]
  voiceOverrides: Record<string, string>
  onAssign: (lookIds: string[]) => void
  onClose: () => void
}) {
  // Invert lookGroupMap → groupId → lookId[]
  const groupToLooks = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [lid, gid] of Object.entries(lookGroupMap)) {
      const arr = m.get(gid) ?? []
      arr.push(lid)
      m.set(gid, arr)
    }
    return m
  }, [lookGroupMap])

  // Only show groups that have at least one look in lookGroupMap
  const knownGroups = useMemo(
    () => allGroups.filter(g => groupToLooks.has(g.id)),
    [allGroups, groupToLooks]
  )

  // Pre-check groups where ANY look already uses this voice
  const [checkedGroups, setCheckedGroups] = useState<Set<string>>(() => {
    const pre = new Set<string>()
    for (const g of allGroups) {
      const looks = groupToLooks.get(g.id) ?? []
      if (looks.some(lid => voiceOverrides[lid] === voice.voice_id)) pre.add(g.id)
    }
    return pre
  })

  const toggleGroup = (gid: string) => setCheckedGroups(prev => {
    const next = new Set(prev)
    next.has(gid) ? next.delete(gid) : next.add(gid)
    return next
  })

  const handleApply = () => {
    const lookIds: string[] = []
    for (const gid of checkedGroups) {
      for (const lid of (groupToLooks.get(gid) ?? [])) lookIds.push(lid)
    }
    onAssign(lookIds)
  }

  // Count total looks that will be updated
  const totalLooks = Array.from(checkedGroups).reduce(
    (sum, gid) => sum + (groupToLooks.get(gid)?.length ?? 0), 0
  )

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-primary" /> Asignar "{voice.name}"
          </DialogTitle>
          <DialogDescription>
            Elige los avatares que usarán esta voz. Se aplicará a todos sus looks.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 max-h-80 overflow-y-auto space-y-1.5">
          {knownGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Abre la ficha de un avatar primero para que aparezca aquí.
            </p>
          ) : (
            knownGroups.map(group => {
              const looks = groupToLooks.get(group.id) ?? []
              const allHaveVoice = looks.every(lid => voiceOverrides[lid] === voice.voice_id)
              const someHaveVoice = !allHaveVoice && looks.some(lid => voiceOverrides[lid] === voice.voice_id)
              const hasOtherVoice = looks.some(
                lid => voiceOverrides[lid] && voiceOverrides[lid] !== voice.voice_id
              )
              return (
                <label
                  key={group.id}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checkedGroups.has(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="w-4 h-4 rounded border-border accent-primary shrink-0"
                  />
                  {/* Thumbnail */}
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                    {group.preview_image_url ? (
                      <img src={group.preview_image_url} alt={group.name}
                        className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {looks.length} look{looks.length !== 1 ? "s" : ""}
                      {allHaveVoice && " · voz ya asignada"}
                      {someHaveVoice && " · asignada en algunos"}
                      {hasOtherVoice && !someHaveVoice && " · reemplazará la voz actual"}
                    </p>
                  </div>
                  {allHaveVoice && (
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                  )}
                </label>
              )
            })
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleApply}
            disabled={checkedGroups.size === 0}
            className="gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            Aplicar a {checkedGroups.size} avatar{checkedGroups.size !== 1 ? "es" : ""}
            {totalLooks > 0 && ` · ${totalLooks} looks`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── WsAssignVoiceDialog ───────────────────────────────────────────────────────

function WsAssignVoiceDialog({
  voice,
  personas,
  onApply,
  onClose,
}: {
  voice: WavespeedVoiceRow
  personas: Array<{ id: number; name: string; looks: WavespeedLookRow[]; planEnabled?: boolean }>
  onApply: (updates: Array<{ lookId: number; voiceId: number | null }>) => Promise<void>
  onClose: () => void
}) {
  const parseCfg = (l: WavespeedLookRow) => {
    try { return JSON.parse(l.config ?? "{}") as { selected?: boolean; voiceId?: number | null } }
    catch { return {} as { selected?: boolean; voiceId?: number | null } }
  }

  const activePersonas = useMemo(
    () =>
      personas
        .filter(p => p.planEnabled !== false)
        .map(p => ({ ...p, activeLooks: p.looks.filter(l => parseCfg(l).selected === true) }))
        .filter(p => p.activeLooks.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personas]
  )

  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => {
    const pre = new Set<number>()
    for (const p of activePersonas) {
      if (p.activeLooks.some(l => parseCfg(l).voiceId === voice.id)) pre.add(p.id)
    }
    return pre
  })

  const [saving, setSaving] = useState(false)

  const togglePersona = (id: number) =>
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleApply = async () => {
    setSaving(true)
    const updates: Array<{ lookId: number; voiceId: number | null }> = []
    for (const p of activePersonas) {
      const checked = checkedIds.has(p.id)
      for (const look of p.activeLooks) {
        const cur = parseCfg(look).voiceId ?? null
        if (checked && cur !== voice.id) updates.push({ lookId: look.id, voiceId: voice.id })
        else if (!checked && cur === voice.id) updates.push({ lookId: look.id, voiceId: null })
      }
    }
    await onApply(updates)
    setSaving(false)
  }

  const totalLooks = Array.from(checkedIds).reduce(
    (sum, pid) => sum + (activePersonas.find(p => p.id === pid)?.activeLooks.length ?? 0),
    0
  )

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-violet-500" /> Asignar "{voice.displayName}"
          </DialogTitle>
          <DialogDescription>
            Elige los avatares que usarán esta voz. Se aplicará a todos sus looks activos.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 max-h-80 overflow-y-auto space-y-1.5">
          {activePersonas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No tenés avatares activos en la rotación todavía.
            </p>
          ) : (
            activePersonas.map(persona => {
              const allHaveVoice = persona.activeLooks.every(l => parseCfg(l).voiceId === voice.id)
              const someHaveVoice = !allHaveVoice && persona.activeLooks.some(l => parseCfg(l).voiceId === voice.id)
              const hasOtherVoice = persona.activeLooks.some(l => {
                const v = parseCfg(l).voiceId ?? null
                return v !== null && v !== voice.id
              })
              const thumb = persona.activeLooks[0]?.imageUrl
              return (
                <label
                  key={persona.id}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(persona.id)}
                    onChange={() => togglePersona(persona.id)}
                    className="w-4 h-4 rounded border-border accent-primary shrink-0"
                  />
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                    {thumb ? (
                      <img src={thumb} alt={persona.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{persona.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {persona.activeLooks.length} look{persona.activeLooks.length !== 1 ? "s" : ""}
                      {allHaveVoice && " · voz ya asignada"}
                      {someHaveVoice && " · asignada en algunos"}
                      {hasOtherVoice && !someHaveVoice && " · reemplazará la voz actual"}
                    </p>
                  </div>
                  {allHaveVoice && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                </label>
              )
            })
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleApply} disabled={checkedIds.size === 0 || saving} className="gap-1.5">
            {saving
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle2 className="w-4 h-4" />}
            Aplicar a {checkedIds.size} avatar{checkedIds.size !== 1 ? "es" : ""}
            {totalLooks > 0 && ` · ${totalLooks} looks`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── PendingDigitalTwinCard ────────────────────────────────────────────────────
// Shown in the Mi Avatar grid while HeyGen is training a newly submitted Digital Twin.

function PendingDigitalTwinCard({ job, elapsedSeconds }: {
  job: { name: string }
  elapsedSeconds: number
}) {
  const elapsedMin = Math.floor(elapsedSeconds / 60)
  const elapsedLabel = elapsedMin < 1
    ? "Iniciando entrenamiento…"
    : elapsedMin === 1
      ? "1 min procesando"
      : `${elapsedMin} min procesando`

  return (
    <Card className="overflow-hidden border-primary/30 bg-primary/[0.02]">
      <div className="aspect-square bg-muted/50 relative flex items-center justify-center">
        {/* Pulsing gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 animate-pulse" />
        {/* Spinner + icon */}
        <div className="relative flex flex-col items-center gap-3">
          <div className="relative w-14 h-14 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-[3px] border-primary/20 border-t-primary animate-spin" />
            <Video className="w-6 h-6 text-primary" />
          </div>
          <p className="text-[10px] text-primary font-medium px-3 text-center leading-tight">
            {elapsedLabel}
          </p>
        </div>
        {/* "Procesando" badge top-left */}
        <Badge className="absolute top-2 left-2 gap-1 bg-primary/90 text-primary-foreground text-[10px] px-1.5 py-0.5">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          Procesando
        </Badge>
      </div>
      <CardContent className="p-4">
        <h4 className="font-bold font-display truncate">{job.name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">Avatar AI · 10–20 min</p>
      </CardContent>
    </Card>
  )
}

// ── AvatarGroupCard ───────────────────────────────────────────────────────────

function AvatarGroupCard({
  group,
  selectedCount,
  onClick,
  voicelessCount = 0,
}: {
  group: V3Group
  selectedCount: number
  onClick: () => void
  voicelessCount?: number
}) {
  return (
    <Card
      className="overflow-hidden cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-lg"
      onClick={onClick}
    >
      <div className="aspect-square bg-muted relative">
        {group.preview_image_url ? (
          <img src={group.preview_image_url} alt={group.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="w-10 h-10" />
          </div>
        )}
        {selectedCount > 0 && (
          <Badge className="absolute top-2 left-2 gap-1 bg-primary text-primary-foreground shadow">
            <CheckCircle2 className="w-3 h-3" />
            {selectedCount} seleccionado{selectedCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {voicelessCount > 0 && (
          <Badge className="absolute top-2 right-2 gap-1 bg-amber-500 text-white shadow text-[10px] px-1.5">
            <AlertCircle className="w-2.5 h-2.5" />
            Sin voz
          </Badge>
        )}
        {group.status === "processing" && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
            <p className="text-white text-xs font-medium">Procesando…</p>
          </div>
        )}
      </div>
      <CardContent className="p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-bold font-display truncate">{group.name}</h4>
          <p className="text-xs text-muted-foreground">
            {group.looks_count} look{group.looks_count !== 1 ? "s" : ""}
            {selectedCount > 0 && <span className="text-primary font-medium"> · {selectedCount} en rotación</span>}
          </p>
          {voicelessCount > 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
              {voicelessCount} look{voicelessCount !== 1 ? "s" : ""} sin voz asignada
            </p>
          )}
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs">Ver looks</Badge>
      </CardContent>
    </Card>
  )
}

// ── LazyLookImage — shimmer skeleton + fade-in for WaveSpeed look images ──────

function LazyLookImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  return (
    <div className="relative w-full h-full">
      {!loaded && !error && <div className="absolute inset-0 bg-muted animate-pulse" />}
      {error ? (
        <div className="absolute inset-0 bg-muted flex items-center justify-center">
          <AlertCircle className="w-5 h-5 text-destructive/50" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
    </div>
  )
}

// ── WavespeedPendingPoller ────────────────────────────────────────────────────
// Invisible component that polls look-generation status for a persona even when
// the persona dialog is closed.  Propagates completed looks into WAVESPEED_PERSONAS_KEY
// so the grid thumbnails (and the dialog if open) update without a full refetch.

function WavespeedPendingPoller({ persona }: { persona: WavespeedPersonaWithLooks }) {
  const queryClient = useQueryClient()
  const looksStatus = useWavespeedPersonaLooksStatus(persona.id, true)

  useEffect(() => {
    const updatedLooks = looksStatus.data?.looks
    if (!updatedLooks?.length) return
    const hasReady = updatedLooks.some((l) => {
      try {
        const cfg = JSON.parse(l.config ?? "{}") as { generationStatus?: string }
        return cfg.generationStatus === "ready" && !!l.imageUrl
      } catch { return false }
    })
    if (!hasReady) return
    queryClient.setQueryData(
      WAVESPEED_PERSONAS_KEY,
      (old: { personas: WavespeedPersonaWithLooks[] } | undefined) => {
        if (!old) return old
        return {
          ...old,
          personas: old.personas.map((p) =>
            p.id === persona.id ? { ...p, looks: updatedLooks } : p,
          ),
        }
      },
    )
  }, [looksStatus.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// ── PendingVoicePoller ────────────────────────────────────────────────────────
// Invisible component that polls WaveSpeed's API every 5 s for a single pending
// voice clone.  When the status transitions to ready/failed it patches the
// ["wavespeed","voices"] cache so the Voces tab updates without a page refresh.

function PendingVoicePoller({ voiceId }: { voiceId: number }) {
  const queryClient = useQueryClient()
  const statusQuery = useWavespeedVoiceStatus(voiceId, true)

  useEffect(() => {
    const data = statusQuery.data
    if (!data || (data.status !== "ready" && data.status !== "failed")) return
    queryClient.setQueryData<{ voices: WavespeedVoiceRow[] }>(
      ["wavespeed", "voices"],
      (old) => {
        if (!old) return old
        return { ...old, voices: old.voices.map((v) => (v.id === data.id ? { ...v, ...data } : v)) }
      },
    )
  }, [statusQuery.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// ── WavespeedPersonaCard ──────────────────────────────────────────────────────

function WavespeedPersonaCard({
  persona,
  onClick,
}: {
  persona: WavespeedPersonaWithLooks
  onClick: () => void
}) {
  const thumbnail =
    persona.thumbnailUrl ??
    persona.looks.find((l) => l.imageUrl)?.imageUrl ??
    null
  const readyLooks = persona.looks.filter((l) => {
    try {
      const cfg = JSON.parse(l.config ?? "{}") as { generationStatus?: string; selected?: boolean }
      return cfg.generationStatus === "ready"
    } catch {
      return false
    }
  })
  const activeLooks = persona.looks.filter((l) => {
    try {
      const cfg = JSON.parse(l.config ?? "{}") as { selected?: boolean }
      return cfg.selected === true
    } catch {
      return false
    }
  })

  const isPlanBlocked = persona.planEnabled === false
  const usableActiveLooks = isPlanBlocked ? 0 : activeLooks.length

  return (
    <Card
      className={`overflow-hidden cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-lg${isPlanBlocked ? " opacity-60 grayscale" : ""}`}
      onClick={onClick}
    >
      <div className="aspect-square bg-muted relative">
        {thumbnail ? (
          <img src={thumbnail} alt={persona.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Sparkles className="w-10 h-10" />
          </div>
        )}
        <Badge className="absolute top-2 left-2 gap-1 bg-violet-600 text-white shadow text-[10px] px-1.5">
          <Sparkles className="w-2.5 h-2.5" />
          AI
        </Badge>
        {isPlanBlocked && (
          <Badge className="absolute top-2 right-2 gap-1 bg-amber-500 text-white shadow text-[10px] px-1.5">
            <Lock className="w-2.5 h-2.5" />
            Pro
          </Badge>
        )}
        {usableActiveLooks > 0 && (
          <Badge className="absolute bottom-2 left-2 gap-1 bg-primary text-primary-foreground shadow">
            <CheckCircle2 className="w-3 h-3" />
            {usableActiveLooks} activo{usableActiveLooks !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>
      <CardContent className="p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-bold font-display truncate">{persona.name}</h4>
          <p className="text-xs text-muted-foreground">
            {readyLooks.length} look{readyLooks.length !== 1 ? "s" : ""} generado{readyLooks.length !== 1 ? "s" : ""}
            {usableActiveLooks > 0 && (
              <span className="text-primary font-medium"> · {usableActiveLooks} en uso</span>
            )}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs">Ver looks</Badge>
      </CardContent>
    </Card>
  )
}

// ── CreateNewLookDialog ───────────────────────────────────────────────────────

function CreateNewLookDialog({
  persona,
  readyLooks,
  onClose,
  onGenerated,
}: {
  persona: WavespeedPersonaWithLooks
  readyLooks: WavespeedLookRow[]
  onClose: () => void
  onGenerated: () => void
}) {
  const { toast } = useToast()
  const generateLooks = useGenerateWavespeedPersonaLooks()

  const [baseLookId, setBaseLookId] = useState<number | null>(readyLooks[0]?.id ?? null)
  const [lookName, setLookName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [pose, setPose] = useState<"half_body" | "close_up" | "full_body">("half_body")

  const handleGenerate = async () => {
    try {
      await generateLooks.mutateAsync({
        personaId: persona.id,
        name: lookName.trim() || undefined,
        prompt: prompt.trim() || undefined,
        baseLookId: baseLookId ?? undefined,
        pose,
      })
      toast({ title: "Generando look…", description: "Aparecerá en la cuadrícula en unos segundos." })
      onGenerated()
      onClose()
    } catch {
      toast({ title: "Error al generar look", description: "No se pudo generar el look. Intenta de nuevo.", variant: "destructive" })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !generateLooks.isPending) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear nuevo look</DialogTitle>
          <DialogDescription>
            Genera una variante del avatar con diferente ropa, fondo o pose. La IA mantiene el mismo personaje.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Basar en */}
          {readyLooks.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Basar en</label>
              <div className="flex gap-2 flex-wrap">
                {readyLooks.map((look) => (
                  <button
                    key={look.id}
                    type="button"
                    onClick={() => setBaseLookId(look.id)}
                    className={`w-16 h-16 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all
                      ${baseLookId === look.id ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}
                  >
                    {look.imageUrl ? (
                      <img src={look.imageUrl} alt={look.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">La IA usará este look como referencia de identidad</p>
            </div>
          )}

          {/* Nombre del look */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="look-name">Nombre del look</label>
            <input
              id="look-name"
              value={lookName}
              onChange={(e) => setLookName(e.target.value)}
              placeholder="Ej: Look casual verano"
              className="w-full text-sm rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Descripción */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="look-prompt">Descripción del nuevo look</label>
            <textarea
              id="look-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ej: Camisa casual azul, fondo de cafetería moderna, luz natural cálida"
              rows={3}
              className="w-full text-sm rounded-md border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground">Describe solo lo que cambia: ropa, fondo, iluminación</p>
          </div>

          {/* Encuadre */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Encuadre</label>
            <Select value={pose} onValueChange={(v) => setPose(v as typeof pose)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="half_body">Medio cuerpo (recomendado)</SelectItem>
                <SelectItem value="close_up">Primer plano</SelectItem>
                <SelectItem value="full_body">Cuerpo completo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={generateLooks.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={persona.planEnabled === false || generateLooks.isPending || (!persona.referenceObjectPath && !baseLookId)}
            className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
          >
            {generateLooks.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando…</>
              : "Generar look"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── WavespeedPersonaDialog ─────────────────────────────────────────────────────

function WavespeedPersonaDialog({
  persona,
  onClose,
  onDeleted,
  onNewLook,
  onPlanRequired,
}: {
  persona: WavespeedPersonaWithLooks
  onClose: () => void
  onDeleted: () => void
  onNewLook: () => void
  onPlanRequired: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const deletePersona = useDeleteWavespeedPersona()
  const patchPersona = usePatchWavespeedPersona()
  const deleteLookMutation = useDeleteWavespeedLook()
  const patchLook = usePatchWavespeedLook()
  const { data: voicesData } = useWavespeedVoices()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const isPlanBlocked = persona.planEnabled === false
  useEffect(() => {
    if (isPlanBlocked) setShowOnlySelected(false)
  }, [isPlanBlocked])

  // ── Optimistic display names (updated immediately on save, synced from prop) ─
  const [displayPersonaName, setDisplayPersonaName] = useState(persona.name)
  useEffect(() => setDisplayPersonaName(persona.name), [persona.name])

  const [displayLookNames, setDisplayLookNames] = useState<Record<number, string>>(
    () => Object.fromEntries(persona.looks.map((l) => [l.id, l.name]))
  )
  useEffect(() => {
    setDisplayLookNames((prev) => {
      const next = { ...prev }
      persona.looks.forEach((l) => { next[l.id] = l.name })
      return next
    })
  }, [persona.looks])

  // ── Inline editing state ──────────────────────────────────────────────────
  const [editingPersonaName, setEditingPersonaName] = useState(false)
  const [personaNameDraft, setPersonaNameDraft] = useState("")
  const [editingLookId, setEditingLookId] = useState<number | null>(null)
  const [lookNameDraft, setLookNameDraft] = useState("")

  const startEditPersonaName = () => { setPersonaNameDraft(displayPersonaName); setEditingPersonaName(true) }
  const cancelEditPersonaName = () => setEditingPersonaName(false)
  const savePersonaName = async () => {
    const trimmed = personaNameDraft.trim()
    if (!trimmed || trimmed === displayPersonaName) { cancelEditPersonaName(); return }
    setDisplayPersonaName(trimmed)   // optimistic — show instantly
    setEditingPersonaName(false)
    try {
      await patchPersona.mutateAsync({ id: persona.id, name: trimmed })
    } catch {
      setDisplayPersonaName(persona.name) // revert on error
      toast({ title: "Error al guardar el nombre", variant: "destructive" })
    }
  }

  const startEditLookName = (look: WavespeedLookRow) => {
    setLookNameDraft(displayLookNames[look.id] ?? look.name)
    setEditingLookId(look.id)
  }
  const cancelEditLookName = () => setEditingLookId(null)
  const saveLookName = async (look: WavespeedLookRow) => {
    const trimmed = lookNameDraft.trim()
    if (!trimmed || trimmed === (displayLookNames[look.id] ?? look.name)) { cancelEditLookName(); return }
    setDisplayLookNames((prev) => ({ ...prev, [look.id]: trimmed }))  // optimistic
    setEditingLookId(null)
    try {
      await patchLook.mutateAsync({ id: look.id, name: trimmed })
    } catch {
      setDisplayLookNames((prev) => ({ ...prev, [look.id]: look.name })) // revert
      toast({ title: "Error al guardar el nombre", variant: "destructive" })
    }
  }

  const readyVoices = (voicesData?.voices ?? []).filter((v) => v.status === "ready")

  // Helper: parse look config (used for non-optimistic fields)
  const getCfg = (look: WavespeedLookRow) => {
    try { return JSON.parse(look.config ?? "{}") as { generationStatus?: string; selected?: boolean; voiceId?: number | null; requestId?: string } }
    catch { return {} }
  }

  // ── Optimistic selection state ──────────────────────────────────────────────
  // Reads from local Set instead of look.config so toggles are instant, bypassing
  // the setQueryData → wavespeedData → useEffect → prop re-render cycle.
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<number>>(
    () => new Set(persona.looks.filter((l) => getCfg(l).selected === true).map((l) => l.id))
  )
  useEffect(() => {
    setLocalSelectedIds(new Set(persona.looks.filter((l) => getCfg(l).selected === true).map((l) => l.id)))
  }, [persona.looks]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Optimistic voice-override state ────────────────────────────────────────
  const [localVoiceIds, setLocalVoiceIds] = useState<Record<number, number | null>>(
    () => Object.fromEntries(persona.looks.map((l) => [l.id, getCfg(l).voiceId ?? null]))
  )
  useEffect(() => {
    setLocalVoiceIds((prev) => {
      const next = { ...prev }
      persona.looks.forEach((l) => { next[l.id] = getCfg(l).voiceId ?? null })
      return next
    })
  }, [persona.looks]) // eslint-disable-line react-hooks/exhaustive-deps

  const getSelected = (look: WavespeedLookRow) => localSelectedIds.has(look.id)
  const getVoiceId = (look: WavespeedLookRow) => localVoiceIds[look.id] ?? null

  // Poll while any look needs recovery (null imageUrl) or is still pending
  const hasPending = persona.looks.some((l) => {
    const cfg = getCfg(l)
    return cfg.generationStatus === "pending" || (cfg.generationStatus === "ready" && !l.imageUrl)
  })
  // Always render from persona.looks (kept in sync by setQueryData in usePatchWavespeedLook)
  const looksStatus = useWavespeedPersonaLooksStatus(persona.id, hasPending)

  // Propagate completed poll results back to WAVESPEED_PERSONAS_KEY so thumbnails
  // appear instantly without waiting for a full refetch of the personas query.
  // This also triggers the parent's useEffect (line ~3225) which syncs
  // openWavespeedPersona, making persona.looks update in the dialog too.
  useEffect(() => {
    const updatedLooks = looksStatus.data?.looks
    if (!updatedLooks?.length) return
    const hasReady = updatedLooks.some((l) => {
      try {
        const cfg = JSON.parse(l.config ?? "{}") as { generationStatus?: string }
        return cfg.generationStatus === "ready" && !!l.imageUrl
      } catch { return false }
    })
    if (!hasReady) return
    queryClient.setQueryData(
      WAVESPEED_PERSONAS_KEY,
      (old: { personas: WavespeedPersonaWithLooks[] } | undefined) => {
        if (!old) return old
        return {
          ...old,
          personas: old.personas.map((p) =>
            p.id === persona.id ? { ...p, looks: updatedLooks } : p,
          ),
        }
      },
    )
  }, [looksStatus.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const livePersonaLooks = persona.looks

  const allLooks = livePersonaLooks
  const readyLooks = allLooks.filter((l) => {
    const cfg = getCfg(l)
    return cfg.generationStatus === "ready" || !!l.imageUrl
  })
  const pendingLooks = allLooks.filter((l) => {
    const cfg = getCfg(l)
    return cfg.generationStatus === "pending" && !l.imageUrl
  })
  const selectedCount = isPlanBlocked ? 0 : readyLooks.filter(getSelected).length
  const visibleLooks = showOnlySelected ? readyLooks.filter(getSelected) : readyLooks

  const handleToggle = async (look: WavespeedLookRow) => {
    if (isPlanBlocked) {
      onPlanRequired()
      return
    }
    const wasSelected = localSelectedIds.has(look.id)
    // Optimistic toggle
    setLocalSelectedIds((prev) => {
      const next = new Set(prev)
      wasSelected ? next.delete(look.id) : next.add(look.id)
      return next
    })
    try {
      await patchLook.mutateAsync({ id: look.id, config: { selected: !wasSelected } })
    } catch {
      // Revert on error
      setLocalSelectedIds((prev) => {
        const next = new Set(prev)
        wasSelected ? next.add(look.id) : next.delete(look.id)
        return next
      })
      toast({ title: "Error al guardar", variant: "destructive" })
    }
  }

  const handleVoiceChange = async (look: WavespeedLookRow, value: string) => {
    if (isPlanBlocked) {
      onPlanRequired()
      return
    }
    const voiceId = value === "__none__" ? null : parseInt(value, 10)
    const prev = localVoiceIds[look.id] ?? null
    setLocalVoiceIds((s) => ({ ...s, [look.id]: voiceId }))  // optimistic
    try {
      await patchLook.mutateAsync({ id: look.id, config: { voiceId } })
    } catch {
      setLocalVoiceIds((s) => ({ ...s, [look.id]: prev }))  // revert
      toast({ title: "Error al guardar la voz", variant: "destructive" })
    }
  }

  const handleDeleteLook = async (look: WavespeedLookRow) => {
    try { await deleteLookMutation.mutateAsync(look.id) }
    catch { toast({ title: "Error al eliminar el look", variant: "destructive" }) }
  }

  const handleDeletePersona = async () => {
    setDeleting(true)
    try {
      await deletePersona.mutateAsync(persona.id)
      onDeleted()
    } catch {
      toast({ title: "Error al eliminar el avatar", variant: "destructive" })
      setConfirmDelete(false)
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !deleting) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        {confirmDelete ? (
          <div className="p-6 flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <Trash2 className="w-5 h-5" /> Eliminar avatar AI
              </DialogTitle>
              <DialogDescription>
                Se eliminará permanentemente <strong>{persona.name}</strong> y todos sus looks. Esta acción no se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDeletePersona} disabled={deleting} className="gap-2">
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deleting ? "Eliminando…" : "Sí, eliminar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-3 flex-shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge className="bg-violet-600 text-white text-[10px] px-1.5 shrink-0">
                    <Sparkles className="w-2.5 h-2.5 mr-1" /> AI
                  </Badge>
                  {isPlanBlocked && (
                    <Badge variant="outline" className="text-[10px] px-1.5 border-amber-500/50 text-amber-700 dark:text-amber-300">
                      <Lock className="w-2.5 h-2.5 mr-1" /> Pro
                    </Badge>
                  )}
                  {editingPersonaName ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <input
                        autoFocus
                        value={personaNameDraft}
                        onChange={(e) => setPersonaNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") savePersonaName()
                          if (e.key === "Escape") cancelEditPersonaName()
                        }}
                        className="flex-1 min-w-0 text-base font-semibold bg-transparent border-b-2 border-primary outline-none px-0.5"
                      />
                      <button type="button" onClick={savePersonaName}
                        className="p-0.5 rounded text-primary hover:bg-primary/10 transition-colors">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={cancelEditPersonaName}
                        className="p-0.5 rounded text-muted-foreground hover:bg-muted transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 min-w-0 group/pname">
                      <h2 className="text-base font-semibold truncate">{displayPersonaName}</h2>
                      <button type="button" onClick={startEditPersonaName}
                        className="p-0.5 rounded text-muted-foreground opacity-0 group-hover/pname:opacity-100 hover:bg-muted transition-all flex-shrink-0"
                        title="Editar nombre del avatar">
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {isPlanBlocked
                    ? "Este Avatar AI está conservado, pero bloqueado con tu plan Basic. Actualiza a Pro para volver a usar sus looks."
                    : "Elige los looks que quieres usar. Al seleccionar un look puedes asignarle una voz."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 mt-0.5"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Filter toggle */}
            {selectedCount > 0 && (
              <div className="px-6 pb-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors
                    ${showOnlySelected ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ver solo seleccionados ({selectedCount})
                </button>
              </div>
            )}

            {/* Scrollable look grid */}
            <div className="flex-1 overflow-y-auto px-6 pb-2">
              {readyLooks.length === 0 && pendingLooks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Este avatar no tiene looks generados todavía.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {visibleLooks.map((look) => {
                    const isSelected = getSelected(look)
                    const voiceId = getVoiceId(look)
                    return (
                      <div key={look.id} className="flex flex-col gap-1.5">
                        {/* Card */}
                        <div className="relative aspect-[3/4] group">
                          <button
                            type="button"
                            onClick={() => handleToggle(look)}
                            disabled={isPlanBlocked}
                            className={`w-full h-full rounded-lg overflow-hidden border-2 transition-all text-left
                              ${isPlanBlocked
                                ? "border-border opacity-55 cursor-not-allowed"
                                : isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}
                          >
                            {look.imageUrl ? (
                              <LazyLookImage src={look.imageUrl} alt={look.name} />
                            ) : (
                              <div className="w-full h-full bg-muted flex items-center justify-center">
                                <ImageIcon className="w-6 h-6 text-muted-foreground" />
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow">
                                <CheckCircle2 className="w-4 h-4 text-primary-foreground" />
                              </div>
                            )}
                            {isPlanBlocked && (
                              <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                                <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white">
                                  <Lock className="w-3 h-3" /> Bloqueado
                                </span>
                              </div>
                            )}
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                              <p className="text-white text-xs font-medium truncate">{look.name}</p>
                            </div>
                          </button>
                          {/* Per-card delete — visible on hover */}
                          <button
                            type="button"
                            onClick={() => handleDeleteLook(look)}
                            disabled={deleteLookMutation.isPending}
                            className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-destructive"
                            title="Eliminar look"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Editable look name */}
                        {editingLookId === look.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={lookNameDraft}
                              onChange={(e) => setLookNameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveLookName(look)
                                if (e.key === "Escape") cancelEditLookName()
                              }}
                              className="flex-1 min-w-0 text-xs font-medium bg-transparent border-b border-primary outline-none px-0.5"
                            />
                            <button type="button" onClick={() => saveLookName(look)}
                              className="p-0.5 rounded text-primary hover:bg-primary/10 transition-colors flex-shrink-0">
                              <Check className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={cancelEditLookName}
                              className="p-0.5 rounded text-muted-foreground hover:bg-muted transition-colors flex-shrink-0">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="group/lname flex items-center gap-1 min-w-0">
                            <span className="text-xs font-medium truncate flex-1 text-foreground/80">
                              {displayLookNames[look.id] ?? look.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => startEditLookName(look)}
                              className="p-0.5 rounded text-muted-foreground opacity-0 group-hover/lname:opacity-100 hover:bg-muted transition-all flex-shrink-0"
                              title="Editar nombre del look"
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}

                        {/* Voice picker */}
                        <Select
                          value={voiceId !== null ? String(voiceId) : "__none__"}
                          onValueChange={(v) => handleVoiceChange(look, v)}
                          disabled={isPlanBlocked}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Sin voz" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sin voz (predeterminada)</SelectItem>
                            {readyVoices.map((v) => (
                              <SelectItem key={v.id} value={String(v.id)}>{v.displayName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}

                  {/* Pending looks — skeleton cards */}
                  {(!showOnlySelected) && pendingLooks.map((look) => (
                    <div key={look.id} className="flex flex-col gap-1.5">
                      <div className="aspect-[3/4] rounded-lg bg-muted animate-pulse border-2 border-border flex flex-col items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 text-muted-foreground/50 animate-spin" />
                        <p className="text-[10px] text-muted-foreground/60 text-center px-2">{look.name}</p>
                      </div>
                      <div className="h-7 rounded-md bg-muted animate-pulse" />
                    </div>
                  ))}
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t flex-shrink-0">
              {isPlanBlocked ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={onPlanRequired}
                  className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                >
                  Actualizar a Pro
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onNewLook}
                  className="gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Nuevo look
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Avatars() {
  const { data: config, isLoading: isLoadingConfig } = useGetAvatarConfig()
  const updateConfig = useUpdateAvatarConfig()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: voices, isLoading: isLoadingVoices, refetch: refetchVoices } = useGetHeyGenVoices()
  const { data: wavespeedVoicesData, refetch: refetchWavespeedVoices } = useWavespeedVoices()
  const deleteWavespeedVoice = useDeleteWavespeedVoice()
  const updateWsVoiceMut = useUpdateWavespeedVoice()
  const wavespeedVoices: WavespeedVoiceRow[] = wavespeedVoicesData?.voices ?? []

  // ── Cloned voice playback ─────────────────────────────────────────────────
  const [clonePlayingId, setClonePlayingId] = useState<number | null>(null)
  const [cloneLoadingId, setCloneLoadingId] = useState<number | null>(null)
  const cloneAudioRef = useRef<HTMLAudioElement | null>(null)

  const playClonedVoice = useCallback(async (voiceId: number) => {
    // Toggle off if already playing this voice
    if (clonePlayingId === voiceId) {
      cloneAudioRef.current?.pause()
      cloneAudioRef.current = null
      setClonePlayingId(null)
      return
    }
    // Stop any other voice currently playing
    if (cloneAudioRef.current) {
      cloneAudioRef.current.pause()
      cloneAudioRef.current = null
      setClonePlayingId(null)
    }
    setCloneLoadingId(voiceId)
    try {
      // fetchVoicePreview handles all cases:
      //  • cached previewAudioUrl → instant
      //  • sourceAudioObjectName → signed GCS URL → instant
      //  • only wavespeedVoiceId → generates short TTS clip (~5-15 s first call)
      const url = await fetchVoicePreview(voiceId)
      setCloneLoadingId(null)
      setClonePlayingId(voiceId)
      const audio = new Audio(url)
      cloneAudioRef.current = audio
      audio.onended = () => { setClonePlayingId(null); cloneAudioRef.current = null }
      audio.onerror = () => { setClonePlayingId(null); cloneAudioRef.current = null }
      audio.play().catch(() => { setClonePlayingId(null); cloneAudioRef.current = null })
    } catch {
      setCloneLoadingId(null)
      setClonePlayingId(null)
      toast({ title: "No se pudo reproducir la voz", variant: "destructive" })
    }
  }, [clonePlayingId, toast])

  // ── WaveSpeed voice → avatar assignment sheet ────────────────────────────
  const [wsVoiceAssignTarget, setWsVoiceAssignTarget] = useState<WavespeedVoiceRow | null>(null)
  const patchWsLookAssign = usePatchWavespeedLook()
  const [wsAssignSaving, setWsAssignSaving] = useState<number | null>(null)

  const getLookVoiceId = (look: WavespeedLookRow): number | null => {
    try { return (JSON.parse(look.config ?? "{}") as { voiceId?: number | null }).voiceId ?? null }
    catch { return null }
  }

  const getLookSelected = (look: WavespeedLookRow): boolean => {
    try { return (JSON.parse(look.config ?? "{}") as { selected?: boolean }).selected === true }
    catch { return false }
  }

  const handleWsVoiceAssign = async (look: WavespeedLookRow, targetVoiceId: number | null) => {
    setWsAssignSaving(look.id)
    try {
      await patchWsLookAssign.mutateAsync({ id: look.id, config: { voiceId: targetVoiceId } })
      void refetchWavespeed()
    } catch {
      toast({ title: "Error al asignar la voz", variant: "destructive" })
    } finally {
      setWsAssignSaving(null)
    }
  }

  // ── WaveSpeed voice tuning (kept for internal use) ───────────────────────
  const [wsEditVoiceId, setWsEditVoiceId] = useState<number | null>(null)
  const [wsSpeedValue,  setWsSpeedValue]  = useState(1.0)
  const [wsPitchValue,  setWsPitchValue]  = useState(0)

  const handleWsSave = async (voiceId: number) => {
    try {
      await updateWsVoiceMut.mutateAsync({ id: voiceId, speed: wsSpeedValue, pitch: wsPitchValue })
      setWsEditVoiceId(null)
      const desc = [
        wsSpeedValue !== 1.0 ? `${wsSpeedValue.toFixed(2)}× velocidad` : null,
        wsPitchValue !== 0 ? `${wsPitchValue > 0 ? "+" : ""}${wsPitchValue} st tono` : null,
      ].filter(Boolean).join(" · ") || "Sin cambios"
      toast({ title: "Ajustes de voz guardados", description: desc })
      void refetchWavespeedVoices()
    } catch {
      toast({ title: "Error", description: "No se pudo guardar los ajustes", variant: "destructive" })
    }
  }

  // Poll voices every 10 s when any cloned voice is still processing so the UI
  // updates automatically when HeyGen finishes without a manual refresh.
  const hasPendingVoices = (voices ?? []).some(
    (v) => (v as any).is_mine && (v as any).status === "pending"
  )
  const hasPendingWavespeedVoices = wavespeedVoices.some((v) => v.status === "pending")
  useEffect(() => {
    if (!hasPendingVoices) return
    const interval = setInterval(() => { refetchVoices() }, 10_000)
    return () => clearInterval(interval)
  }, [hasPendingVoices, refetchVoices])

  useEffect(() => {
    if (!hasPendingWavespeedVoices) return
    const interval = setInterval(() => { refetchWavespeedVoices() }, 6_000)
    return () => clearInterval(interval)
  }, [hasPendingWavespeedVoices, refetchWavespeedVoices])

  // ── Shared selection state ────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [strategy, setStrategy] = useState<AvatarConfigRotationStrategy>(AvatarConfigRotationStrategy.sequential)
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({})
  const configInitialized = useRef(false)

  // lookGroupMap: lookId → groupId. Persisted to localStorage so the
  // "Solo en uso" filter works across page refreshes without re-opening dialogs.
  const LOOK_GROUP_MAP_KEY = "avatar_look_group_map"
  const [lookGroupMap, setLookGroupMap] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(LOOK_GROUP_MAP_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  // lookAvatarTypeMap: lookId → avatar_type ("digital_twin" | "photo_avatar" | "studio_avatar")
  // Populated when looks are loaded for a group. Used to build look_metadata on save.
  const [lookAvatarTypeMap, setLookAvatarTypeMap] = useState<Record<string, string>>({})

  // lookDataMap: lookId → { name, preview_image_url }
  // Populated when looks are loaded so we can show them by name/thumbnail in warnings.
  const [lookDataMap, setLookDataMap] = useState<Record<string, { name: string; preview_image_url: string | null }>>({})

  // Persist every time the map changes
  useEffect(() => {
    try { localStorage.setItem(LOOK_GROUP_MAP_KEY, JSON.stringify(lookGroupMap)) } catch {}
  }, [lookGroupMap])

  const handleLooksLoaded = useCallback((groupId: string, looks: V3Look[]) => {
    setLookGroupMap(prev => {
      const next = { ...prev }
      let changed = false
      for (const l of looks) {
        if (next[l.id] !== groupId) { next[l.id] = groupId; changed = true }
      }
      return changed ? next : prev
    })
    setLookAvatarTypeMap(prev => {
      const next = { ...prev }
      let changed = false
      for (const l of looks) {
        if (next[l.id] !== l.avatar_type) { next[l.id] = l.avatar_type; changed = true }
      }
      return changed ? next : prev
    })
    setLookDataMap(prev => {
      const next = { ...prev }
      let changed = false
      for (const l of looks) {
        if (!next[l.id] || next[l.id].name !== l.name || next[l.id].preview_image_url !== l.preview_image_url) {
          next[l.id] = { name: l.name, preview_image_url: l.preview_image_url }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  // ── WaveSpeed personas ────────────────────────────────────────────────────
  const { data: wavespeedData, refetch: refetchWavespeed } = useWavespeedPersonas()
  const wavespeedPersonas = wavespeedData?.personas ?? []
  // Plan limit enforcement for Avatar AI creation button
  const avatarPlanLimit = wavespeedData?.planLimit ?? 0
  const atAvatarLimit = avatarPlanLimit > 0 && wavespeedPersonas.length >= avatarPlanLimit

  // Count of WaveSpeed looks currently selected for rotation across ALL personas.
  const wavespeedSelectedCount = useMemo(() => {
    return wavespeedPersonas.reduce((total, persona) => {
      if (persona.planEnabled === false) return total
      return total + persona.looks.filter(look => {
        try { return !!(JSON.parse(look.config ?? "{}") as { selected?: boolean }).selected }
        catch { return false }
      }).length
    }, 0)
  }, [wavespeedPersonas])

  // voiceId → active looks that have that voice assigned
  const wsVoiceAssignedLooks = useMemo(() => {
    const map = new Map<number, WavespeedLookRow[]>()
    for (const persona of wavespeedPersonas) {
      if (persona.planEnabled === false) continue
      for (const look of persona.looks) {
        try {
          const cfg = JSON.parse(look.config ?? "{}") as { selected?: boolean; voiceId?: number | null }
          if (cfg.selected && cfg.voiceId != null) {
            const list = map.get(cfg.voiceId) ?? []
            list.push(look)
            map.set(cfg.voiceId, list)
          }
        } catch { /* skip */ }
      }
    }
    return map
  }, [wavespeedPersonas])

  // Plan access gate — blocks creation actions without an active subscription
  const accessState = useAccessState()
  const [premiumOpen, setPremiumOpen] = useState(false)

  const [showWavespeedWizard, setShowWavespeedWizard] = useState(false)
  const [openWavespeedPersona, setOpenWavespeedPersona] = useState<WavespeedPersonaWithLooks | null>(null)
  const [showCreateLookForPersona, setShowCreateLookForPersona] = useState(false)

  // Keep openWavespeedPersona in sync when mutations invalidate the personas query
  // so look selection/deselection changes are visible immediately.
  useEffect(() => {
    if (!openWavespeedPersona || !wavespeedData) return
    const updated = wavespeedData.personas.find(p => p.id === openWavespeedPersona.id)
    if (updated) setOpenWavespeedPersona(updated)
  }, [wavespeedData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [openGroup, setOpenGroup] = useState<{ group: V3Group; isOwned: boolean } | null>(null)
  const [dialogSaveStatus, setDialogSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveReadyRef = useRef(false)
  // Holds a function that fires the pending save immediately.
  // Armed by the auto-save effect; called by the flush-on-unmount effect so
  // navigating away before the 700 ms debounce fires never loses a change.
  const flushSaveRef = useRef<(() => void) | null>(null)
  // ── My Avatar tab ─────────────────────────────────────────────────────────

  // Reverse-lookup: resolve selected look IDs that are not yet in lookGroupMap.
  // Handles public-group looks selected in a previous session before localStorage
  // was in place — calls the server's cached flat-looks index.
  const selectedIdsKey = Array.from(selectedIds).sort().join(",")
  useEffect(() => {
    if (!selectedIds.size) return
    const unknown = Array.from(selectedIds).filter(id => !(id in lookGroupMap))
    if (!unknown.length) return
    fetch(`/api/heygen/looks/reverse-lookup?ids=${unknown.map(encodeURIComponent).join(",")}`, {
      credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then((mapping: Record<string, string> | null) => {
        if (!mapping) return
        setLookGroupMap(prev => {
          const next = { ...prev }
          let changed = false
          for (const [lookId, groupId] of Object.entries(mapping)) {
            if (next[lookId] !== groupId) { next[lookId] = groupId; changed = true }
          }
          return changed ? next : prev
        })
      })
      .catch(() => {})
  }, [selectedIdsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public tab ────────────────────────────────────────────────────────────
  const {
    data: publicPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingPublic,
  } = usePublicHeyGenAvatarGroups()
  const publicGroups: V3Group[] = publicPages?.pages.flatMap(p => p.groups) ?? []

  // voiceId → selected HeyGen groups that have that voice assigned
  const heygenVoiceAssignedGroups = useMemo(() => {
    const map = new Map<string, V3Group[]>()
    const allGroupsById = new Map(publicGroups.map(g => [g.id, g]))
    for (const [lookId, voiceId] of Object.entries(voiceOverrides)) {
      if (!selectedIds.has(lookId)) continue
      const groupId = lookGroupMap[lookId]
      if (!groupId) continue
      const group = allGroupsById.get(groupId)
      if (!group) continue
      const list = map.get(voiceId) ?? []
      if (!list.some(g => g.id === groupId)) list.push(group)
      map.set(voiceId, list)
    }
    return map
  }, [voiceOverrides, lookGroupMap, selectedIds, publicGroups])

  // ── Spanish voices (for look-level picker) ────────────────────────────────
  // Exclude pending/failed cloned voices — they can't be used for generation yet.
  const spanishVoices: VoiceOption[] = useMemo(
    () =>
      (voices ?? [])
        .filter((v) => {
          const lang = (v.language ?? "").toLowerCase()
          const isLang = lang.includes("spanish") || lang.startsWith("es") || lang === "unknown" || v.is_cloned
          const isUsable = !((v as any).is_mine) || (v as any).status === "ready" || (v as any).status == null
          return isLang && isUsable
        })
        .map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          language: v.language ?? "",
          gender: v.gender ?? null,
          preview_audio_url: v.preview_audio_url ?? null,
          is_cloned: v.is_cloned ?? false,
          is_mine: v.is_mine ?? false,
          speed: (v as any).speed ?? null,
          pitch: (v as any).pitch ?? null,
          status: (v as any).status ?? null,
          clone_id: (v as any).clone_id ?? undefined,
        })),
    [voices]
  )

  // ── All voices (for Voces tab) — clones first, then Spanish public ─────────
  const allVoices: VoiceOption[] = useMemo(
    () =>
      (voices ?? [])
        .map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          language: v.language ?? "",
          gender: v.gender ?? null,
          preview_audio_url: v.preview_audio_url ?? null,
          is_cloned: v.is_cloned ?? false,
          is_mine: v.is_mine ?? false,
          speed: (v as any).speed ?? null,
          pitch: (v as any).pitch ?? null,
          status: (v as any).status ?? null,
          clone_id: (v as any).clone_id ?? undefined,
        }))
        .sort((a, b) => {
          if (a.is_mine && !b.is_mine) return -1
          if (!a.is_mine && b.is_mine) return 1
          if (a.is_cloned && !b.is_cloned) return -1
          if (!a.is_cloned && b.is_cloned) return 1
          return a.name.localeCompare(b.name)
        }),
    [voices]
  )

  // ── Toast when a cloned voice transitions from pending → ready ────────────
  // We key the ref by clone_id (stable DB row PK) — NOT by voice_id — so the
  // pending→ready transition is detected even when the voice_clone_id is replaced
  // with a different final voice_id by the scheduler poller on completion.
  const prevVoiceStatusesRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const prev = prevVoiceStatusesRef.current
    const myVoices = allVoices.filter(v => v.is_mine)

    for (const v of myVoices) {
      // Use clone_id (stable) when available, fall back to voice_id for public
      // cloned voices that have no DB row (shouldn't happen, but safe).
      const trackingKey = v.clone_id != null ? String(v.clone_id) : v.voice_id
      const prevStatus = prev.get(trackingKey)
      if (prevStatus === "pending" && v.status === "ready") {
        toast({
          title: "¡Tu voz ya está lista! 🎙️",
          description: `"${v.name}" está lista para usar en tus videos.`,
        })
      }
    }

    // Update the ref for the next render
    const next = new Map<string, string>()
    for (const v of myVoices) {
      if (v.status) {
        const trackingKey = v.clone_id != null ? String(v.clone_id) : v.voice_id
        next.set(trackingKey, v.status)
      }
    }
    prevVoiceStatusesRef.current = next
  }, [allVoices]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice tab state ────────────────────────────────────────────────────────
  const [showCloneDialog, setShowCloneDialog] = useState(false)
  const [voiceSearch, setVoiceSearch] = useState("")
  const [voiceLangFilter, setVoiceLangFilter] = useState<string>("all")
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<string>("all")
  const [assignVoice, setAssignVoice] = useState<VoiceOption | null>(null)

  // Available language options derived from the public voices list.
  // HeyGen returns many variants per language ("Spanish", "spanish", "es-US",
  // "es-ES", "Filipino", "filipino", "fil-PH"…).
  // Strategy: normalize every raw string to a base key (lowercase, strip locale
  // suffix, collapse known aliases), then group by that key.
  const publicVoiceLanguages = useMemo(() => {
    // Well-known overrides: any raw string whose normalized base matches a key
    // here gets that canonical key + label instead of the generic one.
    const ALIASES: Record<string, { key: string; label: string }> = {
      es: { key: "es", label: "Español" },
      spanish: { key: "es", label: "Español" },
      en: { key: "en", label: "Inglés" },
      english: { key: "en", label: "Inglés" },
      pt: { key: "pt", label: "Portugués" },
      portuguese: { key: "pt", label: "Portugués" },
      fr: { key: "fr", label: "Francés" },
      french: { key: "fr", label: "Francés" },
      de: { key: "de", label: "Alemán" },
      german: { key: "de", label: "Alemán" },
      it: { key: "it", label: "Italiano" },
      italian: { key: "it", label: "Italiano" },
      ja: { key: "ja", label: "Japonés" },
      japanese: { key: "ja", label: "Japonés" },
      zh: { key: "zh", label: "Chino" },
      chinese: { key: "zh", label: "Chino" },
      ko: { key: "ko", label: "Coreano" },
      korean: { key: "ko", label: "Coreano" },
      ar: { key: "ar", label: "Árabe" },
      arabic: { key: "ar", label: "Árabe" },
      hi: { key: "hi", label: "Hindi" },
      hindi: { key: "hi", label: "Hindi" },
      ru: { key: "ru", label: "Ruso" },
      russian: { key: "ru", label: "Ruso" },
      fil: { key: "fil", label: "Filipino" },
      filipino: { key: "fil", label: "Filipino" },
      tl: { key: "fil", label: "Filipino" },
      tagalog: { key: "fil", label: "Filipino" },
      id: { key: "id", label: "Indonesio" },
      indonesian: { key: "id", label: "Indonesio" },
      ms: { key: "ms", label: "Malayo" },
      malay: { key: "ms", label: "Malayo" },
      th: { key: "th", label: "Tailandés" },
      thai: { key: "th", label: "Tailandés" },
      vi: { key: "vi", label: "Vietnamita" },
      vietnamese: { key: "vi", label: "Vietnamita" },
      tr: { key: "tr", label: "Turco" },
      turkish: { key: "tr", label: "Turco" },
      nl: { key: "nl", label: "Holandés" },
      dutch: { key: "nl", label: "Holandés" },
      pl: { key: "pl", label: "Polaco" },
      polish: { key: "pl", label: "Polaco" },
      uk: { key: "uk", label: "Ucraniano" },
      ukrainian: { key: "uk", label: "Ucraniano" },
      ro: { key: "ro", label: "Rumano" },
      romanian: { key: "ro", label: "Rumano" },
      sv: { key: "sv", label: "Sueco" },
      swedish: { key: "sv", label: "Sueco" },
      da: { key: "da", label: "Danés" },
      danish: { key: "da", label: "Danés" },
      no: { key: "no", label: "Noruego" },
      norwegian: { key: "no", label: "Noruego" },
      fi: { key: "fi", label: "Finlandés" },
      finnish: { key: "fi", label: "Finlandés" },
      cs: { key: "cs", label: "Checo" },
      czech: { key: "cs", label: "Checo" },
      hu: { key: "hu", label: "Húngaro" },
      hungarian: { key: "hu", label: "Húngaro" },
      el: { key: "el", label: "Griego" },
      greek: { key: "el", label: "Griego" },
      he: { key: "he", label: "Hebreo" },
      hebrew: { key: "he", label: "Hebreo" },
      bn: { key: "bn", label: "Bengalí" },
      bengali: { key: "bn", label: "Bengalí" },
      ta: { key: "ta", label: "Tamil" },
      tamil: { key: "ta", label: "Tamil" },
      ur: { key: "ur", label: "Urdu" },
      urdu: { key: "ur", label: "Urdu" },
      sw: { key: "sw", label: "Suajili" },
      swahili: { key: "sw", label: "Suajili" },
      catalan: { key: "ca", label: "Catalán" },
      ca: { key: "ca", label: "Catalán" },
    }

    /**
     * Given a raw language string (e.g. "es-US", "Spanish (US)", "filipino"),
     * returns a stable canonical key and a display label.
     */
    const normalize = (raw: string): { key: string; label: string } | null => {
      if (!raw || raw.toLowerCase() === "unknown") return null
      // Strip locale suffix: "es-US" → "es", "fil-PH" → "fil"
      const base = raw.toLowerCase().split(/[-_(]/)[0].trim()
      const hit = ALIASES[base]
      if (hit) return hit
      // Unknown language: use normalized base as key, capitalize as label
      const label = base.charAt(0).toUpperCase() + base.slice(1)
      return { key: base, label }
    }

    const langs = new Map<string, { label: string; raws: Set<string> }>()
    for (const v of allVoices) {
      if (v.is_mine || v.is_cloned) continue
      const c = normalize(v.language)
      if (!c) continue
      const entry = langs.get(c.key)
      if (entry) {
        entry.raws.add(v.language)
      } else {
        langs.set(c.key, { label: c.label, raws: new Set([v.language]) })
      }
    }

    return Array.from(langs.entries())
      .map(([key, { label, raws }]) => ({ key, label, raws: Array.from(raws) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allVoices])
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)
  const [renamingVoiceId, setRenamingVoiceId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [editingSpeedVoiceId, setEditingSpeedVoiceId] = useState<string | null>(null)
  const [speedEditValue, setSpeedEditValue] = useState(1.0)
  const [pitchEditValue, setPitchEditValue] = useState(0)
  const [tuningPreviewVoiceId, setTuningPreviewVoiceId] = useState<string | null>(null)
  const renameVoiceMut = { isPending: false, mutateAsync: async (_x: unknown) => ({ ok: true }) }
  const deleteVoiceMut = { isPending: false, mutateAsync: async (_x: unknown) => ({ ok: true }) }
  const updateVoiceMut = { isPending: false, mutateAsync: async (_x: unknown) => ({ ok: true }) }
  const handleRenameVoice = async (_id: string) => { setRenamingVoiceId(null) }
  const handleDeleteVoice = async (_id: string) => {}
  const handlePreviewTuning = async (_id: string, _url: string | null) => { setTuningPreviewVoiceId(null) }
  const handleSaveVoiceSpeed = async (_id: string) => { setEditingSpeedVoiceId(null) }
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const handlePlayPreview = (voiceId: string, url: string) => {
    if (playingVoiceId === voiceId) {
      audioRef.current?.pause()
      setPlayingVoiceId(null)
      return
    }
    if (audioRef.current) audioRef.current.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => setPlayingVoiceId(null)
    audio.play().catch(() => {})
    setPlayingVoiceId(voiceId)
  }

  // ── Init from server config ────────────────────────────────────────────────
  useEffect(() => {
    if (config && !configInitialized.current) {
      configInitialized.current = true
      setSelectedIds(new Set(config.selected_avatar_ids))
      setStrategy(config.rotation_strategy)
      setVoiceOverrides((config.voice_overrides as Record<string, string>) ?? {})
    }
  }, [config])

  // Enable auto-save 400 ms after config first loads (avoids saving on init)
  useEffect(() => {
    if (!configInitialized.current) return
    const t = setTimeout(() => { autoSaveReadyRef.current = true }, 400)
    return () => clearTimeout(t)
  }, [config]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush any pending save when the component unmounts (user navigates away before
  // the 700 ms debounce fires).  React Query mutations survive unmount so the HTTP
  // request still completes even though the component is gone.
  useEffect(() => {
    return () => { flushSaveRef.current?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save: fires 700 ms after the last change.
  // Captures a snapshot of current values so both the debounce callback and
  // flush-on-unmount use consistent, up-to-date data.
  useEffect(() => {
    if (!autoSaveReadyRef.current) return
    // Always clear the old timer first — even when selection is now empty
    // (avoids a stale timer firing with the previous non-empty selection).
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)

    // Snapshot at scheduling time so the closure is stable.
    const snapshotIds       = new Set(selectedIds)
    const snapshotOverrides = { ...voiceOverrides }
    const snapshotStrategy  = strategy
    const snapshotGroupMap  = { ...lookGroupMap }
    const snapshotTypeMap   = { ...lookAvatarTypeMap }

    const doSave = () => {
      const cleanedOverrides: Record<string, string> = {}
      for (const [lookId, voiceId] of Object.entries(snapshotOverrides)) {
        // Preserve voice overrides for ALL looks — both selected and public/unselected.
        // Previously this filtered by snapshotIds.has(lookId), which stripped any
        // voice assignment made to a public look that wasn't yet in the active
        // rotation, causing the assignment to vanish on the next debounce cycle.
        if (voiceId && voiceId !== LOOK_DEFAULT_VOICE_SENTINEL) {
          cleanedOverrides[lookId] = voiceId
        }
      }
      // Build per-look metadata for Avatar V reference stabilization.
      const lookMetadata: Record<string, { group_id: string; avatar_type: string }> = {}
      for (const [lookId, groupId] of Object.entries(snapshotGroupMap)) {
        const avatarType = snapshotTypeMap[lookId]
        if (avatarType) lookMetadata[lookId] = { group_id: groupId, avatar_type: avatarType }
      }
      updateConfig.mutate(
        {
          data: {
            selected_avatar_ids: Array.from(snapshotIds),
            rotation_strategy: snapshotStrategy,
            preferred_voice_id: null,
            voice_overrides: cleanedOverrides,
            look_metadata: Object.keys(lookMetadata).length > 0 ? lookMetadata : undefined,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetAvatarConfigQueryKey() })
            setDialogSaveStatus("saved")
            setTimeout(() => setDialogSaveStatus("idle"), 2500)
          },
          onError: () => {
            setDialogSaveStatus("idle")
            toast({ title: "Error al guardar", description: "No se pudo guardar la configuración.", variant: "destructive" })
          },
        },
      )
    }

    flushSaveRef.current = doSave   // arm — called on unmount if timer hasn't fired
    setDialogSaveStatus("idle")

    autoSaveTimerRef.current = setTimeout(() => {
      flushSaveRef.current = null   // disarm — timer fired normally
      if (updateConfig.isPending) return
      setDialogSaveStatus("saving")
      doSave()
    }, 700)

    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [selectedIds, voiceOverrides, strategy]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed ──────────────────────────────────────────────────────────────
  const selectedByGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const [lookId, groupId] of Object.entries(lookGroupMap)) {
      if (selectedIds.has(lookId)) {
        map.set(groupId, (map.get(groupId) ?? 0) + 1)
      }
    }
    return map
  }, [selectedIds, lookGroupMap])

  // Looks sin voz asignada por grupo — solo relevante para avatares públicos
  const voicelessByGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const [lookId, groupId] of Object.entries(lookGroupMap)) {
      if (selectedIds.has(lookId)) {
        const override = voiceOverrides[lookId]
        if (!override || override === LOOK_DEFAULT_VOICE_SENTINEL) {
          map.set(groupId, (map.get(groupId) ?? 0) + 1)
        }
      }
    }
    return map
  }, [selectedIds, voiceOverrides, lookGroupMap])

  const globalVoiceValue = useMemo(() => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return LOOK_DEFAULT_VOICE_SENTINEL
    const first = voiceOverrides[ids[0]] ?? LOOK_DEFAULT_VOICE_SENTINEL
    return ids.every((id) => (voiceOverrides[id] ?? LOOK_DEFAULT_VOICE_SENTINEL) === first) ? first : "mixed"
  }, [selectedIds, voiceOverrides])

  const voicelessTotal = useMemo(
    () => Array.from(voicelessByGroup.values()).reduce((a, b) => a + b, 0),
    [voicelessByGroup],
  )

  // Flat list of selected looks without voice — used in the warning banner
  const voicelessLooks = useMemo(() => {
    const result: Array<{ id: string; name: string; preview_image_url: string | null }> = []
    for (const [lookId] of Object.entries(lookGroupMap)) {
      if (selectedIds.has(lookId)) {
        const override = voiceOverrides[lookId]
        if (!override || override === LOOK_DEFAULT_VOICE_SENTINEL) {
          const data = lookDataMap[lookId]
          result.push({
            id: lookId,
            name: data?.name ?? lookId,
            preview_image_url: data?.preview_image_url ?? null,
          })
        }
      }
    }
    return result
  }, [selectedIds, voiceOverrides, lookGroupMap, lookDataMap])

  // ── Filter: show only avatar groups that have selected looks ──────────────
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const filteredPublicGroups = showOnlySelected
    ? publicGroups.filter(g => (selectedByGroup.get(g.id) ?? 0) > 0)
    : publicGroups

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleLook = (id: string) => {
    if (!canUseFeature(accessState, "use_public_avatar")) {
      setPremiumOpen(true)
      return
    }
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const deselectLooks = useCallback((ids: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      let changed = false
      for (const id of ids) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
  }, [])

  const handleVoiceChange = (lookId: string, voiceId: string) => {
    setVoiceOverrides(prev => {
      const next = { ...prev }
      if (voiceId === LOOK_DEFAULT_VOICE_SENTINEL) delete next[lookId]
      else next[lookId] = voiceId
      return next
    })
  }

  const handleGlobalVoiceChange = (voiceId: string) => {
    setVoiceOverrides(prev => {
      const next = { ...prev }
      for (const id of selectedIds) {
        if (voiceId === LOOK_DEFAULT_VOICE_SENTINEL) delete next[id]
        else next[id] = voiceId
      }
      return next
    })
  }

  if (isLoadingConfig) {
    return <div className="p-8"><Skeleton className="h-96 w-full rounded-xl" /></div>
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Avatares</h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Selecciona los looks que usará Reelsona en tus videos.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground h-9 px-1">
          {dialogSaveStatus === "saving" && (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
          )}
          {dialogSaveStatus === "saved" && (
            <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> <span className="text-emerald-600 dark:text-emerald-400">Guardado</span></>
          )}
        </div>
      </div>

      {/* Rotation config */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-center">
            <div className="w-14 h-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold font-display">Rotación de avatar</h3>
                {(selectedIds.size + wavespeedSelectedCount) > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                    {selectedIds.size + wavespeedSelectedCount} {(selectedIds.size + wavespeedSelectedCount) === 1 ? "look" : "looks"}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">
                Cómo rotar entre los looks seleccionados en cada video.
              </p>
            </div>
            <div className="w-full sm:w-52 shrink-0">
              <Label className="mb-2 block text-sm">Rotación</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as AvatarConfigRotationStrategy)}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AvatarConfigRotationStrategy.sequential}>Secuencial (1, 2, 3…)</SelectItem>
                  <SelectItem value={AvatarConfigRotationStrategy.random}>Aleatorio</SelectItem>
                  <SelectItem value={AvatarConfigRotationStrategy.performance}>Por Rendimiento (IA)</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => { configInitialized.current = false; queryClient.invalidateQueries({ queryKey: getGetAvatarConfigQueryKey() }) }}
                className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Recargar configuración
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Voice warning */}
      {voicelessTotal > 0 && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-amber-800 dark:text-amber-300">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-snug">
                <span className="font-semibold">
                  {voicelessTotal} {voicelessTotal === 1 ? "look seleccionado no tiene" : "looks seleccionados no tienen"} voz asignada.
                </span>
                {" "}Los videos generados usarán la voz por defecto del sistema. Asigna una voz desde la pestaña de cada avatar.
              </p>
              {voicelessLooks.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {voicelessLooks.map(look => (
                    <div
                      key={look.id}
                      className="flex items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-100/60 dark:bg-amber-900/30 px-2 py-1"
                    >
                      <div className="w-6 h-6 rounded overflow-hidden shrink-0 bg-amber-200/60 dark:bg-amber-800/40 flex items-center justify-center">
                        {look.preview_image_url ? (
                          <img
                            src={look.preview_image_url}
                            alt={look.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 uppercase">
                            {look.name.slice(0, 2)}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-medium leading-none max-w-[120px] truncate">
                        {look.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="my">
        <TabsList className="mb-4">
          <TabsTrigger value="my" className="gap-1.5">
            Mi Avatar
            {wavespeedSelectedCount > 0 && (
              <span className="inline-flex items-center justify-center text-[10px] font-bold leading-none bg-violet-500 text-white rounded-full min-w-[18px] h-[18px] px-1">
                {wavespeedSelectedCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="public" className="gap-1.5">
            Avatares públicos
            {selectedIds.size > 0 && (
              <span className="inline-flex items-center justify-center text-[10px] font-bold leading-none bg-primary text-primary-foreground rounded-full min-w-[18px] h-[18px] px-1">
                {selectedIds.size}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="voices">Voces</TabsTrigger>
        </TabsList>

        {/* ── Mi Avatar tab ── */}
        <TabsContent value="my" className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm text-muted-foreground">
                Tus avatares AI generados con tu cara.
              </p>
              {avatarPlanLimit > 0 && (
                <p className="text-xs text-muted-foreground/60">
                  {wavespeedPersonas.length}/{avatarPlanLimit} Avatar{avatarPlanLimit !== 1 ? "es" : ""} AI
                  {wavespeedData?.planSlug && wavespeedData.planSlug !== "admin"
                    ? ` · Plan ${wavespeedData.planSlug.charAt(0).toUpperCase() + wavespeedData.planSlug.slice(1)}`
                    : ""}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-violet-400/60 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-50"
                disabled={atAvatarLimit}
                title={atAvatarLimit ? "Límite de Avatares AI alcanzado en tu plan actual" : undefined}
                onClick={() => { if (!canUseFeature(accessState, "create_avatar")) { setPremiumOpen(true); return }; setShowWavespeedWizard(true) }}
              >
                <Sparkles className="w-4 h-4" />
                Nuevo Avatar AI
              </Button>
            </div>
          </div>

          {/* Background pollers — fire even while the persona dialog is closed.
              React Query deduplicates the request if the dialog also polls. */}
          {wavespeedPersonas
            .filter((p) =>
              p.looks.some((l) => {
                try {
                  const cfg = JSON.parse(l.config ?? "{}") as { generationStatus?: string }
                  return cfg.generationStatus === "pending" || (cfg.generationStatus === "ready" && !l.imageUrl)
                } catch { return false }
              }),
            )
            .map((p) => <WavespeedPendingPoller key={p.id} persona={p} />)}

          {wavespeedPersonas.length === 0 ? (
            /* Empty state — no WaveSpeed avatars yet */
            <div className="border-2 border-dashed rounded-2xl p-12 text-center flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-violet-100 dark:bg-violet-950/40 rounded-2xl flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display">Crea tu Avatar AI</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
                  Sube una foto tuya y la IA generará looks personalizados con tu cara para usar en tus videos.
                </p>
              </div>
              <Button className="gap-2 border-violet-400/60 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 border hover:bg-violet-100 dark:hover:bg-violet-950/50" onClick={() => { if (!canUseFeature(accessState, "create_avatar")) { setPremiumOpen(true); return }; setShowWavespeedWizard(true) }}>
                <Sparkles className="w-4 h-4" />
                Nuevo Avatar AI
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
              {wavespeedPersonas.map((persona) => (
                <WavespeedPersonaCard
                  key={`ws-${persona.id}`}
                  persona={persona}
                  onClick={() => setOpenWavespeedPersona(persona)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Avatares públicos tab ── */}
        <TabsContent value="public" className="space-y-6">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Avatares públicos verticales listos para usar en Reels.
            </p>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setShowOnlySelected(v => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors
                  ${showOnlySelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                {showOnlySelected ? "Ver todos" : `Solo en uso (${selectedIds.size})`}
              </button>
            )}
          </div>

          {isLoadingPublic ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
            </div>
          ) : publicGroups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No se pudieron cargar los avatares públicos</p>
            </div>
          ) : filteredPublicGroups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Ningún avatar público en uso</p>
              <button type="button" onClick={() => setShowOnlySelected(false)} className="mt-2 text-xs text-primary hover:underline">
                Ver todos los avatares
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
                {filteredPublicGroups.map((group) => (
                  <AvatarGroupCard
                    key={group.id}
                    group={group}
                    selectedCount={selectedByGroup.get(group.id) ?? 0}
                    onClick={() => setOpenGroup({ group, isOwned: false })}
                    voicelessCount={voicelessByGroup.get(group.id) ?? 0}
                  />
                ))}
              </div>

              {!showOnlySelected && hasNextPage && (
                <div className="text-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="gap-2"
                  >
                    {isFetchingNextPage
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</>
                      : <><ChevronDown className="w-4 h-4" /> Cargar más avatares</>}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Voces tab ── */}
        <TabsContent value="voices" className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              Elige una voz pública central para asociarla a tus avatares.
            </p>
            <Button
              type="button"
              onClick={() => setShowCloneDialog(true)}
              className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Mic className="w-4 h-4" />
              Clonar mi voz
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar voz…"
              value={voiceSearch}
              onChange={e => setVoiceSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Invisible pollers — one per pending voice clone, each polls WaveSpeed every 5 s */}
          {wavespeedVoices.filter((v) => v.status === "pending").map((v) => (
            <PendingVoicePoller key={v.id} voiceId={v.id} />
          ))}

          {/* WaveSpeed cloned voices */}
          {wavespeedVoices.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Mic className="w-4 h-4 text-violet-500" />
                Mis voces clonadas
                <Badge className="bg-violet-600 text-white text-[10px] px-1.5 py-0">AI</Badge>
              </h3>
              <div className="space-y-2">
                {wavespeedVoices
                  .filter(v => !voiceSearch || v.displayName.toLowerCase().includes(voiceSearch.toLowerCase()))
                  .map(v => {
                    const wsAssignedLooks = wsVoiceAssignedLooks.get(v.id) ?? []
                    const wsIsAssigned = v.status === "ready" && wsAssignedLooks.length > 0
                    return (
                    <div key={v.id} className={`rounded-xl border overflow-hidden transition-colors ${wsIsAssigned ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/20" : "bg-card"}`}>
                    <div className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        v.status === "pending" ? "bg-amber-500/10" : v.status === "failed" ? "bg-destructive/10" : "bg-violet-500/10"
                      }`}>
                        {v.status === "pending"
                          ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                          : v.status === "failed"
                            ? <AlertCircle className="w-4 h-4 text-destructive" />
                            : <Mic className="w-4 h-4 text-violet-500" />
                        }
                      </div>
                      {/* Clickable info area — opens avatar assignment sheet for ready voices */}
                      <div
                        className={`flex-1 min-w-0 ${v.status === "ready" ? "cursor-pointer" : ""}`}
                        onClick={() => v.status === "ready" && setWsVoiceAssignTarget(v)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-medium truncate">{v.displayName}</p>
                          {v.status === "pending" && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400/70 text-amber-600 bg-amber-50 dark:bg-amber-950/30 shrink-0">
                              Procesando…
                            </Badge>
                          )}
                          {v.status === "failed" && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive/60 text-destructive shrink-0">
                              Error
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {v.status === "pending"
                            ? "Clonando voz con AI…"
                            : v.status === "failed"
                              ? "No se pudo procesar la voz — intenta clonar de nuevo"
                              : "Toca para asignar a avatares →"
                          }
                        </p>
                      </div>
                      {/* Play preview */}
                      {v.status === "ready" && v.wavespeedVoiceId && (
                        <Button
                          size="sm" variant="ghost"
                          className={`w-8 h-8 p-0 shrink-0 transition-colors ${
                            clonePlayingId === v.id
                              ? "text-violet-600"
                              : "text-violet-400 hover:text-violet-600"
                          }`}
                          onClick={() => playClonedVoice(v.id)}
                          disabled={cloneLoadingId === v.id}
                          title={
                            cloneLoadingId === v.id ? "Generando preview…" :
                            clonePlayingId === v.id ? "Detener" : "Escuchar voz clonada"
                          }
                        >
                          {cloneLoadingId === v.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : clonePlayingId === v.id
                              ? <Square className="w-3 h-3 fill-current" />
                              : <Play className="w-3.5 h-3.5 fill-current" />}
                        </Button>
                      )}
                      {/* Delete */}
                      <Button
                        size="sm" variant="ghost"
                        className="w-8 h-8 p-0 text-destructive hover:text-destructive shrink-0"
                        onClick={async () => {
                          try { await deleteWavespeedVoice.mutateAsync(v.id) }
                          catch { toast({ title: "Error al eliminar la voz", variant: "destructive" }) }
                        }}
                        disabled={deleteWavespeedVoice.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {wsIsAssigned && (
                      <div className="flex items-center gap-1.5 px-3 pb-2.5">
                        <span className="text-[10px] text-violet-600 font-semibold uppercase tracking-wide mr-1">En uso:</span>
                        {wsAssignedLooks.slice(0, 6).map(look =>
                          look.imageUrl ? (
                            <img key={look.id} src={look.imageUrl} alt={look.name} title={look.name}
                              className="w-6 h-6 rounded-full object-cover border-2 border-violet-400 shrink-0 -ml-1 first:ml-0" />
                          ) : (
                            <div key={look.id} title={look.name}
                              className="w-6 h-6 rounded-full bg-violet-200 dark:bg-violet-900 border-2 border-violet-400 flex items-center justify-center shrink-0 -ml-1 first:ml-0">
                              <Users className="w-3 h-3 text-violet-600" />
                            </div>
                          )
                        )}
                        {wsAssignedLooks.length > 6 && (
                          <span className="text-[10px] text-violet-600 font-medium ml-1">+{wsAssignedLooks.length - 6}</span>
                        )}
                      </div>
                    )}
                  </div>
                  )
                  })}
              </div>
            </div>
          )}

          {/* WaveSpeed voice → avatar assignment dialog */}
          {wsVoiceAssignTarget && (
            <WsAssignVoiceDialog
              voice={wsVoiceAssignTarget}
              personas={wavespeedPersonas}
              onApply={async (updates) => {
                await Promise.all(
                  updates.map(({ lookId, voiceId }) =>
                    patchWsLookAssign.mutateAsync({ id: lookId, config: { voiceId } })
                  )
                )
                void refetchWavespeed()
                setWsVoiceAssignTarget(null)
                toast({
                  title: "Voz asignada",
                  description: updates.length > 0
                    ? `${updates.length} look${updates.length !== 1 ? "s" : ""} actualizados.`
                    : "Sin cambios.",
                })
              }}
              onClose={() => setWsVoiceAssignTarget(null)}
            />
          )}


          {/* Public voices */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-primary" /> Voces públicas
            </h3>

            {/* Language + gender filter chips */}
            {!isLoadingVoices && publicVoiceLanguages.length > 1 && (
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                {/* Language row */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Idioma</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setVoiceLangFilter("all")}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        voiceLangFilter === "all"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      Todos
                    </button>
                    {publicVoiceLanguages.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setVoiceLangFilter(voiceLangFilter === key ? "all" : key)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          voiceLangFilter === key
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/60" />

                {/* Gender row */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sexo</p>
                  <div className="flex gap-1.5">
                    {(["all", "female", "male"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setVoiceGenderFilter(g)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          voiceGenderFilter === g
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        {g === "all" ? "Todos" : g === "female" ? "Femenina" : "Masculina"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {isLoadingVoices ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
              </div>
            ) : (() => {
              const langEntry = voiceLangFilter !== "all"
                ? publicVoiceLanguages.find(l => l.key === voiceLangFilter)
                : null
              const filtered = allVoices.filter(v => {
                if (v.is_mine) return false
                if (voiceSearch && !v.name.toLowerCase().includes(voiceSearch.toLowerCase())) return false
                if (langEntry && !langEntry.raws.includes(v.language)) return false
                if (voiceGenderFilter !== "all" && v.gender !== voiceGenderFilter) return false
                return true
              })
              return (
                <div className="space-y-2">
                  {filtered.slice(0, 50).map(v => {
                    const pubAssignedGroups = heygenVoiceAssignedGroups.get(v.voice_id) ?? []
                    const pubIsAssigned = pubAssignedGroups.length > 0
                    return (
                    <div key={v.voice_id} className={`rounded-xl border overflow-hidden transition-colors ${pubIsAssigned ? "border-primary/50 bg-primary/5" : "bg-card"}`}>
                      <div className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors">
                        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Volume2 className="w-4 h-4 text-muted-foreground" />
                        </div>
                        {/* Clickable info area — opens public avatar assignment */}
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setAssignVoice(v)}>
                          <p className="text-sm font-medium truncate">{v.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {v.is_cloned ? "Clonada" : "Pública"}
                            {v.gender === "male" ? " · Masculina" : v.gender === "female" ? " · Femenina" : ""}
                            {pubIsAssigned ? " · Asignada" : " · Toca para asignar →"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {v.preview_audio_url && (
                            <Button size="sm" variant="ghost" className="w-8 h-8 p-0"
                              onClick={() => handlePlayPreview(v.voice_id, v.preview_audio_url!)}>
                              {playingVoiceId === v.voice_id
                                ? <Square className="w-3 h-3 fill-current" />
                                : <Play className="w-3 h-3 fill-current" />}
                            </Button>
                          )}
                        </div>
                      </div>
                      {pubIsAssigned && (
                        <div className="flex items-center gap-1.5 px-3 pb-2.5">
                          <span className="text-[10px] text-primary font-semibold uppercase tracking-wide mr-1">En uso:</span>
                          {pubAssignedGroups.slice(0, 6).map(g =>
                            g.preview_image_url ? (
                              <img key={g.id} src={g.preview_image_url} alt={g.name} title={g.name}
                                className="w-6 h-6 rounded-full object-cover border-2 border-primary/50 shrink-0 -ml-1 first:ml-0" />
                            ) : (
                              <div key={g.id} title={g.name}
                                className="w-6 h-6 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center shrink-0 -ml-1 first:ml-0">
                                <Users className="w-3 h-3 text-primary" />
                              </div>
                            )
                          )}
                          {pubAssignedGroups.length > 6 && (
                            <span className="text-[10px] text-primary font-medium ml-1">+{pubAssignedGroups.length - 6}</span>
                          )}
                        </div>
                      )}
                    </div>
                    )
                  })}
                  {filtered.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">No hay voces que coincidan con los filtros</p>
                  )}
                  {filtered.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      Mostrando 50 de {filtered.length} — refina la búsqueda para ver más
                    </p>
                  )}
                </div>
              )
            })()}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Clone voice dialog (WaveSpeed) ── */}
      <CloneWavespeedVoiceDialog
        open={showCloneDialog}
        onClose={() => setShowCloneDialog(false)}
        onCloned={() => { setShowCloneDialog(false); void refetchWavespeedVoices() }}
      />

      {/* ── Assign voice to looks dialog ── */}
      {assignVoice && (
        <AssignVoiceDialog
          voice={assignVoice}
          // Only include selected looks so the dialog shows the correct count
          // and assigns the voice exclusively to looks that are in rotation.
          lookGroupMap={Object.fromEntries(
            Object.entries(lookGroupMap).filter(([lid]) => selectedIds.has(lid))
          )}
          allGroups={(() => {
            return publicGroups.filter(g =>
              Object.entries(lookGroupMap).some(([lid, gid]) => gid === g.id && selectedIds.has(lid))
            )
          })()}
          voiceOverrides={voiceOverrides}
          onAssign={(lookIds: string[]) => {
            const newOverrides = { ...voiceOverrides }
            for (const id of lookIds) newOverrides[id] = assignVoice.voice_id
            setVoiceOverrides(newOverrides)
            setAssignVoice(null)
            toast({
              title: "Voz asignada",
              description: `${lookIds.length} look${lookIds.length !== 1 ? "s" : ""} actualizados.`,
            })
          }}
          onClose={() => setAssignVoice(null)}
        />
      )}

      {/* Dialogs */}
      {/* WaveSpeed Avatar creation wizard */}
      {showWavespeedWizard && (
        <CreateWavespeedAvatarDialog
          onClose={() => setShowWavespeedWizard(false)}
          onCreated={() => {
            setShowWavespeedWizard(false)
            void refetchWavespeed()
          }}
        />
      )}

      <PremiumModal
        open={premiumOpen}
        onClose={() => setPremiumOpen(false)}
      />

      {/* WaveSpeed persona looks dialog */}
      {openWavespeedPersona && (
        <WavespeedPersonaDialog
          persona={openWavespeedPersona}
          onClose={() => setOpenWavespeedPersona(null)}
          onDeleted={() => {
            setOpenWavespeedPersona(null)
            void refetchWavespeed()
          }}
          onNewLook={() => {
            if (!canUseFeature(accessState, "create_look")) { setPremiumOpen(true); return }
            setShowCreateLookForPersona(true)
          }}
          onPlanRequired={() => setPremiumOpen(true)}
        />
      )}

      {/* CreateNewLookDialog — rendered at top level so Radix events work correctly */}
      {openWavespeedPersona && showCreateLookForPersona && (
        <CreateNewLookDialog
          persona={openWavespeedPersona}
          readyLooks={openWavespeedPersona.looks.filter(l => {
            try {
              const cfg = JSON.parse(l.config ?? "{}") as { generationStatus?: string }
              return cfg.generationStatus === "ready" || !!l.imageUrl
            } catch { return !!l.imageUrl }
          })}
          onClose={() => setShowCreateLookForPersona(false)}
          onGenerated={() => setShowCreateLookForPersona(false)}
        />
      )}

      {openGroup && (
        <LooksDialogV3
          group={openGroup.group}
          isOwned={openGroup.isOwned}
          selectedIds={selectedIds}
          voiceOverrides={voiceOverrides}
          voiceOptions={allVoices}
          onToggle={toggleLook}
          onChangeVoice={handleVoiceChange}
          onClose={() => { setOpenGroup(null); setDialogSaveStatus("idle") }}
          onLooksLoaded={handleLooksLoaded}
          verticalOnly={!openGroup.isOwned}
          onDeselect={deselectLooks}
          saveStatus={dialogSaveStatus}
          onPlanRequired={() => setPremiumOpen(true)}
        />
      )}
    </div>
  )
}
