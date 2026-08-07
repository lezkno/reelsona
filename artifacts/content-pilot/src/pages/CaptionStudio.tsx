import { useState, useEffect } from "react"
import { useGetCaptionPresets, useGetCaptionConfig, useUpdateCaptionConfig, useGetAutomation, useUpdateAutomation } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { CheckCircle2, Wand2, AlertCircle, Info, Sparkles } from "lucide-react"
import type { CaptionConfig, CaptionPreset } from "@workspace/api-client-react"

const POSITION_LABELS: Record<string, string> = { top: "Arriba", center: "Centro", bottom: "Abajo" }
const HIGHLIGHT_LABELS: Record<string, string> = { color: "Solo color", scale: "Solo escala", both: "Color + escala" }
const FONT_OPTIONS = ["Montserrat", "Inter", "Georgia", "Arial", "Roboto", "Oswald", "Bebas Neue"]

function PresetCard({ preset, selected, onClick }: { preset: CaptionPreset; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-xl overflow-hidden border-2 transition-all text-left ${selected ? "border-primary ring-2 ring-primary/30 shadow-lg" : "border-border hover:border-primary/40"}`}
    >
      {/* Visual preview */}
      <div
        className="aspect-[9/16] flex flex-col items-center justify-end pb-8 px-3"
        style={{ background: "linear-gradient(to bottom, #1a1a2e, #16213e, #0f3460)" }}
      >
        {/* Simulated video content */}
        <div className="w-full space-y-1">
          <div className="flex flex-wrap justify-center gap-1">
            {["Esto", "es", "lo", "que"].map((word, i) => (
              <span
                key={word}
                className="inline-block text-sm font-black transition-all"
                style={{
                  fontFamily: preset.font_family,
                  color: i === 2 ? preset.active_word_color : preset.primary_color,
                  WebkitTextStroke: `1px ${preset.outline_color}`,
                  textShadow: preset.outline_color !== "#000000" ? `0 0 8px ${preset.active_word_color}40` : "none",
                  transform: i === 2 && preset.highlight_mode !== "color" ? `scale(${preset.active_word_scale})` : "scale(1)",
                  background: preset.background_color ? preset.background_color : "none",
                  padding: preset.background_color ? "1px 4px" : "0",
                  borderRadius: preset.background_color ? "3px" : "0",
                }}
              >
                {word}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            {["quería", "saber"].map((word) => (
              <span
                key={word}
                className="inline-block text-sm font-black"
                style={{
                  fontFamily: preset.font_family,
                  color: preset.primary_color,
                  WebkitTextStroke: `1px ${preset.outline_color}`,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      )}
      <div className="p-3 border-t bg-card">
        <p className="font-bold text-sm">{preset.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{preset.description}</p>
        <div className="flex gap-1 mt-2 flex-wrap">
          {preset.auto_movement && <Badge variant="secondary" className="text-[10px] py-0">movimiento</Badge>}
          {preset.subtle_rotation && <Badge variant="secondary" className="text-[10px] py-0">rotación</Badge>}
          <Badge variant="outline" className="text-[10px] py-0">{HIGHLIGHT_LABELS[preset.highlight_mode]}</Badge>
        </div>
      </div>
    </button>
  )
}

function CaptionPreview({ config }: { config: Partial<CaptionConfig> }) {
  const words = ["esto", "es", "tu", "caption", "dinámico", "en", "acción"]
  const [active, setActive] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % words.length), 700)
    return () => clearInterval(t)
  }, [])

  const positionClass = {
    top: "items-start pt-6",
    center: "items-center",
    bottom: "items-end pb-6",
  }[config.position ?? "bottom"]

  return (
    <div
      className={`w-full aspect-[9/16] max-h-64 rounded-xl flex flex-col ${positionClass} px-4`}
      style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)" }}
    >
      <div className="flex flex-wrap justify-center gap-1">
        {words.map((word, i) => {
          const isActive = i === active
          const chunkStart = Math.floor(active / (config.words_per_line ?? 3)) * (config.words_per_line ?? 3)
          const inChunk = i >= chunkStart && i < chunkStart + (config.words_per_line ?? 3)
          if (!inChunk) return null
          return (
            <span
              key={i}
              className="inline-block font-black transition-all duration-150"
              style={{
                fontFamily: config.font_family ?? "Montserrat",
                fontSize: `${Math.round((config.font_size ?? 72) * 0.4)}%`,
                color: isActive ? (config.active_word_color ?? "#FFE600") : (config.primary_color ?? "#FFFFFF"),
                WebkitTextStroke: `1px ${config.outline_color ?? "#000000"}`,
                transform: isActive && config.highlight_mode !== "color" ? `scale(${config.active_word_scale ?? 1.2})` : "scale(1)",
                background: config.background_color ? config.background_color : "transparent",
                padding: config.background_color ? "0 4px" : "0",
                borderRadius: "3px",
                fontSize2: "clamp(14px, 3vw, 22px)",
              } as any}
            >
              {word}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function CaptionStudio() {
  const { toast } = useToast()
  const { data: presets } = useGetCaptionPresets()
  const { data: config, isLoading } = useGetCaptionConfig()
  const { data: automation } = useGetAutomation()
  const updateConfig = useUpdateCaptionConfig()
  const updateAutomation = useUpdateAutomation()

  const [local, setLocal] = useState<Partial<CaptionConfig>>({})
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (config && Object.keys(local).length === 0) setLocal(config)
  }, [config])

  useEffect(() => {
    if (automation) setCaptionsEnabled(automation.captions_enabled ?? false)
  }, [automation])

  const set = <K extends keyof CaptionConfig>(key: K, value: CaptionConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const applyPreset = (preset: CaptionPreset) => {
    const update: Partial<CaptionConfig> = {
      preset_id: preset.id,
      primary_color: preset.primary_color,
      active_word_color: preset.active_word_color,
      outline_color: preset.outline_color,
      background_color: preset.background_color,
      font_family: preset.font_family,
      font_size: preset.font_size,
      active_word_scale: preset.active_word_scale,
      highlight_mode: preset.highlight_mode,
      auto_movement: preset.auto_movement,
      subtle_rotation: preset.subtle_rotation,
    }
    setLocal((prev) => ({ ...prev, ...update }))
    setDirty(true)
  }

  const handleSave = () => {
    updateConfig.mutate({ data: local as any }, {
      onSuccess: () => {
        setDirty(false)
        toast({ title: "Caption Studio guardado", description: "La configuración de captions está lista." })
      },
      onError: () => toast({ title: "Error", description: "No se pudo guardar.", variant: "destructive" }),
    })
  }

  const handleToggle = (enabled: boolean) => {
    setCaptionsEnabled(enabled)
    updateAutomation.mutate({ data: { captions_enabled: enabled } }, {
      onSuccess: () => toast({
        title: enabled ? "Captions activados" : "Captions desactivados",
        description: enabled
          ? "Los próximos videos procesarán captions antes de publicar."
          : "Los videos se publicarán con el video original de HeyGen.",
      }),
      onError: () => {
        setCaptionsEnabled(!enabled)
        toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
      },
    })
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Cargando Caption Studio…</div>
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-primary" />
            Caption Studio
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Captions dinámicos tipo motion typography — palabra activa resaltada, auto scale y más.
          </p>
        </div>
        <Button onClick={handleSave} disabled={!dirty || updateConfig.isPending} className="gap-2 px-8 shadow-lg shadow-primary/20">
          <Wand2 className="w-4 h-4" />
          {updateConfig.isPending ? "Guardando…" : "Guardar Estilo"}
        </Button>
      </div>

      {/* Enable / status banner */}
      <Card className={`border-2 ${captionsEnabled ? "border-primary/40 bg-primary/5" : "border-dashed"}`}>
        <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${captionsEnabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-base">{captionsEnabled ? "Captions activados" : "Captions desactivados"}</p>
              <p className="text-sm text-muted-foreground max-w-md">
                {captionsEnabled
                  ? "Los próximos videos recibirán captions dinámicos antes de publicarse. Si el procesamiento falla, se usa el video original de HeyGen."
                  : "Los videos se publican directamente desde HeyGen sin capa de captions."}
              </p>
            </div>
          </div>
          <Switch checked={captionsEnabled} onCheckedChange={handleToggle} className="shrink-0" />
        </CardContent>
      </Card>

      {/* v1 notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Caption Engine v1 — Motor de render pendiente</p>
            <p className="text-muted-foreground mt-0.5">
              El flujo, contratos y estados ya están implementados. Podés configurar tu estilo ahora — cuando se conecte un motor de render (FFmpeg, Remotion, Shotstack, etc.) los captions se aplicarán automáticamente sin cambios adicionales.
              Mientras tanto, si activás captions y el render no está conectado, el sistema usa el video original de HeyGen sin interrumpir la publicación.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: preset selector */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Estilos prediseñados</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {(presets ?? []).map((preset) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  selected={local.preset_id === preset.id}
                  onClick={() => applyPreset(preset)}
                />
              ))}
            </div>
          </div>

          {/* Advanced config */}
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Configuración avanzada</h2>
            <Card>
              <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">

                {/* Position */}
                <div className="space-y-2">
                  <Label>Posición en pantalla</Label>
                  <Select value={local.position ?? "bottom"} onValueChange={(v) => set("position", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(POSITION_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Words per line */}
                <div className="space-y-2">
                  <Label>Palabras por línea: <span className="text-primary font-bold">{local.words_per_line ?? 3}</span></Label>
                  <Slider
                    min={1} max={8} step={1}
                    value={[local.words_per_line ?? 3]}
                    onValueChange={([v]) => set("words_per_line", v)}
                    className="mt-3"
                  />
                </div>

                {/* Highlight mode */}
                <div className="space-y-2">
                  <Label>Efecto palabra activa</Label>
                  <Select value={local.highlight_mode ?? "both"} onValueChange={(v) => set("highlight_mode", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(HIGHLIGHT_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Active word scale */}
                <div className="space-y-2">
                  <Label>Escala palabra activa: <span className="text-primary font-bold">{(local.active_word_scale ?? 1.2).toFixed(2)}×</span></Label>
                  <Slider
                    min={1.0} max={2.0} step={0.05}
                    value={[local.active_word_scale ?? 1.2]}
                    onValueChange={([v]) => set("active_word_scale", v)}
                    className="mt-3"
                  />
                </div>

                {/* Font family */}
                <div className="space-y-2">
                  <Label>Fuente</Label>
                  <Select value={local.font_family ?? "Montserrat"} onValueChange={(v) => set("font_family", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map((f) => (
                        <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Font size */}
                <div className="space-y-2">
                  <Label>Tamaño de fuente: <span className="text-primary font-bold">{local.font_size ?? 72}px</span></Label>
                  <Slider
                    min={24} max={120} step={2}
                    value={[local.font_size ?? 72]}
                    onValueChange={([v]) => set("font_size", v)}
                    className="mt-3"
                  />
                </div>

                {/* Colors */}
                <div className="space-y-2">
                  <Label>Color del texto</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={local.primary_color ?? "#FFFFFF"}
                      onChange={(e) => set("primary_color", e.target.value)}
                      className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5"
                    />
                    <span className="text-sm text-muted-foreground font-mono">{local.primary_color ?? "#FFFFFF"}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Color de palabra activa</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={local.active_word_color ?? "#FFE600"}
                      onChange={(e) => set("active_word_color", e.target.value)}
                      className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5"
                    />
                    <span className="text-sm text-muted-foreground font-mono">{local.active_word_color ?? "#FFE600"}</span>
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto movement</p>
                    <p className="text-xs text-muted-foreground">Ligero movimiento de líneas al cambiar</p>
                  </div>
                  <Switch checked={local.auto_movement ?? false} onCheckedChange={(v) => set("auto_movement", v)} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Rotación sutil</p>
                    <p className="text-xs text-muted-foreground">Pequeña rotación aleatoria en palabras</p>
                  </div>
                  <Switch checked={local.subtle_rotation ?? false} onCheckedChange={(v) => set("subtle_rotation", v)} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto scale</p>
                    <p className="text-xs text-muted-foreground">Ajusta tamaño según duración del video</p>
                  </div>
                  <Switch checked={local.auto_scale ?? true} onCheckedChange={(v) => set("auto_scale", v)} />
                </div>

              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right: preview + status */}
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Vista previa</h2>
            <CaptionPreview config={local} />
            <p className="text-xs text-muted-foreground mt-2 text-center">
              La palabra activa cambia cada 700ms para simular el efecto
            </p>
          </div>

          {/* Flow diagram */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-bold font-display">Flujo del pipeline</p>
              {[
                { label: "HeyGen termina", status: "done", note: "video_url guardado" },
                { label: "Caption Engine", status: captionsEnabled ? "active" : "skip", note: captionsEnabled ? "procesa captions" : "desactivado" },
                { label: "captioned_video_url", status: captionsEnabled ? "active" : "skip", note: captionsEnabled ? "si render exitoso" : "—" },
                { label: "Fallback", status: "info", note: "usa video original si falla" },
                { label: "Publica en Instagram", status: "done", note: "con la mejor URL disponible" },
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className={`shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
                    step.status === "done" ? "bg-emerald-500" :
                    step.status === "active" ? "bg-primary" :
                    step.status === "info" ? "bg-amber-500" :
                    "bg-muted"
                  }`}>
                    {(step.status === "done" || step.status === "active") && <CheckCircle2 className="w-3 h-3 text-white" />}
                    {step.status === "info" && <AlertCircle className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <p className="text-xs font-semibold">{step.label}</p>
                    <p className="text-[11px] text-muted-foreground">{step.note}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
