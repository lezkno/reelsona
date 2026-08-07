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
import { CheckCircle2, Wand2, AlertCircle, Sparkles, Loader2 } from "lucide-react"
import type { CaptionConfig, CaptionPreset } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { getGetCaptionConfigQueryKey } from "@workspace/api-client-react"

// Load Oswald & Bangers from Google Fonts for preview rendering
const link = document.createElement("link")
link.rel = "stylesheet"
link.href = "https://fonts.googleapis.com/css2?family=Bangers&family=Oswald:wght@400;700&family=Poppins:wght@400;800&display=swap"
document.head.appendChild(link)

const POSITION_LABELS: Record<string, string> = { top: "Arriba", center: "Centro", bottom: "Abajo" }
const HIGHLIGHT_LABELS: Record<string, string> = {
  mixed: "Dimidium (tamaños mixtos, líneas apiladas)",
  color: "Highlight Line (3 palabras, activa en color)",
  scale: "Pop (1 palabra a la vez, grande)",
  both: "Pop + Color (1 palabra en color de acento)",
}
const FONT_OPTIONS = ["Poppins", "Oswald", "Bangers", "DejaVu Sans", "Montserrat", "Inter", "Arial"]

// ─── Preset Card ─────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  selected,
  saving,
  onClick,
}: {
  preset: CaptionPreset
  selected: boolean
  saving: boolean
  onClick: () => void
}) {
  const isMixedMode = preset.highlight_mode === "mixed"
  const isPopMode   = preset.highlight_mode === "scale" || preset.highlight_mode === "both"
  const useAccent   = preset.highlight_mode === "both" || preset.highlight_mode === "color"

  const outlineColor = preset.outline_color ?? "#000000"
  const outlineShadow = `
    -2px -2px 0 ${outlineColor},
     2px -2px 0 ${outlineColor},
    -2px  2px 0 ${outlineColor},
     2px  2px 0 ${outlineColor},
    -3px  0   0 ${outlineColor},
     3px  0   0 ${outlineColor},
     0   -3px 0 ${outlineColor},
     0    3px 0 ${outlineColor}
  `.trim()

  const wordStyle = (isActive: boolean, faded = false): React.CSSProperties => ({
    fontFamily: `'${preset.font_family}', 'DejaVu Sans', sans-serif`,
    fontWeight: 700,
    color: isActive && useAccent
      ? preset.active_word_color
      : faded
        ? `${preset.primary_color}88`
        : preset.primary_color,
    textShadow: outlineShadow,
    background: isActive && preset.background_color ? preset.background_color : "transparent",
    padding: preset.background_color ? "1px 6px" : "0",
    borderRadius: preset.background_color ? "4px" : "0",
    display: "inline-block",
    lineHeight: 1.15,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  })

  // Dimidium: function words small+white, content words large+yellow
  const FUNCTION_WORDS_PREVIEW = new Set(["they","the","and","or","to","a","in"])
  const dimLineStyle = (word: string, large: boolean): React.CSSProperties => ({
    fontFamily: `'${preset.font_family}', 'Poppins', sans-serif`,
    fontWeight: 800,
    fontSize: large ? "clamp(15px, 5.5cqw, 26px)" : "clamp(9px, 3.2cqw, 15px)",
    color: large ? preset.active_word_color : preset.primary_color,
    textShadow: outlineShadow,
    display: "inline-block",
    lineHeight: 1.2,
  })
  const dimLines = [
    ["They", "stop", "the", "scroll"],
    ["boost", "watch", "time"],
    ["viewers", "engaged"],
  ]

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-xl overflow-hidden border-2 transition-all text-left ${
        selected
          ? "border-primary ring-2 ring-primary/30 shadow-lg scale-[1.01]"
          : "border-border hover:border-primary/40 hover:scale-[1.005]"
      }`}
    >
      {/* Visual preview panel */}
      <div
        className="aspect-[9/16] flex flex-col items-center justify-end pb-5 px-3 select-none gap-y-1"
        style={{ background: "linear-gradient(to bottom, #1a1a2e 0%, #16213e 60%, #0f3460 100%)" }}
      >
        {isMixedMode ? (
          /* Dimidium mode: stacked lines with mixed sizes */
          <div className="flex flex-col items-center gap-y-0.5 w-full">
            {dimLines.map((words, li) => (
              <div key={li} className="flex items-baseline justify-center gap-x-1 flex-wrap">
                {words.map((w, wi) => {
                  const isFunc = FUNCTION_WORDS_PREVIEW.has(w.toLowerCase())
                  return (
                    <span key={wi} style={dimLineStyle(w, !isFunc)}>
                      {w}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        ) : isPopMode ? (
          /* Pop mode: one big word centered */
          <div className="flex items-center justify-center w-full">
            <span style={{ ...wordStyle(true), fontSize: "clamp(22px, 7cqw, 36px)" }}>
              APRENDE
            </span>
          </div>
        ) : (
          /* Highlight mode: 3 words, active one in accent */
          <div className="flex flex-wrap justify-center items-center gap-x-2 gap-y-1 w-full">
            {["QUIERES", "MÁS", "VENTAS"].map((word, i) => (
              <span key={word} style={{ ...wordStyle(i === 1, i === 0), fontSize: "clamp(14px, 4.5cqw, 24px)" }}>
                {word}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Selected / saving indicator */}
      {selected && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
          {saving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <CheckCircle2 className="w-4 h-4" />
          }
        </div>
      )}

      {/* Info panel */}
      <div className="p-3 border-t bg-card">
        <p className="font-bold text-sm leading-tight">{preset.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{preset.description}</p>
        <div className="flex gap-1 mt-2 flex-wrap">
          <Badge
            variant={isMixedMode ? "default" : isPopMode ? "default" : "secondary"}
            className="text-[9px] py-0 px-1.5"
          >
            {isMixedMode ? "◈ Dimidium" : isPopMode ? "⚡ Pop" : "✦ Highlight"}
          </Badge>
          <Badge variant="outline" className="text-[9px] py-0 px-1.5" style={{ fontFamily: preset.font_family }}>
            {preset.font_family}
          </Badge>
        </div>
      </div>
    </button>
  )
}

// ─── Live Preview ─────────────────────────────────────────────────────────────

// Dimidium function-word list for preview (same logic as engine)
const PREVIEW_FUNCTION_WORDS = new Set([
  "they","the","and","or","to","a","an","in","on","at","for","of","with","by",
  "is","are","was","were","it","this","that","my","your","our","so","not","no",
])

function CaptionPreview({ config }: { config: Partial<CaptionConfig> }) {
  const isMixedMode = config.highlight_mode === "mixed"
  const isPopMode   = config.highlight_mode === "scale" || config.highlight_mode === "both"
  const useAccent   = config.highlight_mode === "both" || config.highlight_mode === "color"
  const wordsPerLine = config.words_per_line ?? 3

  // Full sentence split into chunks of wordsPerLine
  const allWords = ["ESTO", "ES", "TU", "CAPTION", "DINÁMICO", "EN", "ACCIÓN", "HOY"]
  const [activeIdx, setActiveIdx] = useState(0)
  // For Dimidium: cycle through stacked-line groups
  const [dimLineIdx, setDimLineIdx] = useState(0)
  const dimLines = [
    ["They", "stop", "the", "scroll"],
    ["boost", "watch", "time"],
    ["viewers", "engaged"],
    ["and", "keep", "growing"],
  ]

  useEffect(() => {
    const t = setInterval(() => setActiveIdx((a) => (a + 1) % allWords.length), 700)
    return () => clearInterval(t)
  }, [allWords.length])

  useEffect(() => {
    if (!isMixedMode) return
    const t = setInterval(() => setDimLineIdx((i) => (i + 1) % dimLines.length), 1200)
    return () => clearInterval(t)
  }, [isMixedMode, dimLines.length])

  const outlineColor = config.outline_color ?? "#000000"
  const outlineShadow = `
    -2px -2px 0 ${outlineColor}, 2px -2px 0 ${outlineColor},
    -2px  2px 0 ${outlineColor}, 2px  2px 0 ${outlineColor},
    -3px  0   0 ${outlineColor}, 3px  0   0 ${outlineColor},
     0   -3px 0 ${outlineColor}, 0    3px 0 ${outlineColor}
  `
  const positionClass = { top: "justify-start pt-8", center: "justify-center", bottom: "justify-end pb-8" }[config.position ?? "bottom"]

  // Font size: scale down from video size for the preview container
  // The preview container is ~240px tall (aspect 9:16 on max-h-60), real video is 1920px
  // Scale factor ~0.14, but cap at something readable
  const previewFontSize = Math.round(Math.min((config.font_size ?? 88) * 0.22, 32))

  // ── Dimidium mode: stacked lines with mixed sizes ──────────────────────
  if (isMixedMode) {
    // Show last N lines stacked, newest at bottom. Cycle one new line at a time.
    const visibleCount = Math.min(dimLineIdx + 1, 4)
    const visibleLines = dimLines.slice(Math.max(0, dimLineIdx + 1 - 4), dimLineIdx + 1)
    const fontFam = `'${config.font_family ?? "Poppins"}', 'Poppins', sans-serif`
    const largePx  = Math.round(previewFontSize * 1.1)
    const smallPx  = Math.round(previewFontSize * 0.62)

    return (
      <div
        className={`w-full aspect-[9/16] max-h-72 rounded-xl flex flex-col items-end justify-end pb-5 px-4`}
        style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)" }}
      >
        <div className="flex flex-col items-center gap-y-0.5 w-full">
          {visibleLines.map((words, li) => (
            <div key={li} className="flex items-baseline justify-center flex-wrap gap-x-1">
              {words.map((w, wi) => {
                const isFunc = PREVIEW_FUNCTION_WORDS.has(w.toLowerCase())
                return (
                  <span
                    key={wi}
                    className="transition-all duration-300"
                    style={{
                      fontFamily: fontFam,
                      fontWeight: 800,
                      fontSize: `${isFunc ? smallPx : largePx}px`,
                      color: isFunc
                        ? (config.primary_color ?? "#FFFFFF")
                        : (config.active_word_color ?? "#FFE600"),
                      textShadow: outlineShadow,
                      lineHeight: 1.15,
                    }}
                  >
                    {w}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isPopMode) {
    // Show one word at a time, cycling through
    const word = allWords[activeIdx]
    return (
      <div
        className={`w-full aspect-[9/16] max-h-72 rounded-xl flex flex-col items-center ${positionClass} px-4`}
        style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)" }}
      >
        <div className="flex items-center justify-center">
          <span
            className="transition-all duration-100 font-black"
            style={{
              fontFamily: `'${config.font_family ?? "Oswald"}', sans-serif`,
              fontWeight: 700,
              fontSize: `${previewFontSize}px`,
              color: useAccent ? (config.active_word_color ?? "#FFE600") : (config.primary_color ?? "#FFFFFF"),
              textShadow: outlineShadow,
              background: config.background_color ?? "transparent",
              padding: config.background_color ? "2px 10px" : "0",
              borderRadius: config.background_color ? "6px" : "0",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              lineHeight: 1.2,
            }}
          >
            {word}
          </span>
        </div>
      </div>
    )
  }

  // Highlight line mode: show wordsPerLine words, cycle active word
  const chunkStart = Math.floor(activeIdx / wordsPerLine) * wordsPerLine
  const chunk = allWords.slice(chunkStart, chunkStart + wordsPerLine)
  const activeInChunk = activeIdx - chunkStart

  return (
    <div
      className={`w-full aspect-[9/16] max-h-72 rounded-xl flex flex-col items-center ${positionClass} px-4`}
      style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)" }}
    >
      <div className="flex flex-wrap justify-center items-center gap-x-2 gap-y-1">
        {chunk.map((word, i) => {
          const isActive = i === activeInChunk
          const isFaded = i < activeInChunk
          return (
            <span
              key={`${chunkStart}-${i}`}
              className="transition-colors duration-150 font-black"
              style={{
                fontFamily: `'${config.font_family ?? "Oswald"}', sans-serif`,
                fontWeight: 700,
                fontSize: `${Math.round(previewFontSize * 0.9)}px`,
                color: isActive && useAccent
                  ? (config.active_word_color ?? "#FFE600")
                  : isFaded
                    ? `${config.primary_color ?? "#FFFFFF"}88`
                    : (config.primary_color ?? "#FFFFFF"),
                textShadow: outlineShadow,
                background: isActive && config.background_color ? config.background_color : "transparent",
                padding: isActive && config.background_color ? "2px 8px" : "0",
                borderRadius: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                lineHeight: 1.2,
              }}
            >
              {word}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CaptionStudio() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: presets } = useGetCaptionPresets()
  const { data: config, isLoading } = useGetCaptionConfig()
  const { data: automation } = useGetAutomation()
  const updateConfig = useUpdateCaptionConfig()
  const updateAutomation = useUpdateAutomation()

  const [local, setLocal] = useState<Partial<CaptionConfig>>({})
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savingPresetId, setSavingPresetId] = useState<string | null>(null)

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

  // Auto-save immediately when a preset is selected
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
    setDirty(false)
    setSavingPresetId(preset.id)
    updateConfig.mutate({ data: update as any }, {
      onSuccess: () => {
        setSavingPresetId(null)
        queryClient.invalidateQueries({ queryKey: getGetCaptionConfigQueryKey() })
        toast({ title: `Estilo "${preset.name}" aplicado`, description: "Los próximos videos usarán este estilo de captions." })
      },
      onError: () => {
        setSavingPresetId(null)
        toast({ title: "Error", description: "No se pudo aplicar el estilo.", variant: "destructive" })
      },
    })
  }

  const handleSave = () => {
    updateConfig.mutate({ data: local as any }, {
      onSuccess: () => {
        setDirty(false)
        queryClient.invalidateQueries({ queryKey: getGetCaptionConfigQueryKey() })
        toast({ title: "Configuración guardada", description: "La configuración avanzada de captions está lista." })
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
          ? "Los próximos videos recibirán captions dinámicos antes de publicarse."
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
            Elegí un estilo y se aplica automáticamente a tus videos.
          </p>
        </div>
        {dirty && (
          <Button onClick={handleSave} disabled={updateConfig.isPending} className="gap-2 px-8 shadow-lg shadow-primary/20">
            <Wand2 className="w-4 h-4" />
            {updateConfig.isPending ? "Guardando…" : "Guardar ajustes"}
          </Button>
        )}
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
                  ? "Los próximos videos recibirán captions dinámicos antes de publicarse. Si el render falla, se usa el video original de HeyGen."
                  : "Los videos se publican directamente desde HeyGen sin capa de captions."}
              </p>
            </div>
          </div>
          <Switch checked={captionsEnabled} onCheckedChange={handleToggle} className="shrink-0" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: preset selector + advanced */}
        <div className="lg:col-span-2 space-y-6">

          {/* Preset grid */}
          <div>
            <h2 className="text-xl font-display font-bold mb-1">Estilos prediseñados</h2>
            <p className="text-sm text-muted-foreground mb-4">Clic en un estilo para aplicarlo inmediatamente.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {(presets ?? []).map((preset) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  selected={local.preset_id === preset.id}
                  saving={savingPresetId === preset.id}
                  onClick={() => applyPreset(preset)}
                />
              ))}
            </div>
          </div>

          {/* Advanced config */}
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Ajustes avanzados</h2>
            <Card>
              <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">

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

                <div className="space-y-2">
                  <Label>Palabras por línea: <span className="text-primary font-bold">{local.words_per_line ?? 3}</span></Label>
                  <Slider
                    min={1} max={6} step={1}
                    value={[local.words_per_line ?? 3]}
                    onValueChange={([v]) => set("words_per_line", v)}
                    className="mt-3"
                  />
                  <p className="text-xs text-muted-foreground">Solo aplica en modo Highlight Line</p>
                </div>

                <div className="space-y-2">
                  <Label>Modo de efecto</Label>
                  <Select value={local.highlight_mode ?? "color"} onValueChange={(v) => set("highlight_mode", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(HIGHLIGHT_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Fuente</Label>
                  <Select value={local.font_family ?? "Oswald"} onValueChange={(v) => set("font_family", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map((f) => (
                        <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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

              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right: live preview + pipeline */}
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Vista previa</h2>
            <CaptionPreview config={local} />
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Simula el efecto real — la palabra activa cambia cada 700ms
            </p>
          </div>

          {/* Pipeline flow */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-bold font-display">Flujo del pipeline</p>
              {[
                { label: "HeyGen termina", status: "done", note: "video_url guardado" },
                { label: "Caption Engine", status: captionsEnabled ? "active" : "skip", note: captionsEnabled ? "quema captions con FFmpeg" : "desactivado" },
                { label: "Video con captions", status: captionsEnabled ? "active" : "skip", note: captionsEnabled ? "estilo seleccionado aplicado" : "—" },
                { label: "Fallback", status: "info", note: "usa video original si falla el render" },
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
