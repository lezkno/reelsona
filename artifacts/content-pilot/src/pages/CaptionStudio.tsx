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

  // Mirrors engine FUNCTION_WORDS — only pronouns, conjunctions, qualifiers
  const FUNCTION_WORDS_PREVIEW = PREVIEW_FUNCTION_WORDS
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
          /* Dimidium mode: stacked lines, LEFT-aligned */
          <div className="flex flex-col items-start gap-y-0.5 w-full px-2">
            {dimLines.map((words, li) => (
              <div key={li} className="flex items-baseline justify-start gap-x-1 flex-wrap">
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
// Mirrors the engine FUNCTION_WORDS — only the most common unstressed words.
// Everything else (nouns, verbs, adjectives) is large + accent color.
const PREVIEW_FUNCTION_WORDS = new Set([
  // English pronouns
  "i","me","my","you","your","he","him","his","she","her","it","its",
  "we","us","our","they","them","their",
  // Conjunctions / qualifiers
  "and","but","or","so","yet","nor","that","which","who",
  "more","most","very","just","also","too","even","only",
  // Spanish pronouns
  "yo","me","mi","tú","te","él","ella","nosotros","ellos","se","nos",
  // Spanish conjunctions / qualifiers
  "y","e","o","pero","sino","aunque","también","más","solo","muy",
])

// Dimidium demo blocks — short Spanish words so they don't wrap in the
// narrow preview container (2-3 short words per visual line, like a real Reel).
const DIM_BLOCKS = [
  ["así",  "se",  "viraliza"],
  ["tu",   "marca"],
  ["con",  "ia"],
  ["hoy",  "mismo"],
]

// Flat list of states: (lineIdx, wordIdx within line)
const DIM_STATES = DIM_BLOCKS.flatMap((words, li) =>
  words.map((_, wi) => ({ li, wi }))
)

// ── Phone frame wrapper ───────────────────────────────────────────────────────
// Outer: 270px, padding 10px each side → screen 250px wide → height 444px
// Scale factor vs real 1920px video: 444/1920 = 0.23125
const PHONE_SCREEN_H = 444   // px — video area height inside the mock
const REAL_VIDEO_H   = 1920  // px — ASS PlayResY
const PREVIEW_SCALE  = PHONE_SCREEN_H / REAL_VIDEO_H  // ≈ 0.231

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto select-none" style={{ width: 270 }}>
      {/* Body */}
      <div className="relative bg-zinc-800 rounded-[40px] border-2 border-zinc-600 shadow-2xl shadow-black/60 px-2.5 pt-3 pb-2">
        {/* Camera pill */}
        <div className="flex justify-center mb-2">
          <div className="w-14 h-4 bg-zinc-900 rounded-full border border-zinc-700 flex items-center justify-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-700 border border-zinc-600" />
          </div>
        </div>
        {/* Volume buttons */}
        <div className="absolute left-[-4px] top-[72px] w-[4px] h-6 bg-zinc-600 rounded-l-full" />
        <div className="absolute left-[-4px] top-[106px] w-[4px] h-10 bg-zinc-600 rounded-l-full" />
        <div className="absolute left-[-4px] top-[126px] w-[4px] h-10 bg-zinc-600 rounded-l-full" />
        {/* Power button */}
        <div className="absolute right-[-4px] top-[100px] w-[4px] h-14 bg-zinc-600 rounded-r-full" />
        {/* Screen */}
        <div className="rounded-[28px] overflow-hidden bg-black" style={{ aspectRatio: "9/16" }}>
          {children}
        </div>
        {/* Home bar */}
        <div className="flex justify-center mt-2 mb-0.5">
          <div className="w-20 h-1 bg-zinc-600 rounded-full" />
        </div>
      </div>
    </div>
  )
}

function CaptionPreview({ config }: { config: Partial<CaptionConfig> }) {
  const isMixedMode  = config.highlight_mode === "mixed"
  const isPopMode    = config.highlight_mode === "scale" || config.highlight_mode === "both"
  const useAccent    = config.highlight_mode === "both" || config.highlight_mode === "color"
  const wordsPerLine = config.words_per_line ?? 3
  const lsf          = config.line_spacing_factor ?? 1.1  // line spacing factor

  // Highlight / Pop cycling
  const allWords = ["ESTO", "ES", "TU", "CAPTION", "DINÁMICO", "EN", "ACCIÓN", "HOY"]
  const [activeIdx, setActiveIdx] = useState(0)
  const [dimTick, setDimTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setActiveIdx((a) => (a + 1) % allWords.length), 700)
    return () => clearInterval(t)
  }, [allWords.length])

  useEffect(() => {
    if (!isMixedMode) return
    const state     = DIM_STATES[dimTick]
    const isLineEnd = state.wi === DIM_BLOCKS[state.li].length - 1
    const delay     = isLineEnd ? 950 : 520
    const t = setTimeout(() => setDimTick(i => (i + 1) % DIM_STATES.length), delay)
    return () => clearTimeout(t)
  }, [isMixedMode, dimTick])

  const outlineColor = config.outline_color ?? "#000000"
  const outlineShadow = [
    `-1px -1px 0 ${outlineColor}`, `1px -1px 0 ${outlineColor}`,
    `-1px  1px 0 ${outlineColor}`, `1px  1px 0 ${outlineColor}`,
    `-2px  0   0 ${outlineColor}`, `2px  0   0 ${outlineColor}`,
    ` 0  -2px  0 ${outlineColor}`, `0   2px  0 ${outlineColor}`,
  ].join(", ")

  const positionStyle: React.CSSProperties = {
    top:    { paddingTop: "8%" }    as React.CSSProperties,
    center: { paddingTop: "40%" }  as React.CSSProperties,
    bottom: { paddingBottom: "8%" } as React.CSSProperties,
  }[config.position ?? "bottom"] ?? { paddingBottom: "8%" }

  // Proportionally accurate font sizes: scaled 1:1 to real video dimensions
  const rawSize  = config.font_size ?? 88
  const largePx  = Math.max(8, Math.round(rawSize * PREVIEW_SCALE))
  const smallPx  = Math.max(6, Math.round(rawSize * 0.68 * PREVIEW_SCALE))
  // Gap between stacked lines (mirrors engine: lineSpacing = largeSize * lsf)
  const lineGap  = Math.max(2, Math.round(largePx * (lsf - 1)))
  const fontFam  = `'${config.font_family ?? "Oswald"}', sans-serif`

  const screenContent = (() => {
    if (isMixedMode) {
      const { li: curLi, wi: curWi } = DIM_STATES[dimTick]
      const accent  = config.active_word_color ?? "#FFE600"
      const primary = config.primary_color     ?? "#FFFFFF"
      const slots: { words: string[]; }[] = []
      for (let slot = 0; slot < 4; slot++) {
        const li = curLi - slot
        if (li < 0) break
        slots.push({ words: slot === 0 ? DIM_BLOCKS[li].slice(0, curWi + 1) : DIM_BLOCKS[li] })
      }
      return (
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 flex flex-col items-start" style={{ gap: lineGap }}>
          {[...slots].reverse().map(({ words }, idx) => (
            <div key={`${curLi}-${idx}`} className="flex items-baseline flex-wrap" style={{ gap: "4px" }}>
              {words.map((w, wi) => {
                const isFunc = PREVIEW_FUNCTION_WORDS.has(w.toLowerCase())
                return (
                  <span key={wi} style={{
                    fontFamily: `'${config.font_family ?? "Poppins"}', sans-serif`,
                    fontWeight: 800,
                    fontSize: `${isFunc ? smallPx : largePx}px`,
                    color: isFunc ? primary : accent,
                    textShadow: outlineShadow,
                    lineHeight: 1.15,
                  }}>{w}</span>
                )
              })}
            </div>
          ))}
        </div>
      )
    }

    if (isPopMode) {
      const word = allWords[activeIdx]
      return (
        <div className="absolute inset-0 flex items-end justify-center" style={positionStyle}>
          <span className="transition-all duration-100" style={{
            fontFamily: fontFam, fontWeight: 700,
            fontSize: `${largePx}px`,
            color: useAccent ? (config.active_word_color ?? "#FFE600") : (config.primary_color ?? "#FFFFFF"),
            textShadow: outlineShadow,
            background: config.background_color ?? "transparent",
            padding: config.background_color ? "1px 8px" : "0",
            borderRadius: config.background_color ? "5px" : "0",
            textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2,
          }}>{word}</span>
        </div>
      )
    }

    // Highlight line mode
    const chunkStart   = Math.floor(activeIdx / wordsPerLine) * wordsPerLine
    const chunk        = allWords.slice(chunkStart, chunkStart + wordsPerLine)
    const activeInChunk = activeIdx - chunkStart
    return (
      <div className="absolute inset-0 flex items-end justify-center" style={positionStyle}>
        <div className="flex flex-wrap justify-center items-center gap-x-1.5 gap-y-0.5">
          {chunk.map((word, i) => {
            const isActive = i === activeInChunk
            const isFaded  = i < activeInChunk
            return (
              <span key={`${chunkStart}-${i}`} className="transition-colors duration-150" style={{
                fontFamily: fontFam, fontWeight: 700,
                fontSize: `${largePx}px`,
                color: isActive && useAccent
                  ? (config.active_word_color ?? "#FFE600")
                  : isFaded ? `${config.primary_color ?? "#FFFFFF"}88`
                  : (config.primary_color ?? "#FFFFFF"),
                textShadow: outlineShadow,
                background: isActive && config.background_color ? config.background_color : "transparent",
                padding: isActive && config.background_color ? "1px 6px" : "0",
                borderRadius: "4px",
                textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2,
              }}>{word}</span>
            )
          })}
        </div>
      </div>
    )
  })()

  return (
    <PhoneFrame>
      <div
        className="w-full h-full relative"
        style={{ background: "linear-gradient(to bottom, #1a1a2e 0%, #16213e 60%, #0f3460 100%)" }}
      >
        {screenContent}
      </div>
    </PhoneFrame>
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
                  <Label>
                    Tamaño de letra: <span className="text-primary font-bold">{local.font_size ?? 88}px</span>
                  </Label>
                  <Slider
                    min={60} max={220} step={5}
                    value={[local.font_size ?? 88]}
                    onValueChange={([v]) => set("font_size", v)}
                    className="mt-3"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>60 — compacto</span>
                    <span>220 — máximo impacto</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Espacio entre líneas: <span className="text-primary font-bold">
                      {{ 1.0: "Súper ajustado", 1.1: "Ajustado", 1.2: "Normal", 1.4: "Amplio", 1.7: "Muy amplio", 2.0: "Máximo" }[String(local.line_spacing_factor ?? 1.1)] ?? `${local.line_spacing_factor ?? 1.1}×`}
                    </span>
                  </Label>
                  <Slider
                    min={1.0} max={2.0} step={0.1}
                    value={[local.line_spacing_factor ?? 1.1]}
                    onValueChange={([v]) => set("line_spacing_factor", Math.round(v * 10) / 10)}
                    className="mt-3"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>1.0 — líneas pegadas</span>
                    <span>2.0 — muy separadas</span>
                  </div>
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
