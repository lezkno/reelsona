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
import { useState, useEffect, useRef } from "react"
import { Users, Save, CheckCircle2, Image as ImageIcon, Play, Square, Eye, EyeOff, X, Plus, ExternalLink, Video, Camera, AlertTriangle, Mic } from "lucide-react"

const HIDDEN_KEY = "contentpilot_hidden_avatar_groups"
function loadHidden(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]")) } catch { return new Set() } }
function saveHidden(s: Set<string>) { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])) }

/** Sentinel value meaning "use HeyGen's own default voice for this look" */
const LOOK_DEFAULT_VOICE_SENTINEL = "avatar_default"

type VoiceOption = {
  voice_id: string
  name: string
  gender: string | null
  preview_audio_url: string | null
  is_cloned: boolean
}

/** Inline compact voice selector shown under a selected look card inside the dialog */
function LookVoiceInline({
  lookId,
  voiceOverride,
  voiceOptions,
  onChangeVoice,
}: {
  lookId: string
  voiceOverride: string | undefined
  voiceOptions: VoiceOption[]
  onChangeVoice: (lookId: string, voiceId: string) => void
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selectValue = voiceOverride && voiceOverride !== LOOK_DEFAULT_VOICE_SENTINEL
    ? voiceOverride
    : LOOK_DEFAULT_VOICE_SENTINEL
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

  return (
    <div
      className="flex items-center gap-1 mt-1.5 px-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setIsPlaying(false) }
          onChangeVoice(lookId, v)
        }}
      >
        <SelectTrigger className="h-7 text-[11px] flex-1 bg-background/80 border-border/60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-56">
          <SelectItem value={LOOK_DEFAULT_VOICE_SENTINEL}>
            <span className="text-[11px] font-medium text-primary">Predeterminada HeyGen</span>
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        disabled={!selectedVoice?.preview_audio_url}
        onClick={togglePreview}
        title={selectedVoice?.preview_audio_url ? "Escuchar muestra" : "Sin muestra"}
      >
        {isPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </Button>
    </div>
  )
}

