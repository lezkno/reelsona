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
import { Zap, Clock, CalendarDays, Plus, X, Lock, ExternalLink, Sparkles } from "lucide-react"

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
  const { data: config, isLoading } = useGetAutomation({ query: { refetchInterval: 5000 } as any })
  const updateConfig = useUpdateAutomation()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [formData, setFormData] = useState<AutomationConfigInput | null>(null)
  const isLocked = !!(config as any)?.processing_locked

  useEffect(() => {
    if (config && !formData) {
      setFormData(config)
    }
  }, [config, formData])

  const saveChange = (updates: Partial<AutomationConfigInput>) => {
    if (!formData || isLocked) return
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

      {/* Processing lock banner */}
      {isLocked && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-amber-700 dark:text-amber-400">
          <Lock className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Configuración bloqueada — video procesándose</p>
            <p className="text-xs opacity-80 mt-0.5">
              Los controles se desbloquean automáticamente cuando el video termine de procesarse.
            </p>
          </div>
        </div>
      )}

      <Card className={`overflow-hidden border-2 transition-colors duration-500 ${isLocked ? 'border-amber-500/30 opacity-60' : formData.enabled ? 'border-primary shadow-xl shadow-primary/10' : 'border-border'}`}>
        <div className={`p-5 md:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 ${formData.enabled && !isLocked ? 'bg-primary/5' : 'bg-muted/30'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full flex items-center justify-center transition-colors duration-500 ${isLocked ? 'bg-amber-500/20 text-amber-600' : formData.enabled ? 'bg-primary text-primary-foreground shadow-[0_0_30px_rgba(100,50,255,0.4)]' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {isLocked ? <Lock className="w-7 h-7 md:w-8 md:h-8" /> : <Zap className="w-7 h-7 md:w-8 md:h-8" />}
            </div>
            <div>
              <h2 className="text-xl md:text-3xl font-display font-bold mb-1">
                {isLocked ? "Video procesándose…" : formData.enabled ? "Sistema Operativo" : "Sistema Pausado"}
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                {isLocked
                  ? "La configuración está bloqueada hasta que el video termine de procesarse."
                  : formData.enabled
                    ? "ContentPilot está generando guiones, creando videos y publicando reels automáticamente."
                    : "El sistema no ejecutará ninguna acción automática hasta que lo actives."}
              </p>
            </div>
          </div>
          <div className="shrink-0 self-center sm:self-auto">
            <Switch 
              checked={formData.enabled} 
              onCheckedChange={(v) => saveChange({ enabled: v })}
              disabled={isLocked}
              className="data-[state=checked]:bg-primary scale-125 disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </div>
        </div>
        
        {config?.last_run_at && (
          <div className="bg-background border-t px-5 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Última ejecución: {new Date(config.last_run_at).toLocaleString()}</span>
            {config.last_run_status && (
              <span className={`font-medium ${config.last_run_status === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                {config.last_run_status}
              </span>
            )}
          </div>
        )}
      </Card>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity duration-500 ${isLocked || !formData.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
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
              <CardDescription>Qué etapas hace la IA por vos, en orden</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">

              {/* Step 1 — Script */}
              <div className={`flex items-center justify-between p-3 border rounded-lg transition-opacity ${!formData.auto_generate_script ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">1</span>
                  <div className="min-w-0">
                    <Label className="text-base">Generar Guión</Label>
                    <p className="text-xs text-muted-foreground">Crea guiones automáticamente si no hay ideas pendientes.</p>
                  </div>
                </div>
                <Switch disabled={isLocked} checked={formData.auto_generate_script} onCheckedChange={(v) => saveChange({ auto_generate_script: v })} />
              </div>

              {/* Connector */}
              <div className="flex items-center gap-2 px-4">
                <div className="h-5 w-px bg-border ml-2" />
              </div>

              {/* Step 2 — Video */}
              <div className={`flex items-center justify-between p-3 border rounded-lg transition-opacity ${!formData.auto_generate_video ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">2</span>
                  <div className="min-w-0">
                    <Label className="text-base">Producir Video con HeyGen</Label>
                    <p className="text-xs text-muted-foreground">Envía el guión aprobado a HeyGen y espera el resultado.</p>
                  </div>
                </div>
                <Switch disabled={isLocked} checked={formData.auto_generate_video} onCheckedChange={(v) => saveChange({ auto_generate_video: v })} />
              </div>

              {/* Connector */}
              <div className="flex items-center gap-2 px-4">
                <div className="h-5 w-px bg-border ml-2" />
              </div>

              {/* Step 3 — Captions */}
              <div className={`flex items-center justify-between p-3 border rounded-lg transition-opacity ${!formData.captions_enabled ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">3</span>
                  <div className="min-w-0">
                    <Label className="text-base">Agregar Captions</Label>
                    <p className="text-xs text-muted-foreground">
                      Quema captions animados sobre el video.{" "}
                      <a href="/content-pilot/captions" className="text-primary underline underline-offset-2 inline-flex items-center gap-0.5 hover:opacity-80">
                        Configurar plantilla <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  </div>
                </div>
                <Switch disabled={isLocked} checked={formData.captions_enabled} onCheckedChange={(v) => saveChange({ captions_enabled: v })} />
              </div>

              {/* Connector */}
              <div className="flex items-center gap-2 px-4">
                <div className="h-5 w-px bg-border ml-2" />
              </div>

              {/* Step 4 — Copy (automatic, no toggle) */}
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">4</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-base">Generar Copy para Instagram</Label>
                      <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground">Redacta la descripción y hashtags del reel automáticamente.</p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 shrink-0">
                  Siempre activo
                </span>
              </div>

              {/* Connector */}
              <div className="flex items-center gap-2 px-4">
                <div className="h-5 w-px bg-border ml-2" />
              </div>

              {/* Step 5 — Publish */}
              <div className={`flex items-center justify-between p-3 border rounded-lg transition-opacity ${!formData.auto_publish ? "opacity-50" : "bg-primary/5 border-primary/20"}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">5</span>
                  <div className="min-w-0">
                    <Label className="text-base font-bold">Publicar en Instagram</Label>
                    <p className="text-xs text-muted-foreground">Sube el reel en el horario programado.</p>
                  </div>
                </div>
                <Switch disabled={isLocked} checked={formData.auto_publish} onCheckedChange={(v) => saveChange({ auto_publish: v })} />
              </div>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
