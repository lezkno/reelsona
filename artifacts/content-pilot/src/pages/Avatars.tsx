import { useGetHeyGenAvatarGroups, useGetHeyGenGroupLooks, useGetHeyGenVoices, useGetHeyGenAllLooks, useGetAvatarConfig, useUpdateAvatarConfig, getGetAvatarConfigQueryKey, AvatarConfigRotationStrategy, type HeyGenAvatarGroup } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useState, useEffect } from "react"
import { Users, Save, CheckCircle2, Image as ImageIcon, Play, Square, EyeOff, Eye, X, Plus, ExternalLink, Video, Camera, AlertTriangle, Mic } from "lucide-react"
import { useRef } from "react"

const HIDDEN_KEY = "contentpilot_hidden_avatar_groups"
function loadHidden(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]")) } catch { return new Set() } }
function saveHidden(s: Set<string>) { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])) }

function LooksDialog({ group, selectedIds, onToggle, onClose }: {
  group: HeyGenAvatarGroup
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onClose: () => void
}) {
  const { data: looks, isLoading } = useGetHeyGenGroupLooks(group.id)
  // Track which looks have landscape (horizontal) preview images — those avatars
  // generate landscape videos incompatible with Reels and must be blocked.
  const [landscapeIds, setLandscapeIds] = useState<Set<string>>(new Set())

  const handleImgLoad = (id: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > img.naturalHeight) {
      setLandscapeIds(prev => { const s = new Set(prev); s.add(id); return s })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group.name}</DialogTitle>
          <DialogDescription>
            Elegí los looks de este avatar que querés usar en tus videos. Los seleccionados entran en la rotación.
            Los marcados en naranja son horizontales y no son compatibles con Reels.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {looks?.map((look) => {
              const isSelected = selectedIds.has(look.id)
              const isLandscape = landscapeIds.has(look.id)
              return (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => !isLandscape && onToggle(look.id)}
                  disabled={isLandscape}
                  className={`relative rounded-lg overflow-hidden border-2 text-left transition-all
                    ${isLandscape
                      ? "border-orange-400/60 cursor-not-allowed opacity-75"
                      : isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-transparent hover:border-primary/40"
                    }`}
                >
                  <div className="aspect-[3/4] bg-muted">
                    {look.image_url ? (
                      <img
                        src={look.image_url}
                        alt={look.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onLoad={(e) => handleImgLoad(look.id, e)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="w-8 h-8" />
                      </div>
                    )}
                  </div>

                  {/* Landscape overlay — blocks selection */}
                  {isLandscape && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 gap-2 px-3">
                      <AlertTriangle className="w-7 h-7 text-orange-400 shrink-0" />
                      <p className="text-white text-[11px] font-bold text-center leading-tight">
                        Horizontal<br />
                        <span className="font-normal opacity-80">No compatible con Reels</span>
                      </p>
                    </div>
                  )}

                  {/* Avatar type badge */}
                  {!isLandscape && (
                    <div className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm ${look.is_talking_photo ? "bg-orange-500/90 text-white" : "bg-green-600/90 text-white"}`}>
                      {look.is_talking_photo ? <Camera className="w-2.5 h-2.5" /> : <Video className="w-2.5 h-2.5" />}
                      {look.is_talking_photo ? "Foto" : "Avatar V"}
                    </div>
                  )}

                  {/* Selection checkmark */}
                  {!isLandscape && (
                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? "bg-primary text-primary-foreground" : "bg-black/30 text-white/60 border border-white/30"}`}>
                      {isSelected && <CheckCircle2 className="w-5 h-5" />}
                    </div>
                  )}

                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                    <p className="text-white text-xs font-medium truncate">{look.name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose} className="w-full">Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Sentinel value meaning "use HeyGen's own default voice for this avatar" */
const LOOK_DEFAULT_VOICE_SENTINEL = "avatar_default"

/** Per-look voice row shown in the voice assignment panel */
function LookVoiceRow({
  look,
  voiceOverride,
  voiceOptions,
  onChangeVoice,
}: {
  look: { id: string; name: string; image_url: string | null; group_name: string }
  voiceOverride: string | undefined
  voiceOptions: { voice_id: string; name: string; gender: string | null; preview_audio_url: string | null; is_cloned: boolean }[]
  onChangeVoice: (lookId: string, voiceId: string) => void
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // No override (or sentinel) → show as "HeyGen default" in the selector
  const selectValue = voiceOverride && voiceOverride !== LOOK_DEFAULT_VOICE_SENTINEL
    ? voiceOverride
    : LOOK_DEFAULT_VOICE_SENTINEL
  const selectedVoice = voiceOptions.find((v) => v.voice_id === selectValue)

  const togglePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isPlaying) {
      audioRef.current?.pause()
      audioRef.current = null
      setIsPlaying(false)
      return
    }
    if (!selectedVoice?.preview_audio_url) return
    const audio = new Audio(selectedVoice.preview_audio_url)
    audioRef.current = audio
    audio.onended = () => setIsPlaying(false)
    audio.onerror = () => setIsPlaying(false)
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
  }

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-muted/40 border border-border/50">
      {/* Look thumbnail */}
      <div className="w-10 h-10 rounded-md overflow-hidden bg-muted shrink-0">
        {look.image_url ? (
          <img src={look.image_url} alt={look.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Look info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{look.name}</p>
        <p className="text-xs text-muted-foreground truncate">{look.group_name}</p>
      </div>

      {/* Voice selector */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setIsPlaying(false) }
            onChangeVoice(look.id, v)
          }}
        >
          <SelectTrigger className="h-8 text-xs w-[180px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value={LOOK_DEFAULT_VOICE_SENTINEL}>
              <span className="text-xs font-medium text-primary">Predeterminada de HeyGen</span>
            </SelectItem>
            {voiceOptions.map((v) => (
              <SelectItem key={v.voice_id} value={v.voice_id}>
                {v.name}{v.gender ? ` · ${v.gender === "male" ? "masc." : v.gender === "female" ? "fem." : v.gender}` : ""}
                {v.is_cloned ? " · clonada" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={!selectedVoice?.preview_audio_url}
          onClick={togglePreview}
          title={selectedVoice?.preview_audio_url ? "Escuchar muestra" : "Sin muestra de audio"}
        >
          {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  )
}

export default function Avatars() {
  const { data: groups, isLoading: isLoadingGroups } = useGetHeyGenAvatarGroups()
  const { data: config, isLoading: isLoadingConfig } = useGetAvatarConfig()
  const updateConfig = useUpdateAvatarConfig()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [strategy, setStrategy] = useState<AvatarConfigRotationStrategy>(AvatarConfigRotationStrategy.sequential)
  const [openGroup, setOpenGroup] = useState<HeyGenAvatarGroup | null>(null)
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(loadHidden)
  const [onlyInUse, setOnlyInUse] = useState(false)
  /** Per-look voice overrides: lookId → voiceId. Empty string means "use HeyGen default". */
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({})

  const { data: allLooks } = useGetHeyGenAllLooks()
  const { data: voices } = useGetHeyGenVoices()

  const hideGroup = (id: string) => {
    const next = new Set(hiddenGroups).add(id)
    setHiddenGroups(next)
    saveHidden(next)
  }
  const unhideAll = () => { setHiddenGroups(new Set()); saveHidden(new Set()) }

  // Number of selected looks per avatar group
  const selectedByGroup = new Map<string, number>()
  for (const l of allLooks ?? []) {
    if (selectedIds.has(l.id)) {
      selectedByGroup.set(l.group_id, (selectedByGroup.get(l.group_id) ?? 0) + 1)
    }
  }

  // Filtered voice options: Spanish/cloned voices only, with gender normalised to string | null
  const spanishVoices = (voices ?? [])
    .filter((v) => {
      const lang = (v.language ?? "").toLowerCase()
      return lang.includes("spanish") || lang.startsWith("es") || v.is_cloned
    })
    .map((v) => ({ ...v, gender: v.gender ?? null, preview_audio_url: v.preview_audio_url ?? null }))

  useEffect(() => {
    if (config) {
      setSelectedIds(new Set(config.selected_avatar_ids))
      setStrategy(config.rotation_strategy)
      setVoiceOverrides((config.voice_overrides as Record<string, string>) ?? {})
    }
  }, [config])

  const toggleLook = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const handleVoiceChange = (lookId: string, voiceId: string) => {
    setVoiceOverrides((prev) => {
      const next = { ...prev }
      if (voiceId === LOOK_DEFAULT_VOICE_SENTINEL) {
        delete next[lookId] // sentinel → remove override, use HeyGen default
      } else {
        next[lookId] = voiceId
      }
      return next
    })
  }

  const handleSave = () => {
    if (selectedIds.size === 0) {
      toast({ title: "Atención", description: "Debes seleccionar al menos un look.", variant: "destructive" })
      return
    }

    // Only persist overrides for selected looks with a real voice ID (not sentinel)
    const cleanedOverrides: Record<string, string> = {}
    for (const [lookId, voiceId] of Object.entries(voiceOverrides)) {
      if (selectedIds.has(lookId) && voiceId && voiceId !== LOOK_DEFAULT_VOICE_SENTINEL) {
        cleanedOverrides[lookId] = voiceId
      }
    }

    updateConfig.mutate({
      data: {
        selected_avatar_ids: Array.from(selectedIds),
        rotation_strategy: strategy,
        preferred_voice_id: null,
        voice_overrides: cleanedOverrides,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Guardado", description: "Configuración de avatares actualizada." })
        queryClient.invalidateQueries({ queryKey: getGetAvatarConfigQueryKey() })
      }
    })
  }

  if (isLoadingGroups || isLoadingConfig) {
    return <div className="p-8"><Skeleton className="h-96 w-full rounded-xl" /></div>
  }

  // Selected looks with their info (for voice assignment panel)
  const selectedLooks = (allLooks ?? []).filter((l) => selectedIds.has(l.id))

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Avatares HeyGen</h1>
          <p className="text-muted-foreground mt-1 text-lg">Hacé clic en un avatar para elegir sus looks. Los looks seleccionados rotan en tus videos.</p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => window.open("https://app.heygen.com/avatars", "_blank")}
        >
          <Plus className="w-4 h-4" />
          Crear avatar
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
        <Button onClick={handleSave} disabled={updateConfig.isPending} className="gap-2 px-8 shadow-lg shadow-primary/20">
          <Save className="w-4 h-4" />
          Guardar Selección ({selectedIds.size})
        </Button>
      </div>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold font-display">Estrategia de Rotación</h3>
              <p className="text-muted-foreground text-sm max-w-xl mt-1">
                ContentPilot puede rotar entre los looks seleccionados automáticamente para darle variedad a tu feed.
              </p>
            </div>
            <div className="w-full sm:w-64 shrink-0">
              <Label className="mb-2 block">Método de rotación</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as AvatarConfigRotationStrategy)}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AvatarConfigRotationStrategy.sequential}>Secuencial (1, 2, 3, 1...)</SelectItem>
                  <SelectItem value={AvatarConfigRotationStrategy.random}>Aleatorio</SelectItem>
                  <SelectItem value={AvatarConfigRotationStrategy.performance}>Por Rendimiento (IA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-look voice assignment panel — only shown when looks are selected */}
      {selectedLooks.length > 0 && (
        <Card className="border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center shrink-0">
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display">Voz por look</h3>
                <p className="text-muted-foreground text-sm">
                  Cada look usa la voz predeterminada de HeyGen para ese avatar. Podés sobrescribirla individualmente.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {selectedLooks.map((look) => (
                <LookVoiceRow
                  key={look.id}
                  look={look}
                  voiceOverride={voiceOverrides[look.id]}
                  voiceOptions={spanishVoices}
                  onChangeVoice={handleVoiceChange}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warning: talking photos in selection */}
      {(() => {
        const tpCount = selectedLooks.filter(l => l.is_talking_photo).length
        const avCount = selectedLooks.filter(l => !l.is_talking_photo).length
        if (tpCount === 0 || selectedLooks.length === 0) return null
        return (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-orange-500/30 bg-orange-500/5">
            <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-orange-600 dark:text-orange-400 text-sm">
                {tpCount} look{tpCount !== 1 ? "s" : ""} de tipo "Foto" en tu rotación
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Los looks tipo <strong>Foto</strong> usan lipsync de IA sobre una imagen estática — el resultado puede verse poco natural.
                Los looks <strong>Avatar V</strong> ({avCount} seleccionado{avCount !== 1 ? "s" : ""}) usan el avatar de video real y tienen el mejor lipsync.
                Si el lipsync no te convence, desseleccioná los looks tipo Foto y usá solo los Avatar V (los de tu grupo "Yasser Lezcano").
              </p>
            </div>
          </div>
        )
      })()}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant={onlyInUse ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => setOnlyInUse(!onlyInUse)}
        >
          {onlyInUse ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {onlyInUse ? "Mostrando solo en uso" : "Solo los que uso"}
        </Button>
        {hiddenGroups.size > 0 && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={unhideAll}>
            <Eye className="w-3.5 h-3.5" />
            Mostrar {hiddenGroups.size} oculto{hiddenGroups.size !== 1 ? "s" : ""}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {groups
          ?.filter((g) => {
            if (hiddenGroups.has(g.id)) return false
            if (onlyInUse && (selectedByGroup.get(g.id) ?? 0) === 0) return false
            return true
          })
          .map((group) => (
          <Card
            key={group.id}
            className="overflow-hidden cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-lg group/card"
            onClick={() => setOpenGroup(group)}
          >
            <div className="aspect-square bg-muted relative">
              {group.preview_image_url ? (
                <img src={group.preview_image_url} alt={group.name} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon className="w-10 h-10" /></div>
              )}
              {(selectedByGroup.get(group.id) ?? 0) > 0 && (
                <Badge className="absolute top-2 left-2 gap-1 bg-primary text-primary-foreground shadow">
                  <CheckCircle2 className="w-3 h-3" />
                  {selectedByGroup.get(group.id)} seleccionado{selectedByGroup.get(group.id)! !== 1 ? "s" : ""}
                </Badge>
              )}
              {/* Hide button */}
              <button
                type="button"
                title="Ocultar este avatar"
                onClick={(e) => { e.stopPropagation(); hideGroup(group.id) }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-black/70"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <CardContent className="p-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-bold font-display truncate">{group.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {group.num_looks} look{group.num_looks !== 1 ? "s" : ""}
                  {(selectedByGroup.get(group.id) ?? 0) > 0 && (
                    <span className="text-primary font-medium"> · {selectedByGroup.get(group.id)} en rotación</span>
                  )}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">Ver looks</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {openGroup && (
        <LooksDialog
          group={openGroup}
          selectedIds={selectedIds}
          onToggle={toggleLook}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  )
}