function LooksDialog({
  group,
  selectedIds,
  voiceOverrides,
  voiceOptions,
  onToggle,
  onChangeVoice,
  onClose,
}: {
  group: HeyGenAvatarGroup
  selectedIds: Set<string>
  voiceOverrides: Record<string, string>
  voiceOptions: VoiceOption[]
  onToggle: (id: string) => void
  onChangeVoice: (lookId: string, voiceId: string) => void
  onClose: () => void
}) {
  const { data: looks, isLoading } = useGetHeyGenGroupLooks(group.id)
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
            Elegí los looks que querés usar. Cuando seleccionás un look podés asignarle su voz directamente.
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
                // Once detected as landscape, hide the card entirely — only vertical looks shown
                <div key={look.id} className={`flex flex-col ${isLandscape ? "hidden" : ""}`}>
                  <button
                    type="button"
                    onClick={() => onToggle(look.id)}
                    className={`relative rounded-lg overflow-hidden border-2 text-left transition-all
                      ${isSelected
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

                    {/* Avatar type badge */}
                    <div className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm ${look.is_talking_photo ? "bg-orange-500/90 text-white" : "bg-green-600/90 text-white"}`}>
                      {look.is_talking_photo ? <Camera className="w-2.5 h-2.5" /> : <Video className="w-2.5 h-2.5" />}
                      {look.is_talking_photo ? "Foto" : "Avatar V"}
                    </div>

                    {/* Selection checkmark */}
                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${isSelected ? "bg-primary text-primary-foreground" : "bg-black/30 text-white/60 border border-white/30"}`}>
                      {isSelected && <CheckCircle2 className="w-5 h-5" />}
                    </div>

                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                      <p className="text-white text-xs font-medium truncate">{look.name}</p>
                    </div>
                  </button>

                  {/* Voice selector — only shown when look is selected */}
                  {isSelected && (
                    <LookVoiceInline
                      lookId={look.id}
                      voiceOverride={voiceOverrides[look.id]}
                      voiceOptions={voiceOptions}
                      onChangeVoice={onChangeVoice}
                    />
                  )}
                </div>
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
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({})

  // Track whether we've initialized local state from the server config.
  // Without this, React Query background refetches (e.g. on window focus) would
  // overwrite any unsaved changes the user made in the dialog.
  const configInitialized = useRef(false)

  const { data: allLooks } = useGetHeyGenAllLooks()
  const { data: voices } = useGetHeyGenVoices()

  const hideGroup = (id: string) => {
    const next = new Set(hiddenGroups).add(id)
    setHiddenGroups(next)
    saveHidden(next)
  }
  const unhideAll = () => { setHiddenGroups(new Set()); saveHidden(new Set()) }

  const selectedByGroup = new Map<string, number>()
  const lookCountByGroup = new Map<string, number>()
  for (const l of allLooks ?? []) {
    lookCountByGroup.set(l.group_id, (lookCountByGroup.get(l.group_id) ?? 0) + 1)
    if (selectedIds.has(l.id)) {
      selectedByGroup.set(l.group_id, (selectedByGroup.get(l.group_id) ?? 0) + 1)
    }
  }

  // Spanish + cloned voices for the selectors
  const spanishVoices: VoiceOption[] = (voices ?? [])
    .filter((v) => {
      const lang = (v.language ?? "").toLowerCase()
      // Include Spanish voices, voices with unknown language (ElevenLabs imports
      // and other user-uploaded voices always come back as "unknown"), and any
      // voice explicitly marked as cloned.
      return lang.includes("spanish") || lang.startsWith("es") || lang === "unknown" || v.is_cloned
    })
    .map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      gender: v.gender ?? null,
      preview_audio_url: v.preview_audio_url ?? null,
      is_cloned: v.is_cloned ?? false,
    }))

  // Initialize local state once from the server — never on background refetches.
  // After a successful save we update state manually (see handleSave onSuccess).
  useEffect(() => {
    if (config && !configInitialized.current) {
      configInitialized.current = true
      setSelectedIds(new Set(config.selected_avatar_ids))
      setStrategy(config.rotation_strategy)
      setVoiceOverrides((config.voice_overrides as Record<string, string>) ?? {})
    }
  }, [config])

  // Once allLooks finishes loading, drop any selectedIds that don't exist in HeyGen
  // anymore (deleted looks, failed groups, etc.). This keeps all counts consistent.
  useEffect(() => {
    if (!allLooks || !configInitialized.current) return
    const knownIds = new Set(allLooks.map((l) => l.id))
    setSelectedIds((prev) => {
      const cleaned = new Set([...prev].filter((id) => knownIds.has(id)))
      if (cleaned.size === prev.size) return prev  // nothing changed — avoid re-render
      return cleaned
    })
  }, [allLooks])

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
        delete next[lookId]
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

    // Only persist overrides for currently selected looks
    const cleanedOverrides: Record<string, string> = {}
    for (const [lookId, voiceId] of Object.entries(voiceOverrides)) {
      if (selectedIds.has(lookId) && voiceId && voiceId !== LOOK_DEFAULT_VOICE_SENTINEL) {
        cleanedOverrides[lookId] = voiceId
      }
    }

    const savePayload = {
      selected_avatar_ids: Array.from(selectedIds),
      rotation_strategy: strategy,
      preferred_voice_id: null as string | null,
      voice_overrides: cleanedOverrides,
    }

    updateConfig.mutate({ data: savePayload }, {
      onSuccess: () => {
        toast({ title: "Guardado", description: "Configuración de avatares actualizada." })
        // Update local state directly from what we just saved so the UI stays
        // consistent without a round-trip refetch that could wipe pending changes.
        setSelectedIds(new Set(savePayload.selected_avatar_ids))
        setVoiceOverrides(savePayload.voice_overrides)
        setStrategy(savePayload.rotation_strategy as AvatarConfigRotationStrategy)
        // Invalidate so other parts of the app (e.g. scheduler) see fresh data.
        queryClient.invalidateQueries({ queryKey: getGetAvatarConfigQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo guardar la configuración.", variant: "destructive" })
      }
    })
  }

  if (isLoadingGroups || isLoadingConfig) {
    return <div className="p-8"><Skeleton className="h-96 w-full rounded-xl" /></div>
  }

  const selectedLooks = (allLooks ?? []).filter((l) => selectedIds.has(l.id))

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Avatares HeyGen</h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Hacé clic en un avatar para elegir sus looks y asignarles una voz.
          </p>
        </div>
        <div className="flex gap-2">
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
            Guardar ({selectedIds.size})
          </Button>
        </div>
      </div>

      {/* Rotation strategy */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold font-display">Estrategia de Rotación</h3>
              <p className="text-muted-foreground text-sm max-w-xl mt-1">
                ContentPilot rota entre los looks seleccionados automáticamente para darle variedad a tu feed.
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

      {/* Avatar group grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {groups
          ?.filter((g) => {
            if (hiddenGroups.has(g.id)) return false
            if (onlyInUse && (selectedByGroup.get(g.id) ?? 0) === 0) return false
            return true
          })
          .map((group) => {
            const count = selectedByGroup.get(group.id) ?? 0
            // Use actual look count from allLooks — group.num_looks from HeyGen can be stale/wrong
            const totalLooks = lookCountByGroup.get(group.id) ?? group.num_looks

            return (
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
                  {count > 0 && (
                    <Badge className="absolute top-2 left-2 gap-1 bg-primary text-primary-foreground shadow">
                      <CheckCircle2 className="w-3 h-3" />
                      {count} seleccionado{count !== 1 ? "s" : ""}
                    </Badge>
                  )}
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
                      {totalLooks} look{totalLooks !== 1 ? "s" : ""}
                      {count > 0 && <span className="text-primary font-medium"> · {count} en rotación</span>}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">Ver looks</Badge>
                </CardContent>
              </Card>
            )
          })}
      </div>

      {openGroup && (
        <LooksDialog
          group={openGroup}
          selectedIds={selectedIds}
          voiceOverrides={voiceOverrides}
          voiceOptions={spanishVoices}
          onToggle={toggleLook}
          onChangeVoice={handleVoiceChange}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  )
}
