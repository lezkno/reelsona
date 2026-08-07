import { useGetHeyGenAvatarGroups, useGetHeyGenGroupLooks, useGetHeyGenVoices, useGetAvatarConfig, useUpdateAvatarConfig, getGetAvatarConfigQueryKey, AvatarConfigRotationStrategy, type HeyGenAvatarGroup } from "@workspace/api-client-react"
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
import { Users, Save, CheckCircle2, Image as ImageIcon, Play, Square } from "lucide-react"
import { useRef } from "react"

function LooksDialog({ group, selectedIds, onToggle, onClose }: {
  group: HeyGenAvatarGroup
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onClose: () => void
}) {
  const { data: looks, isLoading } = useGetHeyGenGroupLooks(group.id)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group.name}</DialogTitle>
          <DialogDescription>
            Elegí los looks de este avatar que querés usar en tus videos. Los seleccionados entran en la rotación.
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
              return (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => onToggle(look.id)}
                  className={`relative rounded-lg overflow-hidden border-2 text-left transition-all ${isSelected ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/40"}`}
                >
                  <div className="aspect-[3/4] bg-muted">
                    {look.image_url ? (
                      <img src={look.image_url} alt={look.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon className="w-8 h-8" /></div>
                    )}
                  </div>
                  <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? "bg-primary text-primary-foreground" : "bg-black/30 text-white/60 border border-white/30"}`}>
                    {isSelected && <CheckCircle2 className="w-5 h-5" />}
                  </div>
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

export default function Avatars() {
  const { data: groups, isLoading: isLoadingGroups } = useGetHeyGenAvatarGroups()
  const { data: config, isLoading: isLoadingConfig } = useGetAvatarConfig()
  const updateConfig = useUpdateAvatarConfig()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [strategy, setStrategy] = useState<AvatarConfigRotationStrategy>(AvatarConfigRotationStrategy.sequential)
  const [openGroup, setOpenGroup] = useState<HeyGenAvatarGroup | null>(null)
  const [voiceId, setVoiceId] = useState<string>("")
  const { data: voices } = useGetHeyGenVoices()
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selectedVoice = (voices ?? []).find((v) => v.voice_id === voiceId)

  const togglePreview = () => {
    if (isPlaying) {
      audioRef.current?.pause()
      audioRef.current = null
      setIsPlaying(false)
      return
    }
    if (!selectedVoice?.preview_audio_url) {
      toast({ title: "Sin muestra", description: "Esta voz no tiene audio de muestra disponible.", variant: "destructive" })
      return
    }
    const audio = new Audio(selectedVoice.preview_audio_url)
    audioRef.current = audio
    audio.onended = () => setIsPlaying(false)
    audio.onerror = () => {
      setIsPlaying(false)
      toast({ title: "Error", description: "No se pudo reproducir la muestra de esta voz.", variant: "destructive" })
    }
    audio.play().then(() => setIsPlaying(true)).catch(() => {
      setIsPlaying(false)
      toast({ title: "Error", description: "No se pudo reproducir la muestra de esta voz.", variant: "destructive" })
    })
  }

  const spanishVoices = (voices ?? []).filter((v) => {
    const lang = (v.language ?? "").toLowerCase()
    return lang.includes("spanish") || lang.startsWith("es") || v.is_cloned
  })
  // Ensure the currently saved voice is listed even if it's not Spanish
  const voiceOptions = voiceId && !spanishVoices.some((v) => v.voice_id === voiceId)
    ? [...spanishVoices, ...(voices ?? []).filter((v) => v.voice_id === voiceId)]
    : spanishVoices

  useEffect(() => {
    if (config) {
      setSelectedIds(new Set(config.selected_avatar_ids))
      setStrategy(config.rotation_strategy)
      setVoiceId(config.preferred_voice_id ?? "")
    }
  }, [config])

  const toggleLook = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const handleSave = () => {
    if (selectedIds.size === 0) {
      toast({ title: "Atención", description: "Debes seleccionar al menos un look.", variant: "destructive" })
      return
    }

    updateConfig.mutate({
      data: {
        selected_avatar_ids: Array.from(selectedIds),
        rotation_strategy: strategy,
        preferred_voice_id: voiceId || null
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Avatares HeyGen</h1>
          <p className="text-muted-foreground mt-1 text-lg">Hacé clic en un avatar para elegir sus looks. Los looks seleccionados rotan en tus videos.</p>
        </div>
        <Button onClick={handleSave} disabled={updateConfig.isPending} className="gap-2 px-8 shadow-lg shadow-primary/20">
          <Save className="w-4 h-4" />
          Guardar Selección ({selectedIds.size})
        </Button>
      </div>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold font-display">Estrategia de Rotación</h3>
              <p className="text-muted-foreground text-sm max-w-xl mt-1">
                ContentPilot puede rotar entre los looks seleccionados automáticamente para darle variedad a tu feed.
              </p>
            </div>
            <div className="w-full sm:w-64 shrink-0 space-y-4">
              <div>
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
              <div>
                <Label className="mb-2 block">Voz de los videos</Label>
                <div className="flex gap-2">
                  <Select value={voiceId} onValueChange={(v) => { audioRef.current?.pause(); audioRef.current = null; setIsPlaying(false); setVoiceId(v) }}>
                    <SelectTrigger className="bg-background flex-1">
                      <SelectValue placeholder="Elegí una voz" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="avatar_default">Voz original del avatar (HeyGen)</SelectItem>
                      {voiceOptions.map((v) => (
                        <SelectItem key={v.voice_id} value={v.voice_id}>
                          {v.name}{v.gender ? ` · ${v.gender === "male" ? "masculina" : v.gender === "female" ? "femenina" : v.gender}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={!selectedVoice?.preview_audio_url}
                    onClick={togglePreview}
                    title={selectedVoice?.preview_audio_url ? "Escuchar muestra" : "Esta voz no tiene muestra disponible"}
                  >
                    {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Todos los videos se narran con esta voz.{selectedVoice && !selectedVoice.preview_audio_url ? " Esta voz no tiene audio de muestra." : ""}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {groups?.map((group) => (
          <Card
            key={group.id}
            className="overflow-hidden cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-lg"
            onClick={() => setOpenGroup(group)}
          >
            <div className="aspect-square bg-muted relative">
              {group.preview_image_url ? (
                <img src={group.preview_image_url} alt={group.name} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon className="w-10 h-10" /></div>
              )}
            </div>
            <CardContent className="p-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-bold font-display truncate">{group.name}</h4>
                <p className="text-xs text-muted-foreground">{group.num_looks} look{group.num_looks !== 1 ? "s" : ""}</p>
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
