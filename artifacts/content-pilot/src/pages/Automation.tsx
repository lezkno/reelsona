import {
  useGetAutomation, useUpdateAutomation, getGetAutomationQueryKey, type AutomationConfigInput,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useEffect, useState } from "react"
import { Zap, Clock, CalendarDays, Plus, X, Lock, ExternalLink, Sparkles, CheckCircle2, Circle, Globe, PauseCircle, Eye } from "lucide-react"

type RecommendedSlot = { time: string; label: string; reason: string }
type RecommendedTimesResponse = {
  recommended: RecommendedSlot[]
  niche: string | null
  niche_matched: string | null
  account_username: string | null
  source: "niche" | "default"
}

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
  const [browserTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

  // Auto-sync timezone on first load if it differs from the stored value
  useEffect(() => {
    if (config && formData && formData.timezone !== browserTz) {
      saveChange({ timezone: browserTz })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.timezone])

  const addTime = () => {
    if (!formData?.posting_times || !newTime) return
    if (!formData.posting_times.includes(newTime)) {
      saveChange({ posting_times: [...formData.posting_times, newTime].sort() })
    }
  }

  const toggleRecommended = (time: string) => {
    if (!formData?.posting_times) return
    const has = formData.posting_times.includes(time)
    const next = has
      ? formData.posting_times.filter((t: string) => t !== time)
      : [...formData.posting_times, time].sort()
    saveChange({ posting_times: next })
  }

  const setDailyCount = (n: number) => {
    if (!formData || !recommended) return
    // Set EXACTLY the top-n recommended times — replaces the current schedule.
    // Custom times are not carried over so the button count always matches the result.
    const topN = recommended.recommended.slice(0, n).map((s) => s.time)
    saveChange({ posting_times: topN })
  }

  const { data: recommended } = useQuery<RecommendedTimesResponse>({
    queryKey: ["automation-recommended-times"],
    queryFn: () => fetch(`${import.meta.env.BASE_URL}api/automation/recommended-times`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading || !formData) {
    return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  }

  const mode = !formData.enabled ? "paused" : !formData.auto_publish ? "manual" : "auto"
  const MODE_CONFIG = {
    paused: {
      iconBg: "bg-muted-foreground/20 text-muted-foreground",
      title: "Sistema Pausado",
      desc: "Nada corre. No se genera ni publica nada hasta que cambies el modo.",
      cardBorder: "border-border",
      cardBg: "bg-muted/30",
    },
    manual: {
      iconBg: "bg-amber-500/20 text-amber-600",
      title: "Modo Manual",
      desc: "ContentPilot genera guiones y videos automáticamente, pero tú aprobás y publicás cada reel.",
      cardBorder: "border-amber-500/40 shadow-xl shadow-amber-500/10",
      cardBg: "bg-amber-500/5",
    },
    auto: {
      iconBg: "bg-primary text-primary-foreground shadow-[0_0_30px_rgba(100,50,255,0.4)]",
      title: "Automatización Completa",
      desc: "ContentPilot genera guiones, crea videos y publica reels en los horarios configurados.",
      cardBorder: "border-primary shadow-xl shadow-primary/10",
      cardBg: "bg-primary/5",
    },
  } as const
  const mc = MODE_CONFIG[mode]

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

      {/* ── Mode selector card ────────────────────────────────────────────────── */}
      <Card className={`overflow-hidden border-2 transition-all duration-500 ${isLocked ? 'border-amber-500/30 opacity-60' : mc.cardBorder}`}>
        <div className={`p-5 md:p-8 flex flex-col gap-6 ${isLocked ? 'bg-muted/30' : mc.cardBg}`}>
          {/* Status row */}
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center transition-colors duration-500 ${isLocked ? 'bg-amber-500/20 text-amber-600' : mc.iconBg}`}>
              {isLocked ? <Lock className="w-7 h-7" /> : mode === "paused" ? <PauseCircle className="w-7 h-7" /> : mode === "manual" ? <Eye className="w-7 h-7" /> : <Zap className="w-7 h-7" />}
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-display font-bold mb-0.5">
                {isLocked ? "Video procesándose…" : mc.title}
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                {isLocked ? "La configuración está bloqueada hasta que el video termine de procesarse." : mc.desc}
              </p>
            </div>
          </div>

          {/* Three-mode selector */}
          <div className="grid grid-cols-3 gap-3">
            <button
              disabled={isLocked}
              onClick={() => saveChange({ enabled: false })}
              className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-xl border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "paused"
                  ? "border-muted-foreground/40 bg-muted/60 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <PauseCircle className="w-5 h-5" />
              <div className="text-center">
                <p className="text-xs font-bold leading-tight">Pausado</p>
                <p className="text-[10px] mt-0.5 leading-tight opacity-70">Nada corre</p>
              </div>
            </button>

            <button
              disabled={isLocked}
              onClick={() => saveChange({ enabled: true, auto_generate_script: true, auto_generate_video: true, auto_publish: false })}
              className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-xl border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "manual"
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "border-border bg-background text-muted-foreground hover:bg-amber-500/5"
              }`}
            >
              <Eye className="w-5 h-5" />
              <div className="text-center">
                <p className="text-xs font-bold leading-tight">Manual</p>
                <p className="text-[10px] mt-0.5 leading-tight opacity-70">Genera, tú publicás</p>
              </div>
            </button>

            <button
              disabled={isLocked}
              onClick={() => saveChange({ enabled: true, auto_generate_script: true, auto_generate_video: true, auto_publish: true })}
              className={`flex flex-col items-center gap-2 p-3 md:p-4 rounded-xl border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "auto"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-primary/5"
              }`}
            >
              <Zap className="w-5 h-5" />
              <div className="text-center">
                <p className="text-xs font-bold leading-tight">Automático</p>
                <p className="text-[10px] mt-0.5 leading-tight opacity-70">Pipeline completo</p>
              </div>
            </button>
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
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" /> Horarios de Publicación</CardTitle>
                  <CardDescription className="mt-1">
                    {recommended?.niche
                      ? <>Sugerencias basadas en tu nicho: <span className="font-medium text-foreground capitalize">{recommended.niche}</span></>
                      : "Activá los horarios sugeridos o añadí los tuyos"}
                  </CardDescription>
                  {/* Timezone indicator */}
                  <div className="flex items-center gap-1.5 mt-2">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">{formData.timezone ?? browserTz}</span>
                    {formData.timezone !== browserTz && (
                      <button
                        onClick={() => saveChange({ timezone: browserTz })}
                        className="text-xs text-primary underline underline-offset-2 hover:no-underline ml-1"
                      >
                        Usar mi zona ({browserTz})
                      </button>
                    )}
                  </div>
                </div>
                {recommended?.account_username && (
                  <Badge variant="outline" className="shrink-0 text-[11px]">@{recommended.account_username}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Daily count quick-select */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">¿Cuántos videos por día?</p>
                  {(formData.posting_times?.length ?? 0) > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formData.posting_times?.length} horario{(formData.posting_times?.length ?? 0) !== 1 ? "s" : ""} activo{(formData.posting_times?.length ?? 0) !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {(() => {
                    const currentCount = formData.posting_times?.length ?? 0
                    // Always show 1-4; if current count exceeds 4, add it as an extra button
                    const presets = currentCount > 4 ? [1, 2, 3, 4, currentCount] : [1, 2, 3, 4]
                    return presets.map((n) => {
                      const active = currentCount === n
                      const isExtra = n > 4
                      return (
                        <button
                          key={n}
                          onClick={() => isExtra ? undefined : setDailyCount(n)}
                          className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-all ${
                            active
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : isExtra
                                ? "bg-background text-muted-foreground border-border cursor-default"
                                : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {n}
                        </button>
                      )
                    })
                  })()}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Los botones 1–4 aplican los mejores horarios para tu nicho. Para más, activá chips o añadí un horario personalizado.
                </p>
              </div>

              {/* Recommended time chips */}
              <div>
                <p className="text-sm font-medium mb-2.5">
                  Horarios recomendados
                  {recommended?.source === "niche" && (
                    <span className="ml-2 text-[11px] font-normal text-violet-500">✦ Para tu nicho</span>
                  )}
                </p>
                {!recommended ? (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 flex-1 rounded-xl" />)}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {recommended.recommended.map((slot) => {
                      const isActive = formData.posting_times?.includes(slot.time)
                      return (
                        <button
                          key={slot.time}
                          onClick={() => toggleRecommended(slot.time)}
                          className={`relative flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                            isActive
                              ? "bg-primary/8 border-primary/40 ring-1 ring-primary/20"
                              : "bg-muted/30 border-border hover:border-primary/30 hover:bg-muted/60"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className={`text-base font-bold tabular-nums ${isActive ? "text-primary" : "text-foreground"}`}>
                              {slot.time}
                            </span>
                            {isActive
                              ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                              : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                            }
                          </div>
                          <span className={`text-xs font-medium ${isActive ? "text-primary/80" : "text-foreground/70"}`}>{slot.label}</span>
                          <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{slot.reason}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Custom times not in recommended list */}
              {(() => {
                const recSet = new Set(recommended?.recommended.map((s) => s.time) ?? [])
                const custom = (formData.posting_times ?? []).filter((t: string) => !recSet.has(t))
                return custom.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Horarios personalizados</p>
                    <div className="flex flex-wrap gap-2">
                      {custom.map((time: string) => (
                        <div key={time} className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/50 border border-border rounded-full text-sm font-medium">
                          {time}
                          <button onClick={() => removeTime(time)} className="text-muted-foreground hover:text-foreground rounded-full p-0.5 transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null
              })()}

              {/* Add custom time */}
              <div className="flex gap-2 pt-1 border-t">
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="flex-1 h-9 rounded-md border bg-background px-3 text-sm"
                />
                <Button variant="outline" size="sm" onClick={addTime} className="border-dashed shrink-0">
                  <Plus className="w-4 h-4 mr-1" /> Personalizado
                </Button>
              </div>

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
              {!formData.auto_publish && formData.enabled && (
                <p className="text-xs text-amber-600 dark:text-amber-400 px-2 pb-1">
                  ⚠️ El video se preparará completo (guión → video → captions → copy) pero quedará en espera hasta que lo publiques manualmente o actives este paso.
                </p>
              )}

            </CardContent>
          </Card>


        </div>
      </div>
    </div>
  )
}
