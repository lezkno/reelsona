import { useState, useEffect, useRef } from "react"
import { useGetCaptionPresets, useGetCaptionConfig, useUpdateCaptionConfig, useGetAutomation, useUpdateAutomation, getGetAutomationQueryKey, useGetVideos } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { CheckCircle2, Wand2, AlertCircle, Sparkles, Loader2,
  Heart, MessageCircle, Send, Bookmark, MoreHorizontal,
  Music2, Home, Search, Plus, User, ChevronLeft, Clapperboard,
} from "lucide-react"
import type { CaptionConfig, CaptionPreset } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { getGetCaptionConfigQueryKey } from "@workspace/api-client-react"
import {
  BROWSER_CAPTION_TEMPLATES,
  buildWordStyle,
  scaleToHeight,
  getBaselineY,
  getSafeMarginX,
} from "@workspace/caption-templates"
import type { CaptionTemplate } from "@workspace/caption-templates"

// Load Oswald & Bangers from Google Fonts for preview rendering
const link = document.createElement("link")
link.rel = "stylesheet"
link.href = "https://fonts.googleapis.com/css2?family=Bangers&family=Montserrat:wght@900&family=Oswald:wght@400;700&family=Poppins:wght@400;800&display=swap"
document.head.appendChild(link)

