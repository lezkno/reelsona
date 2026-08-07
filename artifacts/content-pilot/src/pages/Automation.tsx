import { useGetAutomation, useUpdateAutomation, getGetAutomationQueryKey, type AutomationConfigInput } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useEffect, useState } from "react"
import { Zap, Clock, CalendarDays, Plus, X } from "lucide-react"

const DAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
]

export default function Automation() {
  const { data: config, isLoading } = useGetAutomation()
  const updateConfig = useUpdateAutomation()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [formData, setFormData] = useState<AutomationConfigInput | null>(null)
  
  useEffect(() => {
    if (config && !formData) {
      setFormData(config)
    }
  }, [config, formData])

  const saveChange = (updates: Partial<AutomationConfigInput>) => {
    if (!formData) return
    const newData = { ...formData, ...updates }
    setFormData(newData)
    
    updateConfig.mutate({ data: newData }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAutomationQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se guardaron los cambios", variant: "destructive" })
        setFormData(formData) // revert
      }
    })
  }

  const toggleDay = (day: number) => {
    if (!formData?.days_of_week) return
    const current = new Set(formData.days_of_week)
    if (current.has(day)) current.delete(day)
    else current.add(day)
    saveChange({ days_of_week: Array.from(current) })
  }

  const removeTime = (time: string) => {
    if (!formData?.posting_times) return
    saveChange({ posting_times: formData.posting_times.filter((t: string) => t !== time) })
  }

  const [newTime, setNewTime] = useState("12:00")

  const addTime = () => {
    if (!formData?.posting_times || !newTime) return
    if (!formData.posting_times.includes(newTime)) {
      saveChange({ posting_times: [...formData.posting_times, newTime].sort() })
    }
  }

  if (isLoading || !formData) {
    return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight">Motor de Automatización</h1>
        <p className="text-muted-foreground mt-1 text-lg">Controla el flujo de trabajo de generación y publicación.</p>
      </div>

      <Card className={`overflow-hidden border-2 transition-colors duration-500 ${formData.enabled ? 'border-primary shadow-xl shadow-primary/10' : 'border-border'}`}>
        <div className={`p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 ${formData.enabled ? 'bg-primary/5' : 'bg-muted/30'}`}>
          <div className="flex items-center gap-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors duration-500 ${formData.enabled ? 'bg-primary text-primary-foreground shadow-[0_0_30px_rgba(100,50,255,0.4)]' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              <Zap className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-3xl font-display font-bold mb-2">
                {formData.enabled ? "Sistema Operativo" : "Sistema Pausado"}
              </h2>
              <p className="text-muted-foreground max-w-md">
                {formData.enabled 
                  ? "ContentPilot está generando guiones, creando videos y publicando reels automáticamente según el calendario." 
                  : "El sistema no ejecutará ninguna acción automática hasta que lo actives."}
              </p>
            </div>
          </div>
          <div className="shrink-0 scale-150 origin-right">
            <Switch 
              checked={formData.enabled} 
              onCheckedChange={(v) => saveChange({ enabled: v })} 
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </div>
        
        {config?.last_run_at && (
          <div className="bg-background border-t px-8 py-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Última ejecución: {new Date(config.last_run_at).toLocaleString()}</span>
            {config.last_run_status && (
              <span className={`font-medium ${config.last_run_status === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                {config.last_run_status}
              </span>
            )}
          </div>
        )}
      </Card>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity duration-500 ${!formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="w-5 h-5" /> Días de Publicación</CardTitle>
            <CardDescription>Qué días se publicará contenido nuevo</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {DAYS.map(day => (
                <div key={day.value} className="flex items-center space-x-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                  <Checkbox 
                    id={`day-${day.value}`} 
                    checked={formData.days_of_week?.includes(day.value)}
                    onCheckedChange={() => toggleDay(day.value)}
                  />
                  <Label htmlFor={`day-${day.value}`} className="cursor-pointer font-medium flex-1">{day.label}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" /> Horarios</CardTitle>
              <CardDescription>A qué horas se publicará en los días activos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 mb-4">
                {formData.posting_times?.map((time: string) => (
                  <div key={time} className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium">
                    {time}
                    <button onClick={() => removeTime(time)} className="text-primary/70 hover:text-primary rounded-full p-0.5 hover:bg-primary/20 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="flex-1 h-9 rounded-md border bg-background px-3 text-sm"
                />
                <Button variant="outline" size="sm" onClick={addTime} className="border-dashed">
                  <Plus className="w-4 h-4 mr-2" /> Añadir
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Cada horario es un video por día: añadí más horarios para publicar varios videos al día.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tubería de Contenido</CardTitle>
              <CardDescription>Qué etapas hace la IA sola</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <Label className="text-base">1. Generar Guiones</Label>
                  <p className="text-xs text-muted-foreground">Crea guiones automáticamente si te quedas sin ideas.</p>
                </div>
                <Switch checked={formData.auto_generate_script} onCheckedChange={(v) => saveChange({ auto_generate_script: v })} />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <Label className="text-base">2. Producir Video</Label>
                  <p className="text-xs text-muted-foreground">Envía guiones aprobados a HeyGen automáticamente.</p>
                </div>
                <Switch checked={formData.auto_generate_video} onCheckedChange={(v) => saveChange({ auto_generate_video: v })} />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg bg-secondary/5 border-secondary/20">
                <div>
                  <Label className="text-base text-secondary-foreground font-bold">3. Publicar en IG</Label>
                  <p className="text-xs text-muted-foreground">Publica los videos listos en el horario programado.</p>
                </div>
                <Switch checked={formData.auto_publish} onCheckedChange={(v) => saveChange({ auto_publish: v })} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
