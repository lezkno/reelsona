import { useGetHeyGenAvatars, useGetAvatarConfig, useUpdateAvatarConfig, getGetAvatarConfigQueryKey, AvatarConfigRotationStrategy } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useState, useEffect } from "react"
import { Users, Save, CheckCircle2 } from "lucide-react"

export default function Avatars() {
  const { data: avatars, isLoading: isLoadingAvatars } = useGetHeyGenAvatars()
  const { data: config, isLoading: isLoadingConfig } = useGetAvatarConfig()
  const updateConfig = useUpdateAvatarConfig()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [strategy, setStrategy] = useState<AvatarConfigRotationStrategy>(AvatarConfigRotationStrategy.sequential)

  useEffect(() => {
    if (config) {
      setSelectedIds(new Set(config.selected_avatar_ids))
      setStrategy(config.rotation_strategy)
    }
  }, [config])

  const toggleAvatar = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const handleSave = () => {
    if (selectedIds.size === 0) {
      toast({ title: "Atención", description: "Debes seleccionar al menos un avatar.", variant: "destructive" })
      return
    }

    updateConfig.mutate({
      data: {
        selected_avatar_ids: Array.from(selectedIds),
        rotation_strategy: strategy
      }
    }, {
      onSuccess: () => {
        toast({ title: "Guardado", description: "Configuración de avatares actualizada." })
        queryClient.invalidateQueries({ queryKey: getGetAvatarConfigQueryKey() })
      }
    })
  }

  if (isLoadingAvatars || isLoadingConfig) {
    return <div className="p-8"><Skeleton className="h-96 w-full rounded-xl" /></div>
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Avatares HeyGen</h1>
          <p className="text-muted-foreground mt-1 text-lg">Selecciona qué avatares representan tu marca en los videos.</p>
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
                ContentPilot puede rotar entre los avatares seleccionados automáticamente para darle variedad a tu feed.
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

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {avatars?.map((avatar) => {
          const isSelected = selectedIds.has(avatar.avatar_id)
          
          return (
            <Card 
              key={avatar.avatar_id} 
              className={`overflow-hidden cursor-pointer transition-all duration-300 ${isSelected ? 'ring-2 ring-primary shadow-lg shadow-primary/10 border-primary' : 'hover:border-primary/50'}`}
              onClick={() => toggleAvatar(avatar.avatar_id)}
            >
              <div className="aspect-square bg-muted relative">
                {avatar.preview_image_url ? (
                  <img src={avatar.preview_image_url} alt={avatar.avatar_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">Sin preview</div>
                )}
                
                <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-black/20 text-white/50 border border-white/20'}`}>
                  {isSelected && <CheckCircle2 className="w-5 h-5" />}
                </div>
              </div>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-bold font-display">{avatar.avatar_name}</h4>
                  <p className="text-xs text-muted-foreground capitalize">{avatar.gender || 'Unknown'}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