const POSITION_LABELS: Record<string, string> = { top: "Arriba", center: "Centro", bottom: "Abajo" }
const HIGHLIGHT_LABELS: Record<string, string> = {
  mixed: "Dimidium (tamaños mixtos, líneas apiladas)",
  color: "Highlight Line (3 palabras, activa en color)",
  scale: "Pop (1 palabra a la vez, grande)",
  both: "Pop + Color (1 palabra en color de acento)",
  zoom: "Zoom In (1 palabra con zoom + fade)",
}
// Only fonts bundled with the server FFmpeg renderer — ensures preview matches video output
const FONT_OPTIONS = ["Oswald", "Poppins", "Bangers"]

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
  const isPopMode   = preset.highlight_mode === "scale" || preset.highlight_mode === "both" || preset.highlight_mode === "zoom"
  const useAccent   = preset.highlight_mode === "both" || preset.highlight_mode === "color"

  const outlineColor = preset.outline_color ?? "#000000"
  const hasBg = !!preset.background_color
  // Crisp stroke mirrors ASS libass output better than 8-shadow hack
  const cardStrokeStyle: React.CSSProperties = hasBg ? {} : {
    WebkitTextStroke: `2px ${outlineColor}`,
    paintOrder: "stroke fill" as const,
    textShadow: "1px 1px 0 rgba(0,0,0,0.6)",
  }

  const wordStyle = (isActive: boolean, faded = false): React.CSSProperties => ({
    fontFamily: `'${preset.font_family}', sans-serif`,
    fontWeight: 700,
    color: isActive && useAccent
      ? preset.active_word_color
      : faded
        ? `${preset.primary_color}88`
        : preset.primary_color,
    ...cardStrokeStyle,
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
  const dimLineStyle = (_word: string, large: boolean): React.CSSProperties => ({
    fontFamily: `'${preset.font_family}', sans-serif`,
    fontWeight: 800,
    fontSize: large ? "clamp(15px, 5.5cqw, 26px)" : "clamp(9px, 3.2cqw, 15px)",
    color: large ? preset.active_word_color : preset.primary_color,
    WebkitTextStroke: `2px ${outlineColor}`,
    paintOrder: "stroke fill" as const,
    textShadow: "1px 1px 0 rgba(0,0,0,0.6)",
    display: "inline-block",
    lineHeight: 1.2,
  })
  const dimLines = [
    ["tu",    "marca"],
    ["crece", "sola"],
    ["desde", "hoy"],
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

// ─── Browser Template Preview ────────────────────────────────────────────────
// Renders captions using the same CaptionTemplate definition as the backend
// canvas renderer — true WYSIWYG: font, size, stroke, shadow, position, colors
// all come from the shared template object, not from the legacy CaptionConfig.

const PREVIEW_WIDTH_PX = 250   // approximate screen width inside the phone mock

function TemplateCaptionPreview({
  template,
  yOverride,
  marginXOverride,
  onYPositionChange,
  onXMarginChange,
}: {
  template: CaptionTemplate
  /** y_position override in % (0–100). When set, overrides template.yPercent. */
  yOverride?: number
  /** margin_x override in pixels at 1080-width scale. When set, overrides template.marginXPercent. */
  marginXOverride?: number
  onYPositionChange?: (y: number) => void
  onXMarginChange?: (x: number) => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setActiveIdx((a) => (a + 1) % DEMO_WORDS.length), 700)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { setActiveIdx(0) }, [template.wordsPerLine])

  const chunkStart    = Math.floor(activeIdx / template.wordsPerLine) * template.wordsPerLine
  const chunk         = DEMO_WORDS.slice(chunkStart, chunkStart + template.wordsPerLine)
  const activeInChunk = activeIdx - chunkStart

  // Scale all 1920-reference values to preview dimensions
  const scaledFS   = Math.round(scaleToHeight(template.fontSize,    PHONE_SCREEN_H))
  const scaledOW   = +scaleToHeight(template.outlineWidth,  PHONE_SCREEN_H).toFixed(1)
  const scaledSX   = +scaleToHeight(template.shadowOffsetX, PHONE_SCREEN_H).toFixed(1)
  const scaledSY   = +scaleToHeight(template.shadowOffsetY, PHONE_SCREEN_H).toFixed(1)
  const scaledBlur = +scaleToHeight(template.shadowBlur,    PHONE_SCREEN_H).toFixed(1)

  // Effective position: user override takes precedence over template default
  const effectiveYPct       = yOverride       ?? template.yPercent
  const effectiveMarginXPx  = marginXOverride ?? Math.round(template.marginXPercent * 1080 / 100)
  // Convert to preview-space pixels
  const baselineY  = Math.round(PHONE_SCREEN_H * effectiveYPct / 100)
  const marginX_px = Math.round(effectiveMarginXPx * PREVIEW_SCALE)

  // ── Pixel-accurate text container height ────────────────────────────────
  // The canvas draws text with ctx.textBaseline="alphabetic" at baselineY.
  // Below that baseline, the rendered PNG extends by: font-descender + outline + shadow.
  // Measuring authority_bold cue PNGs: text bbox bottom = baseline + 41px at 1920 scale.
  // Formula: fontDescender(~25% em) + outline*1.2 + shadowOffsetY + shadowBlur*0.5
  // Scaled to preview: all values at PREVIEW_SCALE.
  // Adding this as padding lets the CSS text sit at the same visual position as the canvas.
  const extraBelowBaseline = Math.ceil(
    scaledFS   * 0.25 +           // font descender metric (~25% of em for Poppins/Oswald)
    scaledOW   * 1.2  +           // outline extends below the alphabetic baseline
    scaledSY          +           // shadow offset downward
    scaledBlur * 0.4              // shadow blur spreads downward
  )
  // Text container spans from top of frame to baselineY + extraBelowBaseline,
  // so the visual glyph bottom (including outline/shadow) lands at the correct position.
  const containerH = baselineY + extraBelowBaseline

  return (
    <PhoneFrame>
      {/*
        Background simulates a real talking-head studio shot based on actual test video frames:
        — top portion: warm lit background (white wall, bookshelf, lamp highlight)
        — middle: dark navy area (person's sweater)
        — lower: warm wood desk surface visible at the bottom
        This lets the user judge caption position the same way they would in the real video.
      */}
      <div className="w-full h-full relative overflow-hidden select-none"
        style={{ background: `
          linear-gradient(180deg,
            #c8b8a8 0%,
            #d4c8b8 6%,
            #a89888 16%,
            #786858 26%,
            #1e2840 36%,
            #18202e 52%,
            #141820 66%,
            #2a2418 74%,
            #6a5030 82%,
            #583e24 90%,
            #2a1e10 100%
          )` }}>

        {/* Lamp highlight — upper-left warm glow, matching real video */}
        <div className="absolute pointer-events-none"
          style={{ top: "6%", left: "8%", width: "22%", height: "18%",
            background: "radial-gradient(ellipse, rgba(255,200,80,0.28) 0%, transparent 70%)" }} />
        {/* Right-side window/wall highlight */}
        <div className="absolute pointer-events-none"
          style={{ top: "0", right: "0", width: "35%", height: "40%",
            background: "radial-gradient(ellipse at top right, rgba(220,215,210,0.18) 0%, transparent 70%)" }} />

        {/* Caption words — bottom-anchored at (baselineY + extraBelowBaseline)
            so the visual glyph bottom matches the canvas-rendered video exactly */}
        <div
          className="absolute left-0 right-0 z-10 flex items-end justify-center"
          style={{
            top:          0,
            height:       containerH,
            paddingLeft:  marginX_px,
            paddingRight: marginX_px,
          }}
        >
          <div className="flex flex-wrap justify-center items-end gap-x-1 gap-y-0.5">
            {chunk.map((word, i) => {
              const isActive = i === activeInChunk
              return (
                <span
                  key={`${chunkStart}-${i}`}
                  style={buildWordStyle(template, isActive, scaledFS, scaledOW, scaledSX, scaledSY, scaledBlur) as React.CSSProperties}
                >
                  {template.uppercase ? word.toUpperCase() : word}
                </span>
              )
            })}
          </div>
        </div>

        {/* ── DRAG OVERLAY — same as CaptionPreview ── */}
        <div
          className="absolute inset-0 z-40"
          style={{ cursor: isDragging ? "grabbing" : "move", touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault()
            setIsDragging(true)
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!isDragging) return
            const rect = e.currentTarget.getBoundingClientRect()
            const pctY = Math.max(10, Math.min(97, ((e.clientY - rect.top) / rect.height) * 100))
            onYPositionChange?.(Math.round(pctY * 10) / 10)
            const pxX = Math.max(0, Math.min(400, (e.clientX - rect.left) / PREVIEW_SCALE))
            onXMarginChange?.(Math.round(pxX))
          }}
          onPointerUp={() => setIsDragging(false)}
          onPointerLeave={() => setIsDragging(false)}
        />

        {/* Horizontal guide line — sits at the canvas alphabetic baseline (baselineY).
            The rendered text visual bottom is extraBelowBaseline px lower, matching the video. */}
        <div className="absolute left-0 right-0 z-41 pointer-events-none transition-all duration-75"
          style={{
            top: baselineY - 1,
            borderTop: isDragging
              ? "1.5px dashed rgba(255,255,255,0.75)"
              : "1px dashed rgba(255,255,255,0.15)",
          }}
        />
        {/* Vertical guide line */}
        <div className="absolute top-0 bottom-0 z-41 pointer-events-none transition-all duration-75"
          style={{
            left: marginX_px - 1,
            borderLeft: isDragging
              ? "1.5px dashed rgba(255,255,255,0.75)"
              : "1px dashed rgba(255,255,255,0.15)",
          }}
        />
        {/* Crosshair grip */}
        <div className="absolute z-41 pointer-events-none"
          style={{ left: marginX_px - 6, top: baselineY - 6 }}>
          <div className="w-3 h-3 rounded-full border border-white/50 bg-white/20" />
        </div>
        {/* Badge while dragging */}
        {isDragging && (
          <div className="absolute z-42 pointer-events-none flex gap-1"
            style={{ left: marginX_px + 4, top: baselineY - 22 }}>
            <span className="text-white text-[8px] font-medium bg-black/75 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              ← {Math.round(effectiveMarginXPx)}px
            </span>
            <span className="text-white text-[8px] font-medium bg-black/75 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              ↕ {Math.round(effectiveYPct)}%
            </span>
          </div>
        )}

        {/* Instagram UI — subtle, unobtrusive; no bottom nav bar inside the video area
            (the real video has no nav bar — that lives outside the content frame) */}
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pt-2 pb-1 pointer-events-none">
          <ChevronLeft size={18} className="text-white/70 drop-shadow" />
          <span className="text-white/80 text-[11px] font-semibold tracking-wide drop-shadow">Reels</span>
          <Clapperboard size={16} className="text-white/70 drop-shadow" />
        </div>
        {/* Side engagement icons — anchored near the bottom, low opacity */}
        <div className="absolute right-2 z-20 flex flex-col items-center gap-3 pointer-events-none" style={{ bottom: 14 }}>
          <div className="relative">
            <div className="w-7 h-7 rounded-full border border-white/60"
              style={{ background: "linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)" }} />
          </div>
          <div className="flex flex-col items-center gap-0.5 opacity-60">
            <Heart size={20} className="text-white fill-white" />
            <span className="text-white text-[8px]">47K</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 opacity-60">
            <MessageCircle size={20} className="text-white" />
            <span className="text-white text-[8px]">1.8K</span>
          </div>
        </div>
        {/* Bottom user info strip — very subtle, inside video content area */}
        <div className="absolute left-2 right-12 z-20 pointer-events-none" style={{ bottom: 12 }}>
          <div className="flex items-center gap-1.5 mb-0.5 opacity-75">
            <div className="w-5 h-5 rounded-full border border-white/70"
              style={{ background: "linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)" }} />
            <span className="text-white text-[9px] font-bold drop-shadow">tu_cuenta</span>
          </div>
          <p className="text-white text-[7.5px] leading-tight line-clamp-1 opacity-60">
            ✨ Automatización con IA para tu marca
          </p>
        </div>
      </div>
    </PhoneFrame>
  )
}

// ─── Shared phone/preview dimension constants ─────────────────────────────────
// Declared here (before BrowserTemplateCard) so every component that references
// them — BrowserTemplateCard, TemplateCaptionPreview, CaptionPreview — can do so
// without a forward-reference TypeScript error.

const PHONE_SCREEN_H = 444   // px — video area height inside the phone mock
const REAL_VIDEO_H   = 1920  // px — ASS PlayResY / HeyGen output height
const PREVIEW_SCALE  = PHONE_SCREEN_H / REAL_VIDEO_H  // ≈ 0.231

// ─── Browser Template Card ────────────────────────────────────────────────────
// The preview uses a CSS-scaled 250×444 mini-frame (same pixel values as
// TemplateCaptionPreview) so the card thumbnail is a pixel-perfect miniature
// of the phone preview — no separate CARD_H scaling needed.

const PHONE_SCREEN_W = 250  // px — matches PhoneFrame screen width (270 outer − 2×10 padding)
const CARD_PREVIEW_H = 220  // px — h-[220px] on the card preview container
const CARD_SCALE     = CARD_PREVIEW_H / PHONE_SCREEN_H  // ≈ 0.495

function BrowserTemplateCard({
  template,
  selected,
  saving,
  onClick,
}: {
  template: CaptionTemplate
  selected: boolean
  saving: boolean
  onClick: () => void
}) {
  // Use PHONE_SCREEN_H for all scaling — identical to TemplateCaptionPreview.
  // A CSS transform shrinks the 250×444 frame to fit the card thumbnail area.
  const scaledFS = Math.round(scaleToHeight(template.fontSize,    PHONE_SCREEN_H))
  const scaledOW = +scaleToHeight(template.outlineWidth,  PHONE_SCREEN_H).toFixed(1)
  const scaledSX = +scaleToHeight(template.shadowOffsetX, PHONE_SCREEN_H).toFixed(1)
  const scaledSY = +scaleToHeight(template.shadowOffsetY, PHONE_SCREEN_H).toFixed(1)
  const scaledBl = +scaleToHeight(template.shadowBlur,    PHONE_SCREEN_H).toFixed(1)
  const baselineY = getBaselineY(template, PHONE_SCREEN_H)

  const demoWords = DEMO_WORDS.slice(0, template.wordsPerLine)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-xl overflow-hidden border-2 transition-all text-left ${
        selected
          ? "border-violet-500 ring-2 ring-violet-500/30 shadow-lg scale-[1.01]"
          : "border-border hover:border-violet-400/40 hover:scale-[1.005]"
      }`}
    >
      {/* Outer crop window — fixed height, clips the scaled mini-frame */}
      <div className="h-[220px] relative overflow-hidden select-none"
        style={{ background: "linear-gradient(to bottom, #1a1a2e 0%, #16213e 60%, #0f3460 100%)" }}
      >
        {/* Mini video frame: 250×444, CSS-scaled to CARD_PREVIEW_H.
            Uses the same pixel values as TemplateCaptionPreview → pixel-perfect WYSIWYG. */}
        <div style={{
          position:        "absolute",
          top:             0,
          left:            "50%",
          marginLeft:      -(PHONE_SCREEN_W / 2),
          width:           PHONE_SCREEN_W,
          height:          PHONE_SCREEN_H,
          transformOrigin: "top center",
          transform:       `scale(${CARD_SCALE})`,
          background:      "linear-gradient(160deg, #1a1a2e 0%, #16213e 55%, #0f3460 100%)",
        }}>
          {/* Bottom gradient — matches TemplateCaptionPreview */}
          <div className="absolute bottom-0 left-0 right-0 h-44 pointer-events-none"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }} />

          {/* Caption words — identical positioning to TemplateCaptionPreview */}
          <div
            className="absolute left-0 right-0 flex items-end justify-center"
            style={{
              top:          0,
              height:       baselineY,
              paddingLeft:  `${template.marginXPercent}%`,
              paddingRight: `${template.marginXPercent}%`,
            }}
          >
            <div className="flex flex-wrap justify-center items-end gap-x-1 gap-y-0.5">
              {demoWords.map((word, i) => (
                <span
                  key={i}
                  style={buildWordStyle(template, i === 1, scaledFS, scaledOW, scaledSX, scaledSY, scaledBl) as React.CSSProperties}
                >
                  {template.uppercase ? word.toUpperCase() : word}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-violet-500 text-white flex items-center justify-center shadow">
          {saving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <CheckCircle2 className="w-4 h-4" />
          }
        </div>
      )}

      {/* BETA badge */}
      <div className="absolute top-2 left-2">
        <span className="text-[8px] font-bold bg-violet-600/85 text-white px-1.5 py-0.5 rounded-sm uppercase tracking-wider backdrop-blur-sm">
          BETA
        </span>
      </div>

      {/* Info panel */}
      <div className="p-3 border-t bg-card">
        <p className="font-bold text-sm leading-tight">{template.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{template.description}</p>
        <div className="flex gap-1 mt-2 flex-wrap">
          <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-violet-400/50 text-violet-600 dark:text-violet-400">
            🎨 Canvas
          </Badge>
          <Badge variant="outline" className="text-[9px] py-0 px-1.5" style={{ fontFamily: template.fontFamily }}>
            {template.fontFamily}
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
// Must stay in sync with FUNCTION_WORDS in caption-engine.ts
const PREVIEW_FUNCTION_WORDS = new Set([
  // ── English ──────────────────────────────────────────────────────────────
  "i","me","my","you","your","he","him","his","she","her","it","its",
  "we","us","our","they","them","their",
  "a","an","the","this","that","these","those",
  "and","but","or","so","yet","nor","because","when","if","as",
  "which","who","while","although","though",
  "in","on","at","to","for","of","by","with","from","into","up","out",
  "about","over","under","after","before","between","through","without",
  "more","most","very","just","also","too","even","only","not","no",
  "is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might",
  // ── Spanish ──────────────────────────────────────────────────────────────
  "el","la","los","las","un","una","unos","unas","al","del",
  "yo","me","mi","tú","tu","te","él","ella","nosotros","ellos","se","nos",
  "le","les","lo",
  "a","de","en","con","por","para","sobre","bajo","entre","desde",
  "hasta","hacia","sin","tras","ante","según","durante","mediante",
  "y","e","o","pero","sino","aunque","también","más","solo","muy",
  "que","cuando","porque","como","si","ya","ni","pues","así","tan",
  "este","esta","estos","estas","ese","esa","esos","esas","su","sus",
  "es","son","fue","era","han","hay","ser","estar","ha","he","había",
])

// Dimidium demo blocks — realistic mix of short content + function words.
// Each block = one visual line; words appear left-to-right, then the line stacks up.
const DIM_BLOCKS = [
  ["tu",    "marca"],    // small "tu" + large "MARCA"
  ["crece", "con"],      // large "CRECE" + small "con"
  ["muy",   "rápido"],   // small "muy" + large "RÁPIDO"
  ["en",    "redes"],    // small "en" + large "REDES"
]

// Flat list of states: (lineIdx, wordIdx within line)
const DIM_STATES = DIM_BLOCKS.flatMap((words, li) =>
  words.map((_, wi) => ({ li, wi }))
)

// Demo words — Spanish social media vocabulary, 12 words = 4 clean chunks of 3
// (also works as 6×2, 3×4, or 12×1 depending on wordsPerLine)
const DEMO_WORDS = [
  "APRENDE", "ALGO",   "NUEVO",
  "CRECE",   "MÁS",   "RÁPIDO",
  "EMPIEZA", "SIN",   "PARAR",
  "TU",      "MARCA", "VENDE",
]

// ── Phone frame wrapper ───────────────────────────────────────────────────────
// Outer: 270px, padding 10px each side → screen 250px wide → height 444px
// PHONE_SCREEN_H / REAL_VIDEO_H / PREVIEW_SCALE declared above (before BrowserTemplateCard).

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

function CaptionPreview({
  config,
  onYPositionChange,
  onXMarginChange,
}: {
  config: Partial<CaptionConfig>
  onYPositionChange?: (y: number) => void
  onXMarginChange?: (x: number) => void
}) {
  const isMixedMode  = config.highlight_mode === "mixed"
  const isZoomMode   = config.highlight_mode === "zoom"
  const isPopMode    = config.highlight_mode === "scale" || config.highlight_mode === "both"
  const useAccent    = config.highlight_mode === "both" || config.highlight_mode === "color"
  const wordsPerLine = config.words_per_line ?? 3
  const lsf          = config.line_spacing_factor ?? 1.1
  const [isDragging, setIsDragging] = useState(false)

  // y_position: 0–100% from top of video → baseY_px in preview pixels
  const yPos     = config.y_position ?? 75
  const baseY_px = Math.round(PHONE_SCREEN_H * (yPos / 100))
  // margin_x: left margin in real video pixels → preview pixels
  const marginX_px = Math.max(4, Math.round((config.margin_x ?? 60) * PREVIEW_SCALE))

  // Highlight / Pop cycling
  const allWords = DEMO_WORDS
  const [activeIdx, setActiveIdx] = useState(0)
  const [dimTick, setDimTick] = useState(0)
  // Zoom-in animation: reset to false on word change, then snap to true to trigger transition
  const [zoomed, setZoomed] = useState(true)

  useEffect(() => {
    const t = setInterval(() => setActiveIdx((a) => (a + 1) % allWords.length), 700)
    return () => clearInterval(t)
  }, [allWords.length])

  // Reset cycling when wordsPerLine changes — ensures preview always starts on a clean chunk boundary
  useEffect(() => { setActiveIdx(0) }, [wordsPerLine])

  useEffect(() => {
    if (!isZoomMode) return
    setZoomed(false)
    const t = setTimeout(() => setZoomed(true), 30)
    return () => clearTimeout(t)
  }, [isZoomMode, activeIdx])

  useEffect(() => {
    if (!isMixedMode) return
    const state     = DIM_STATES[dimTick]
    const isLineEnd = state.wi === DIM_BLOCKS[state.li].length - 1
    const delay     = isLineEnd ? 950 : 520
    const t = setTimeout(() => setDimTick(i => (i + 1) % DIM_STATES.length), delay)
    return () => clearTimeout(t)
  }, [isMixedMode, dimTick])

  // Proportionally accurate font sizes: scaled 1:1 to real video dimensions
  const rawSize  = config.font_size ?? 88

  const outlineColor = config.outline_color ?? "#000000"
  const hasBg = !!config.background_color
  // Mirror ASS engine outline values scaled to preview dimensions:
  // Normal/Highlight/Pop = Outline 7px, Mixed = 6px, Zoom = max(4, fontSize×6%) at PlayResY 1920
  const rawOutlineASS = isMixedMode ? 6
    : isZoomMode ? Math.max(4, Math.round(rawSize * 0.06))
    : 7
  const strokePx = hasBg ? 0 : +(rawOutlineASS * PREVIEW_SCALE).toFixed(1)
  const shadowPx = hasBg ? 0 : +(2 * PREVIEW_SCALE).toFixed(1)
  // WebkitTextStroke + paintOrder gives a crisp outward stroke matching libass rendering,
  // much closer than the old 8-direction text-shadow blurry approximation.
  const strokeStyle = (hasBg ? {} : {
    WebkitTextStroke: `${strokePx}px ${outlineColor}`,
    paintOrder: "stroke fill" as const,
    textShadow: `${shadowPx}px ${shadowPx}px 0 rgba(0,0,0,0.75)`,
  }) as React.CSSProperties
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
      // Match engine geometry exactly:
      //   - slot spacing = largeSize × lsf  (same as buildDimidiumASS lineSpacing)
      //   - \an1 bottom-anchored: line bottom = baseY - slot × slotSpacing
      //   - words joined by natural space char — no artificial flex gap
      const slotSpacing = Math.round(largePx * lsf)
      const lineH       = Math.round(largePx * 1.15)  // approximate line-box height
      const dimFontFam  = `'${config.font_family ?? "Poppins"}', sans-serif`

      return (
        <div className="absolute" style={{ top: 0, left: 0, right: 0, height: PHONE_SCREEN_H }}>
          {[...slots].reverse().map(({ words }, idx) => {
            // After reverse: idx=0 = oldest (top), idx=last = newest (bottom)
            const slotIdx     = (slots.length - 1) - idx   // 0=newest(bottom)
            const lineBottomY = baseY_px - slotIdx * slotSpacing
            return (
              <div key={`${curLi}-${idx}`} style={{
                position: 'absolute',
                top: lineBottomY - lineH,
                left: marginX_px,
                right: 8,
                lineHeight: 1.15,
                overflow: 'visible',
              }}>
                {words.map((w, wi) => {
                  const isFunc = PREVIEW_FUNCTION_WORDS.has(w.toLowerCase())
                  return (
                    <span key={wi} style={{
                      fontFamily: dimFontFam,
                      fontWeight: 800,
                      fontSize: `${isFunc ? smallPx : largePx}px`,
                      color: isFunc ? primary : accent,
                      ...strokeStyle,
                    }}>{wi > 0 ? ' ' : ''}{w}</span>
                  )
                })}
              </div>
            )
          })}
        </div>
      )
    }

    if (isZoomMode) {
      const word = allWords[activeIdx]
      return (
        <div className="absolute left-0 right-0 flex justify-center"
          style={{ top: baseY_px - largePx * 1.2, height: largePx * 2.4, alignItems: "center", display: "flex" }}>
          <span style={{
            fontFamily: fontFam, fontWeight: 700,
            fontSize: `${largePx}px`,
            color: config.active_word_color ?? "#FFE600",
            ...strokeStyle,
            letterSpacing: "0.04em",
            lineHeight: 1.2,
            display: "inline-block",
            transform: zoomed ? "scale(1)" : "scale(0.6)",
            opacity: zoomed ? 1 : 0.35,
            transition: "transform 0.2s ease-out, opacity 0.2s ease-out",
          }}>{word}</span>
        </div>
      )
    }

    if (isPopMode) {
      const word = allWords[activeIdx]
      return (
        <div className="absolute left-0 right-0 flex items-end justify-center" style={{ top: 0, height: baseY_px, paddingLeft: marginX_px, paddingRight: marginX_px }}>
          <span className="transition-all duration-100" style={{
            fontFamily: fontFam, fontWeight: 700,
            fontSize: `${largePx}px`,
            color: useAccent ? (config.active_word_color ?? "#FFE600") : (config.primary_color ?? "#FFFFFF"),
            ...strokeStyle,
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
      <div className="absolute left-0 right-0 flex items-end justify-center" style={{ top: 0, height: baseY_px, paddingLeft: marginX_px, paddingRight: marginX_px }}>
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
                ...strokeStyle,
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

  // ── Instagram Reel UI overlay ────────────────────────────────────────────────
  return (
    <PhoneFrame>
      <div className="w-full h-full relative overflow-hidden select-none"
        style={{ background: "linear-gradient(160deg, #1a1a2e 0%, #16213e 55%, #0f3460 100%)" }}>

        {/* Subtle avatar silhouette in background (simulates avatar video) */}
        <div className="absolute inset-0 flex items-center justify-center opacity-10">
          <div className="w-24 h-32 rounded-full bg-white/30" style={{ borderRadius: "50% 50% 45% 45%" }} />
        </div>

        {/* Bottom gradient for readability */}
        <div className="absolute bottom-0 left-0 right-0 h-44 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }} />
        {/* Top gradient */}
        <div className="absolute top-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)" }} />

        {/* Captions — at proportional position (same z-index as video content) */}
        <div className="absolute inset-0 z-10">
          {screenContent}
        </div>

        {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pt-2 pb-1">
          <ChevronLeft size={18} className="text-white drop-shadow" />
          <span className="text-white text-[11px] font-semibold tracking-wide drop-shadow">Reels</span>
          <Clapperboard size={16} className="text-white drop-shadow" />
        </div>

        {/* ── RIGHT ACTIONS ────────────────────────────────────────────────── */}
        <div className="absolute right-2 z-20 flex flex-col items-center gap-3.5"
          style={{ bottom: 52 }}>
          {/* Profile avatar with follow */}
          <div className="relative mb-1">
            <div className="w-8 h-8 rounded-full border-2 border-white"
              style={{ background: "linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)" }} />
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#0095f6] border border-black flex items-center justify-center">
              <Plus size={9} className="text-white" strokeWidth={3} />
            </div>
          </div>
          {/* Heart */}
          <div className="flex flex-col items-center gap-0.5 mt-1">
            <Heart size={22} className="text-white drop-shadow fill-white" />
            <span className="text-white text-[9px] font-medium drop-shadow">47.2K</span>
          </div>
          {/* Comment */}
          <div className="flex flex-col items-center gap-0.5">
            <MessageCircle size={22} className="text-white drop-shadow" />
            <span className="text-white text-[9px] font-medium drop-shadow">1.8K</span>
          </div>
          {/* Share */}
          <div className="flex flex-col items-center gap-0.5">
            <Send size={20} className="text-white drop-shadow" />
            <span className="text-white text-[9px] font-medium drop-shadow">Enviar</span>
          </div>
          {/* Bookmark */}
          <Bookmark size={20} className="text-white drop-shadow" />
          {/* More */}
          <MoreHorizontal size={20} className="text-white drop-shadow" />
        </div>

        {/* ── BOTTOM USER INFO ─────────────────────────────────────────────── */}
        <div className="absolute left-2 right-14 z-20" style={{ bottom: 50 }}>
          {/* Username row */}
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-6 rounded-full border border-white/80"
              style={{ background: "linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)" }} />
            <span className="text-white text-[10px] font-bold drop-shadow">tu_cuenta</span>
            <span className="text-white text-[8px] border border-white/70 rounded px-1 py-px leading-tight drop-shadow">
              Seguir
            </span>
          </div>
          {/* Caption/description */}
          <p className="text-white text-[8.5px] leading-tight line-clamp-2 drop-shadow opacity-90">
            ✨ Así funciona la automatización con IA para hacer crecer tu marca
          </p>
          {/* Music */}
          <div className="flex items-center gap-1 mt-1">
            <Music2 size={8} className="text-white drop-shadow" />
            <span className="text-white text-[7.5px] opacity-80 drop-shadow">Audio original · tu_cuenta</span>
          </div>
        </div>

        {/* ── BOTTOM NAV BAR ──────────────────────────────────────────────── */}
        <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-around bg-black/90"
          style={{ height: 44, borderTop: "0.5px solid rgba(255,255,255,0.15)" }}>
          <Home size={20} className="text-white/70" />
          <Search size={20} className="text-white/70" />
          <div className="w-8 h-6 rounded-md border-2 border-white/80 flex items-center justify-center">
            <Plus size={13} className="text-white" strokeWidth={2.5} />
          </div>
          <Clapperboard size={20} className="text-white" />
          <User size={20} className="text-white/70" />
        </div>

        {/* ── DRAG OVERLAY — captures pointer events to move the caption ── */}
        <div
          className="absolute inset-0 z-40"
          style={{ cursor: isDragging ? "grabbing" : "move", touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault()
            setIsDragging(true)
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!isDragging) return
            const rect = e.currentTarget.getBoundingClientRect()
            // Y → y_position (%)
            const pctY = Math.max(10, Math.min(97, ((e.clientY - rect.top) / rect.height) * 100))
            onYPositionChange?.(Math.round(pctY * 10) / 10)
            // X → margin_x (real video pixels)
            const pxX = Math.max(0, Math.min(400, (e.clientX - rect.left) / PREVIEW_SCALE))
            onXMarginChange?.(Math.round(pxX))
          }}
          onPointerUp={() => setIsDragging(false)}
          onPointerLeave={() => setIsDragging(false)}
        />

        {/* Horizontal line — Y position */}
        <div
          className="absolute left-0 right-0 z-41 pointer-events-none transition-all duration-75"
          style={{
            top: baseY_px - 1,
            borderTop: isDragging
              ? "1.5px dashed rgba(255,255,255,0.85)"
              : "1px dashed rgba(255,255,255,0.18)",
          }}
        />
        {/* Vertical line — X margin */}
        <div
          className="absolute top-0 bottom-0 z-41 pointer-events-none transition-all duration-75"
          style={{
            left: marginX_px - 1,
            borderLeft: isDragging
              ? "1.5px dashed rgba(255,255,255,0.85)"
              : "1px dashed rgba(255,255,255,0.18)",
          }}
        />

        {/* Badge while dragging — shows both values */}
        {isDragging && (
          <div
            className="absolute z-42 pointer-events-none flex gap-1"
            style={{ left: marginX_px + 4, top: baseY_px - 22 }}
          >
            <span className="text-white text-[8px] font-medium bg-black/75 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              ← {Math.round(config.margin_x ?? 60)}px
            </span>
            <span className="text-white text-[8px] font-medium bg-black/75 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              ↕ {Math.round(yPos)}%
            </span>
          </div>
        )}

        {/* Crosshair grip at the intersection — always visible */}
        <div
          className="absolute z-41 pointer-events-none"
          style={{ left: marginX_px - 6, top: baseY_px - 6 }}
        >
          <div className="w-3 h-3 rounded-full border border-white/50 bg-white/20" />
        </div>

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
  const { data: automation } = useGetAutomation({ query: { refetchInterval: 10000 } as any })
  const { data: videos } = useGetVideos({ query: { refetchInterval: 8000 } as any })
  const updateConfig = useUpdateCaptionConfig()
  const updateAutomation = useUpdateAutomation()

  // Lock the UI while any video is actively being processed so the user can't
  // change the template mid-render and get an inconsistent result.
  const isVideoProcessing = (videos ?? []).some(
    (v) => v.status === "generating" || (v as any).caption_status === "processing"
  )

  const [local, setLocal] = useState<Partial<CaptionConfig>>({})
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savingPresetId, setSavingPresetId] = useState<string | null>(null)
  // null = checking, true = available, false = unavailable
  const [browserEngineAvailable, setBrowserEngineAvailable] = useState<boolean | null>(null)

  // ── Per-template overrides map ────────────────────────────────────────────
  // Stored as Record<templateId, Partial<CaptionTemplate>> so each template
  // remembers its own tweaks independently. Saved to DB as a JSON string in
  // caption_config.template_overrides. Auto-saved on every change (debounced).
  const [allTmplOverrides, setAllTmplOverrides] = useState<Record<string, Partial<CaptionTemplate>>>({})
  const overrideSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch("/api/captions/browser/status")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setBrowserEngineAvailable(d.available))
      .catch(() => setBrowserEngineAvailable(false))
  }, [])

  useEffect(() => {
    if (config && Object.keys(local).length === 0) {
      setLocal(config)
      // Restore saved overrides from DB — stored as Record<templateId, Partial<CaptionTemplate>>
      try {
        if (config.template_overrides) {
          const parsed = JSON.parse(config.template_overrides)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const knownIds = new Set(BROWSER_CAPTION_TEMPLATES.map((t) => t.id))
            const isMap = Object.keys(parsed).some((k) => knownIds.has(k))
            if (isMap) {
              setAllTmplOverrides(parsed)
            } else if (config.template_id) {
              // Old flat format (pre-migration) — assign to current template
              setAllTmplOverrides({ [config.template_id]: parsed })
            }
          }
        }
      } catch { /* ignore malformed JSON */ }
    }
  }, [config])

  useEffect(() => {
    if (automation) setCaptionsEnabled(automation.captions_enabled ?? false)
  }, [automation])

  const set = <K extends keyof CaptionConfig>(key: K, value: CaptionConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  // ── Template override helpers (browser engine only) ───────────────────────
  // Active base template (if browser engine is selected)
  const activeTmpl = (local.caption_engine === "browser_experimental" && local.template_id)
    ? BROWSER_CAPTION_TEMPLATES.find((t) => t.id === local.template_id) ?? null
    : null

  // Current template's override slice
  const currentOverrides: Partial<CaptionTemplate> = (activeTmpl && allTmplOverrides[activeTmpl.id]) ?? {}

  // Merged template = base + user overrides (live preview + final render)
  const mergedTmpl: CaptionTemplate | null = activeTmpl
    ? { ...activeTmpl, ...currentOverrides }
    : null

  // Convenience: effective value = override ?? base template default
  function ov<K extends keyof CaptionTemplate>(key: K): CaptionTemplate[K] {
    return (currentOverrides[key] ?? activeTmpl?.[key]) as CaptionTemplate[K]
  }

  // Auto-save the full overrides map to DB (debounced 400ms)
  const saveOverridesToDB = (nextMap: Record<string, Partial<CaptionTemplate>>) => {
    if (overrideSaveTimer.current) clearTimeout(overrideSaveTimer.current)
    overrideSaveTimer.current = setTimeout(() => {
      updateConfig.mutate({ data: { template_overrides: JSON.stringify(nextMap) } as any })
    }, 400)
  }

  const setOverride = <K extends keyof CaptionTemplate>(key: K, val: CaptionTemplate[K]) => {
    if (!activeTmpl) return
    const tid = activeTmpl.id
    setAllTmplOverrides((prev) => {
      const next = { ...prev, [tid]: { ...prev[tid], [key]: val } }
      saveOverridesToDB(next)
      return next
    })
  }

  const resetOverrides = () => {
    if (!activeTmpl) return
    const tid = activeTmpl.id
    setAllTmplOverrides((prev) => {
      const next = { ...prev }
      delete next[tid]
      saveOverridesToDB(next)
      return next
    })
  }

  // Auto-save when a Browser Template is selected.
  // Preserves the full overrides map so each template's tweaks survive switching.
  const applyBrowserTemplate = (template: CaptionTemplate) => {
    const update: Partial<CaptionConfig> = {
      caption_engine:     "browser_experimental",
      template_id:        template.id,
      // Preserve the full map — switching templates must not erase other templates' overrides
      template_overrides: Object.keys(allTmplOverrides).length > 0
        ? JSON.stringify(allTmplOverrides)
        : null as any,
      // Mirror template colors → ASS fallback will use the right palette
      primary_color:      template.primaryColor,
      active_word_color:  template.activeWordColor,
      outline_color:      template.outlineColor,
    }
    setLocal((prev) => ({ ...prev, ...update }))
    setDirty(false)
    setSavingPresetId(template.id)
    updateConfig.mutate({ data: update as any }, {
      onSuccess: () => {
        setSavingPresetId(null)
        queryClient.invalidateQueries({ queryKey: getGetCaptionConfigQueryKey() })
        toast({
          title: `Plantilla "${template.name}" activada`,
          description: "Los próximos videos usarán el Browser Caption Engine (experimental).",
        })
      },
      onError: () => {
        setSavingPresetId(null)
        toast({ title: "Error", description: "No se pudo activar la plantilla.", variant: "destructive" })
      },
    })
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
    // Some presets define their own words_per_line (e.g. Bold Stack = 2)
    if (preset.words_per_line != null) {
      update.words_per_line = preset.words_per_line
    }
    // Switch back to standard engine when selecting a standard preset
    update.caption_engine = "standard"
    update.template_id    = null
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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAutomationQueryKey() })
        toast({
          title: enabled ? "Captions activados" : "Captions desactivados",
          description: enabled
            ? "Los próximos videos recibirán captions dinámicos antes de publicarse."
            : "Los videos se publicarán con el video original de HeyGen.",
        })
      },
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
          <Button onClick={handleSave} disabled={updateConfig.isPending || isVideoProcessing} className="gap-2 px-8 shadow-lg shadow-primary/20">
            <Wand2 className="w-4 h-4" />
            {updateConfig.isPending ? "Guardando…" : "Guardar ajustes"}
          </Button>
        )}
      </div>

      {/* Processing lock banner */}
      {isVideoProcessing && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
          <span>
            <strong>Video en proceso.</strong> No podés cambiar la plantilla ni los ajustes mientras un video se está generando o aplicando captions. Esperá a que termine.
          </span>
        </div>
      )}

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
          <Switch checked={captionsEnabled} onCheckedChange={handleToggle} disabled={isVideoProcessing} className="shrink-0" />
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
                  selected={local.caption_engine !== "browser_experimental" && local.preset_id === preset.id}
                  saving={savingPresetId === preset.id}
                  onClick={() => !isVideoProcessing && applyPreset(preset)}
                />
              ))}
            </div>
          </div>

          {/* ── Experimental Browser Engine Templates ─────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-display font-bold">Plantillas Experimentales</h2>
              <Badge variant="outline" className="border-violet-400/50 text-violet-600 dark:text-violet-400 text-[10px]">
                🔬 Browser Engine
              </Badge>
              {/* Canvas availability dot — fetched once on mount */}
              {browserEngineAvailable === null && (
                <span className="w-2 h-2 rounded-full bg-zinc-400 animate-pulse" title="Verificando motor canvas…" />
              )}
              {browserEngineAvailable === true && (
                <span className="w-2 h-2 rounded-full bg-emerald-500" title="Canvas (Skia) disponible ✓" />
              )}
              {browserEngineAvailable === false && (
                <span className="w-2 h-2 rounded-full bg-amber-400" title="Canvas no disponible — se usará fallback ASS/FFmpeg" />
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Preview y render final usan la misma definición de plantilla. El look que ves es exactamente lo que queda en el MP4.
              Motor: Canvas 2D (Skia) — no ASS, no drawtext.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {BROWSER_CAPTION_TEMPLATES.map((tmpl) => (
                <BrowserTemplateCard
                  key={tmpl.id}
                  template={tmpl}
                  selected={local.caption_engine === "browser_experimental" && local.template_id === tmpl.id}
                  saving={savingPresetId === tmpl.id}
                  onClick={() => !isVideoProcessing && applyBrowserTemplate(tmpl)}
                />
              ))}
            </div>
            {local.caption_engine === "browser_experimental" && (
              <div className="mt-3 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20 text-sm text-violet-700 dark:text-violet-300 flex items-start gap-2">
                <span className="mt-0.5 shrink-0">🎨</span>
                <span>
                  <strong>Browser Engine activo.</strong> Fallback automático al motor estándar ASS/FFmpeg si el render falla.
                  Para volver al motor estándar, seleccioná cualquier preset de arriba.
                </span>
              </div>
            )}
          </div>

          {/* ── Browser template advanced settings ─────────────────────── */}
          {local.caption_engine === "browser_experimental" && mergedTmpl && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-display font-bold">Ajustes de plantilla</h2>
                {Object.keys(currentOverrides).length > 0 && (
                  <button
                    type="button"
                    onClick={resetOverrides}
                    disabled={isVideoProcessing}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-40"
                  >
                    Restaurar valores originales
                  </button>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Ajustá los valores de la plantilla <strong>{activeTmpl?.name}</strong>. El preview se actualiza en tiempo real y los cambios se aplican al video final.
              </p>
              <Card>
                <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">

                  {/* Font size */}
                  <div className="space-y-2">
                    <Label>
                      Tamaño de letra:&nbsp;
                      <span className="text-primary font-bold">{ov("fontSize")}px</span>
                      {currentOverrides.fontSize !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider
                      min={60} max={220} step={5}
                      value={[ov("fontSize") ?? 88]}
                      onValueChange={([v]) => setOverride("fontSize", v)}
                      disabled={isVideoProcessing}
                      className="mt-3"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>60 — compacto</span>
                      <span>Default: {activeTmpl?.fontSize}px</span>
                      <span>220 — máximo</span>
                    </div>
                  </div>

                  {/* Words per line */}
                  <div className="space-y-2">
                    <Label>
                      Palabras por línea:&nbsp;
                      <span className="text-primary font-bold">{ov("wordsPerLine")}</span>
                      {currentOverrides.wordsPerLine !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider
                      min={1} max={6} step={1}
                      value={[ov("wordsPerLine") ?? 3]}
                      onValueChange={([v]) => setOverride("wordsPerLine", v)}
                      disabled={isVideoProcessing}
                      className="mt-3"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>1 — una palabra</span>
                      <span>Default: {activeTmpl?.wordsPerLine}</span>
                      <span>6 — frase larga</span>
                    </div>
                  </div>

                  {/* Outline width */}
                  <div className="space-y-2">
                    <Label>
                      Grosor del outline:&nbsp;
                      <span className="text-primary font-bold">{ov("outlineWidth")}px</span>
                      {currentOverrides.outlineWidth !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider
                      min={0} max={20} step={1}
                      value={[ov("outlineWidth") ?? 0]}
                      onValueChange={([v]) => setOverride("outlineWidth", v)}
                      disabled={isVideoProcessing}
                      className="mt-3"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0 — sin outline</span>
                      <span>Default: {activeTmpl?.outlineWidth}px</span>
                      <span>20 — trazo grueso</span>
                    </div>
                  </div>

                  {/* Inactive opacity */}
                  <div className="space-y-2">
                    <Label>
                      Opacidad de palabras inactivas:&nbsp;
                      <span className="text-primary font-bold">{Math.round((ov("inactiveOpacity") ?? 1) * 100)}%</span>
                      {currentOverrides.inactiveOpacity !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider
                      min={0} max={1} step={0.05}
                      value={[ov("inactiveOpacity") ?? 1]}
                      onValueChange={([v]) => setOverride("inactiveOpacity", Math.round(v * 20) / 20)}
                      disabled={isVideoProcessing}
                      className="mt-3"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0% — invisibles</span>
                      <span>Default: {Math.round((activeTmpl?.inactiveOpacity ?? 1) * 100)}%</span>
                      <span>100% — igual que activa</span>
                    </div>
                  </div>

                  {/* Primary color */}
                  <div className="space-y-2">
                    <Label>
                      Color de texto
                      {currentOverrides.primaryColor !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={ov("primaryColor") ?? "#FFFFFF"}
                        onChange={(e) => setOverride("primaryColor", e.target.value)}
                        disabled={isVideoProcessing}
                        className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5"
                      />
                      <div>
                        <p className="text-sm font-mono">{ov("primaryColor")}</p>
                        <p className="text-[10px] text-muted-foreground">Default: {activeTmpl?.primaryColor}</p>
                      </div>
                    </div>
                  </div>

                  {/* Active word color */}
                  <div className="space-y-2">
                    <Label>
                      Color de palabra activa
                      {currentOverrides.activeWordColor !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={ov("activeWordColor") ?? "#FFFFFF"}
                        onChange={(e) => setOverride("activeWordColor", e.target.value)}
                        disabled={isVideoProcessing}
                        className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5"
                      />
                      <div>
                        <p className="text-sm font-mono">{ov("activeWordColor")}</p>
                        <p className="text-[10px] text-muted-foreground">Default: {activeTmpl?.activeWordColor}</p>
                      </div>
                    </div>
                  </div>

                  {/* Outline color */}
                  <div className="space-y-2">
                    <Label>
                      Color del outline
                      {currentOverrides.outlineColor !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={ov("outlineColor") ?? "#000000"}
                        onChange={(e) => setOverride("outlineColor", e.target.value)}
                        disabled={isVideoProcessing}
                        className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5"
                      />
                      <div>
                        <p className="text-sm font-mono">{ov("outlineColor")}</p>
                        <p className="text-[10px] text-muted-foreground">Default: {activeTmpl?.outlineColor}</p>
                      </div>
                    </div>
                  </div>

                  {/* Vertical position — hint */}
                  <div className="sm:col-span-2 flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                    <span className="text-base mt-0.5 shrink-0">✥</span>
                    <div>
                      <p className="text-xs font-medium mb-0.5">Posición vertical y margen</p>
                      <p className="text-xs text-muted-foreground leading-snug">
                        Arrastrá el preview del celular para mover los captions.
                      </p>
                      <p className="text-xs text-primary font-medium mt-1">
                        ↕ {Math.round(local.y_position ?? (activeTmpl?.yPercent ?? 75))}% &nbsp;·&nbsp; ← {Math.round(local.margin_x ?? ((activeTmpl?.marginXPercent ?? 5) * 1080 / 100))}px
                      </p>
                    </div>
                  </div>

                </CardContent>
              </Card>
            </div>
          )}

          {/* Advanced config (standard engine only) */}
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Ajustes avanzados</h2>
            <div className="relative">
              {isVideoProcessing ? (
                <div className="absolute inset-0 z-10 rounded-xl backdrop-blur-[2px] bg-background/70 flex flex-col items-center justify-center gap-2 pointer-events-auto">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                  <p className="text-sm font-semibold text-center px-6">Ajustes bloqueados</p>
                  <p className="text-xs text-muted-foreground text-center px-8 leading-snug">
                    Esperá a que el video termine de procesarse.
                  </p>
                </div>
              ) : local.caption_engine === "browser_experimental" && (
                <div className="absolute inset-0 z-10 rounded-xl backdrop-blur-[2px] bg-background/60 flex flex-col items-center justify-center gap-2 pointer-events-auto">
                  <span className="text-2xl">🎨</span>
                  <p className="text-sm font-semibold text-center px-6">Usa los ajustes de plantilla de arriba</p>
                  <p className="text-xs text-muted-foreground text-center px-8 leading-snug">
                    Las plantillas experimentales tienen sus propios controles.
                  </p>
                </div>
              )}
            <Card>
              <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">

                <div className="space-y-2 sm:col-span-2 flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                  <span className="text-base mt-0.5 shrink-0">✥</span>
                  <div>
                    <p className="text-xs font-medium mb-0.5">Posición libre</p>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Arrastrá el preview del celular: <strong>arriba/abajo</strong> mueve la altura, <strong>izquierda/derecha</strong> ajusta el margen.
                    </p>
                    <p className="text-xs text-primary font-medium mt-1">
                      ↕ {Math.round(local.y_position ?? 75)}% &nbsp;·&nbsp; ← {Math.round(local.margin_x ?? 60)}px
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Margen lateral: <span className="text-primary font-bold">{Math.round(local.margin_x ?? 60)}px</span>
                  </Label>
                  <Slider
                    min={0} max={300} step={5}
                    value={[local.margin_x ?? 60]}
                    onValueChange={([v]) => set("margin_x", v)}
                    className="mt-3"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0 — sin margen</span>
                    <span>300 — centrado</span>
                  </div>
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
                  <p className="text-xs text-muted-foreground">Aplica en modo Highlight y Dimidium</p>
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
            </div>{/* end relative wrapper */}
          </div>
        </div>

        {/* Right: live preview + pipeline — sticky on desktop so it stays visible while scrolling */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <div>
            <h2 className="text-xl font-display font-bold mb-4">Vista previa</h2>
            {mergedTmpl
              ? (
                  <TemplateCaptionPreview
                    template={mergedTmpl}
                    yOverride={local.y_position ?? undefined}
                    marginXOverride={local.margin_x ?? undefined}
                    onYPositionChange={(y) => set("y_position", y)}
                    onXMarginChange={(x) => set("margin_x", x)}
                  />
                )
              : (
                <CaptionPreview
                  config={local}
                  onYPositionChange={(y) => set("y_position", y)}
                  onXMarginChange={(x) => set("margin_x", x)}
                />
              )
            }
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {local.caption_engine === "browser_experimental"
                ? <>Preview usa la misma definición de plantilla que el render final. <span className="text-violet-500 font-medium">WYSIWYG.</span></>
                : "Posición, fuente, colores y outline reflejan el video final."
              }
              {local.highlight_mode === "zoom" && local.caption_engine !== "browser_experimental" && (
                <><br /><span className="text-amber-500">⚡ Animación zoom: aproximada en preview.</span></>
              )}
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
