import { useState, useEffect, useRef } from "react"
import { useGetCaptionPresets, useGetCaptionConfig, useUpdateCaptionConfig, useGetAutomation, useUpdateAutomation, getGetAutomationQueryKey, useGetVideos, useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react"
import type { VideoEffects } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { CheckCircle2, Wand2, AlertCircle, Sparkles, Loader2, Shuffle,
  Heart, MessageCircle, Send, Bookmark, MoreHorizontal,
  Music2, Home, Search, Plus, User, ChevronLeft, Clapperboard,
  Zap, Images, Type,
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

// Caption preview fonts are self-hosted via @font-face in index.css (same TTFs as the API server).
// No runtime injection needed.

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

  const isTypewriter  = template.animation === "typewriter"
  const isZoom        = template.animation === "zoom"
  const isBuildingMode = !!(template as CaptionTemplate & { buildingMode?: boolean }).buildingMode

  // ── Zoom animation state ───────────────────────────────────────────────────
  // Reset to false on each new word, then snap to true after 30ms to trigger
  // the CSS scale transition — mirrors the video's 65%→100% zoom-in per word.
  const [zoomed, setZoomed] = useState(true)
  useEffect(() => {
    if (!isZoom) return
    setZoomed(false)
    const t = setTimeout(() => setZoomed(true), 30)
    return () => clearTimeout(t)
  }, [isZoom, activeIdx])

  // ── Typewriter animation state ─────────────────────────────────────────────
  const [twChunkIdx,      setTwChunkIdx]      = useState(0)
  const [twRevealedChars, setTwRevealedChars] = useState(0)
  const [twHolding,       setTwHolding]       = useState(false)

  const twNumChunks   = Math.ceil(DEMO_WORDS.length / template.wordsPerLine)
  const twChunkStart  = (twChunkIdx % twNumChunks) * template.wordsPerLine
  const twChunk       = DEMO_WORDS.slice(twChunkStart, twChunkStart + template.wordsPerLine)
  const twChunkText   = twChunk.map(w => template.uppercase ? w.toUpperCase() : w).join(" ")
  const twTotalChars  = twChunkText.length

  // Standard active-word cycling — disabled when typewriter is running
  // Building mode reuses activeIdx but at a faster interval (350 ms/word)
  useEffect(() => {
    if (isTypewriter) return
    const ms = isBuildingMode ? 350 : 700
    const t = setInterval(() => setActiveIdx((a) => (a + 1) % DEMO_WORDS.length), ms)
    return () => clearInterval(t)
  }, [isTypewriter, isBuildingMode])

  useEffect(() => { if (!isTypewriter) setActiveIdx(0) }, [template.wordsPerLine, isTypewriter])

  // Typewriter: reveal chars, then hold, then advance chunk
  useEffect(() => {
    if (!isTypewriter) return undefined
    if (twHolding) {
      const t = setTimeout(() => {
        setTwChunkIdx(i => i + 1)
        setTwRevealedChars(0)
        setTwHolding(false)
      }, 900)
      return () => clearTimeout(t)
    }
    if (twRevealedChars < twTotalChars) {
      const msPerChar = template.animationDuration || 40
      const t = setTimeout(() => setTwRevealedChars(c => c + 1), msPerChar)
      return () => clearTimeout(t)
    }
    setTwHolding(true)
    return undefined
  }, [isTypewriter, twRevealedChars, twHolding, twTotalChars, template.animationDuration])

  // Reset typewriter when template changes
  useEffect(() => {
    setTwChunkIdx(0); setTwRevealedChars(0); setTwHolding(false)
  }, [template.id])

  // ── Standard chunk / active-word computation ──────────────────────────────
  const chunkStart    = Math.floor(activeIdx / template.wordsPerLine) * template.wordsPerLine
  const chunk         = DEMO_WORDS.slice(chunkStart, chunkStart + template.wordsPerLine)
  const activeInChunk = activeIdx - chunkStart

  // Building mode: accumulate words from block start up to activeIdx
  const bmBlockStart = Math.floor(activeIdx / template.wordsPerLine) * template.wordsPerLine
  const bmWords      = DEMO_WORDS.slice(bmBlockStart, activeIdx + 1)

  // For typewriter mode, use twChunk and compute per-word visible text
  const displayChunk         = isBuildingMode ? bmWords
                              : isTypewriter   ? twChunk
                              : chunk
  const displayActiveInChunk = isBuildingMode ? (bmWords.length - 1)  // last = just-added word
                              : isTypewriter   ? -1                    // no highlight during char reveal
                              : activeInChunk

  // Compute per-word display text
  const twWordTexts: string[] = (() => {
    // Building and standard modes: show full words
    if (!isTypewriter) return displayChunk.map(w => template.uppercase ? w.toUpperCase() : w)
    // Typewriter: char-by-char reveal
    let left = twRevealedChars
    return displayChunk.map(w => {
      const full = template.uppercase ? w.toUpperCase() : w
      if (left <= 0) return ""
      const visible = full.slice(0, left)
      left = Math.max(0, left - full.length - 1) // -1 for the space separator
      return visible
    })
  })()

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
          <div className={template.stackWords
            ? "flex flex-col items-center gap-y-1"
            : "flex flex-wrap justify-center items-end gap-x-1 gap-y-0.5"}>
            {displayChunk.map((word, i) => {
              const isActive   = i === displayActiveInChunk
              const isMixed    = template.highlightMode === "mixed"
              const isFuncWord = isMixed && PREVIEW_FUNCTION_WORDS.has(word.toLowerCase())
              const wordIsActive = isMixed ? !isFuncWord : isActive
              const wordFS    = isMixed && isFuncWord ? scaledFS * 0.55 : scaledFS
              const displayText = twWordTexts[i]
              if (isTypewriter && displayText === "") return null
              const zoomStyle: React.CSSProperties = isZoom ? {
                display:    "inline-block",
                transform:  zoomed ? "scale(1)" : "scale(0.65)",
                opacity:    zoomed ? 1 : 0.3,
                transition: `transform ${template.animationDuration || 180}ms ease-out, opacity ${template.animationDuration || 180}ms ease-out`,
              } : {}
              const span = (
                <span
                  key={`${twChunkStart || chunkStart}-${i}`}
                  style={{ ...(buildWordStyle(template, wordIsActive, wordFS, scaledOW, scaledSX, scaledSY, scaledBlur) as React.CSSProperties), ...zoomStyle }}
                >
                  {displayText}
                </span>
              )
              return template.stackWords
                ? <div key={`${twChunkStart || chunkStart}-${i}`} className="w-full flex justify-center">{span}</div>
                : span
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
const CARD_PREVIEW_H = 320  // px — h-[320px] on the card preview container
// Thumbnail anchored at the BOTTOM of the frame (where captions live).
// scale(0.80) → shows bottom ~90% of the 444px frame; top ~44px clipped.
// Captions at any yPercent (62–87%) all land in the lower half of the card.
const CARD_SCALE     = 0.80

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

  const demoWords = template.highlightMode === "mixed"
    ? ["tu", "MARCA", "puede", "CRECER", "así"]
    : DEMO_WORDS.slice(0, template.wordsPerLine)

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
      <div className="h-[320px] relative overflow-hidden select-none"
        style={{ background: "linear-gradient(to bottom, #1a1a2e 0%, #16213e 60%, #0f3460 100%)" }}
      >
        {/* Mini video frame: 250×444, anchored at bottom so captions are visible.
            scale(0.80) + bottom-anchor clips the top ~44px (avatar area) and
            places captions in the lower portion of the card. */}
        <div style={{
          position:        "absolute",
          bottom:          0,
          left:            "50%",
          marginLeft:      -(PHONE_SCREEN_W / 2),
          width:           PHONE_SCREEN_W,
          height:          PHONE_SCREEN_H,
          transformOrigin: "bottom center",
          transform:       `scale(${CARD_SCALE})`,
          background:      "linear-gradient(160deg, #1a1a2e 0%, #16213e 55%, #0f3460 100%)",
        }}>
          {/* Bottom gradient — matches TemplateCaptionPreview */}
          <div className="absolute bottom-0 left-0 right-0 h-44 pointer-events-none"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }} />

          {/* Caption words — fixed bottom anchor for thumbnail consistency.
              All templates show text at the same bottom position so the card
              conveys style (font, color, effects), not yPercent.
              The live preview (TemplateCaptionPreview) shows the real position. */}
          <div
            className="absolute left-0 right-0 flex justify-center"
            style={{
              bottom:       Math.round(PHONE_SCREEN_H * 0.06),
              paddingLeft:  `${template.marginXPercent}%`,
              paddingRight: `${template.marginXPercent}%`,
            }}
          >
            <div className={template.stackWords
              ? "flex flex-col items-center gap-y-1"
              : "flex flex-wrap justify-center items-end gap-x-1 gap-y-0.5"}>
              {demoWords.map((word, i) => {
                const isMixed    = template.highlightMode === "mixed"
                const isFuncWord = isMixed && PREVIEW_FUNCTION_WORDS.has(word.toLowerCase())
                const wordIsActive = isMixed ? !isFuncWord : (i === 1)
                const wordFS    = isMixed && isFuncWord ? scaledFS * 0.55 : scaledFS
                const span = (
                  <span
                    key={i}
                    style={buildWordStyle(template, wordIsActive, wordFS, scaledOW, scaledSX, scaledSY, scaledBl) as React.CSSProperties}
                  >
                    {template.uppercase ? word.toUpperCase() : word}
                  </span>
                )
                return template.stackWords
                  ? <div key={i} className="w-full flex justify-center">{span}</div>
                  : span
              })}
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

// ── Multi-card types ──────────────────────────────────────────────────────────

interface CardSlotConfig {
  enabled: boolean
  useAi: boolean
  text?: string       // hook, cta
  headline?: string   // stat
  subtext?: string    // stat
  templateId?: string // visual style
}

interface MultiCardConfig {
  version: 2
  hook: CardSlotConfig
  stat: CardSlotConfig
  cta:  CardSlotConfig
}

const DEFAULT_MULTI_CARDS: MultiCardConfig = {
  version: 2,
  hook: { enabled: false, useAi: false, text: "",     templateId: "dark-glass" },
  stat: { enabled: false, useAi: false, headline: "", subtext: "", templateId: "ocean" },
  cta:  { enabled: false, useAi: false, text: "",     templateId: "fire" },
}

// ── Card style templates (mirrors CARD_STYLE_TEMPLATES in text-cards-engine) ─

interface CardStyleTemplate {
  id: string
  name: string
  previewBg: string
  previewColor: string
  previewBorder?: string
}

const CARD_STYLE_TEMPLATES: CardStyleTemplate[] = [
  { id: "dark-glass",    name: "Glass",     previewBg: "rgba(0,0,0,0.82)",                          previewColor: "#fff",    previewBorder: "rgba(255,255,255,0.35)" },
  { id: "fire",          name: "Fuego",     previewBg: "linear-gradient(90deg,#f43f5e,#f97316)",    previewColor: "#fff" },
  { id: "ocean",         name: "Océano",    previewBg: "#0ea5e9",                                   previewColor: "#fff" },
  { id: "ocean-gradient",name: "Cian",      previewBg: "linear-gradient(90deg,#0891b2,#1d4ed8)",    previewColor: "#fff" },
  { id: "violet-rose",   name: "Violeta",   previewBg: "linear-gradient(90deg,#7c3aed,#ec4899)",    previewColor: "#fff" },
  { id: "midnight",      name: "Noche",     previewBg: "linear-gradient(160deg,#1e1b4b,#0f172a)",   previewColor: "#c4b5fd", previewBorder: "rgba(139,92,246,0.6)" },
  { id: "neon-green",    name: "Neon",      previewBg: "#0a0e1a",                                   previewColor: "#00ff88", previewBorder: "#00ff88" },
  { id: "neon-red",      name: "Alerta",    previewBg: "#0d0010",                                   previewColor: "#ef4444", previewBorder: "#ef4444" },
  { id: "forest",        name: "Bosque",    previewBg: "linear-gradient(90deg,#065f46,#0d9488)",    previewColor: "#fff" },
  { id: "sunset",        name: "Atardecer", previewBg: "linear-gradient(90deg,#f97316,#fbbf24)",    previewColor: "#fff" },
  { id: "retro-yellow",  name: "Retro",     previewBg: "#fbbf24",                                   previewColor: "#1e293b" },
  { id: "minimal-white", name: "Blanco",    previewBg: "rgba(255,255,255,0.95)",                    previewColor: "#0f172a", previewBorder: "#cbd5e1" },
]

// ── CardSlotPanel — one independently-configurable card ──────────────────────

function CardSlotPanel({
  type,
  label,
  description,
  timingLabel,
  slot,
  onChange,
  disabled,
}: {
  type: "hook" | "stat" | "cta"
  label: string
  description: string
  timingLabel: string
  slot: CardSlotConfig
  onChange: (s: CardSlotConfig) => void
  disabled?: boolean
}) {
  const patch = (p: Partial<CardSlotConfig>) => onChange({ ...slot, ...p })

  return (
    <Card className={`transition-opacity ${slot.enabled ? "" : "opacity-60"}`}>
      <CardContent className="p-4 space-y-4">
        {/* Header: label + timing badge + description + enabled toggle */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{label}</span>
              <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{timingLabel} del video</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>
          </div>
          <Switch
            checked={slot.enabled}
            onCheckedChange={(v) => patch({ enabled: v })}
            disabled={disabled}
          />
        </div>

        {slot.enabled && (
          <>
            {/* Template style picker */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Estilo visual</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {CARD_STYLE_TEMPLATES.map((t) => {
                  const active = (slot.templateId ?? "dark-glass") === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => patch({ templateId: t.id })}
                      disabled={disabled}
                      title={t.name}
                      className={`relative rounded-lg h-12 flex flex-col items-center justify-center gap-0.5 transition-all overflow-hidden border-2 ${
                        active
                          ? "border-orange-500 ring-1 ring-orange-500/30 scale-[1.03]"
                          : "border-transparent hover:border-orange-400/40"
                      }`}
                      style={{
                        background: t.previewBg,
                        ...(t.previewBorder && !active ? { outline: `1px solid ${t.previewBorder}`, outlineOffset: "-1px" } : {}),
                      }}
                    >
                      {active && (
                        <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-orange-500 flex items-center justify-center">
                          <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                      <span className="text-[11px] font-extrabold leading-none" style={{ color: t.previewColor }}>Aa</span>
                      <span className="text-[8px] leading-none font-medium" style={{ color: `${t.previewColor}cc` }}>{t.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* AI toggle */}
            <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Generar texto con IA
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  La IA adapta el texto al guion de cada video
                </p>
              </div>
              <Switch
                checked={slot.useAi}
                onCheckedChange={(v) => patch({ useAi: v })}
                disabled={disabled}
              />
            </div>

            {/* Manual inputs — hook / cta */}
            {!slot.useAi && type !== "stat" && (
              <div className="space-y-2">
                <Label>{type === "hook" ? "Texto del hook" : "Texto del CTA"}</Label>
                <input
                  type="text"
                  value={slot.text ?? ""}
                  onChange={(e) => patch({ text: e.target.value })}
                  placeholder={type === "hook" ? "¿Sabías que el 73% falla en esto?" : "Seguime para más estrategias"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  maxLength={type === "hook" ? 80 : 60}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {(slot.text ?? "").length}/{type === "hook" ? 80 : 60}
                </p>
              </div>
            )}

            {/* Manual inputs — stat */}
            {!slot.useAi && type === "stat" && (
              <>
                <div className="space-y-2">
                  <Label>Número o porcentaje <span className="text-muted-foreground font-normal">(ej: 2.3M · 73% · +500)</span></Label>
                  <input
                    type="text"
                    value={slot.headline ?? ""}
                    onChange={(e) => patch({ headline: e.target.value })}
                    placeholder="73%"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-bold ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    maxLength={12}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contexto <span className="text-muted-foreground font-normal">(ej: de creadores ya usan IA)</span></Label>
                  <input
                    type="text"
                    value={slot.subtext ?? ""}
                    onChange={(e) => patch({ subtext: e.target.value })}
                    placeholder="de creadores ya usan IA"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    maxLength={40}
                    disabled={disabled}
                  />
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
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

// ── Card overlay preview (CSS approximation of each card type) ────────────────
function CardOverlayPreview({
  card,
}: {
  card: { type: "hook"|"stat"|"cta"; useAi: boolean; text?: string; headline?: string; subtext?: string; templateId?: string }
}) {
  const tpl = CARD_STYLE_TEMPLATES.find(t => t.id === (card.templateId ?? "dark-glass")) ?? CARD_STYLE_TEMPLATES[0]
  const label = card.useAi ? "IA adapta el texto" : undefined

  const base: React.CSSProperties = {
    background: tpl.previewBg,
    color: tpl.previewColor,
    borderRadius: "0.7rem",
    padding: "7px 10px",
    ...(tpl.previewBorder ? { border: `1.5px solid ${tpl.previewBorder}` } : {}),
  }

  if (card.type === "hook") return (
    <div style={base} className="text-[9px] font-bold leading-snug">
      {card.useAi
        ? <span style={{ color: `${tpl.previewColor}88` }} className="italic">"{label}"</span>
        : <span>{card.text || "Texto del hook"}</span>}
    </div>
  )

  if (card.type === "stat") return (
    <div style={{ ...base, textAlign: "center" }}>
      {card.useAi
        ? <p style={{ color: `${tpl.previewColor}88` }} className="text-[8px] italic">{label}</p>
        : <>
            <p className="text-[18px] font-black leading-none" style={{ fontFamily: "Montserrat, sans-serif" }}>{card.headline || "73%"}</p>
            <p className="text-[7px] font-semibold mt-0.5" style={{ color: `${tpl.previewColor}cc` }}>{card.subtext || "de creadores usan IA"}</p>
          </>}
    </div>
  )

  return (
    <div style={{ ...base, display: "flex", alignItems: "center", gap: 4 }} className="text-[9px] font-bold">
      {card.useAi
        ? <span style={{ color: `${tpl.previewColor}88` }} className="italic text-[8px]">{label}</span>
        : <span>{card.text || "Texto del CTA"}</span>}
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
  const { data: videos } = useGetVideos(undefined, { query: { refetchInterval: 8000 } as any })
  const { data: settings } = useGetSettings()
  const updateConfig = useUpdateCaptionConfig()
  const updateAutomation = useUpdateAutomation()
  const updateSettings = useUpdateSettings()

  // Lock the UI while any video is actively being processed so the user can't
  // change the template mid-render and get an inconsistent result.
  const isVideoProcessing = (videos ?? []).some(
    (v) => v.status === "generating" || (v as any).caption_status === "processing"
  )

  const [local, setLocal] = useState<Partial<CaptionConfig>>({})
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [videoEffects, setVideoEffects] = useState<VideoEffects>({ zoom: false, ai_broll: false, text_cards: false })
  const [dirty, setDirty] = useState(false)
  const [savingPresetId, setSavingPresetId] = useState<string | null>(null)
  // null = checking, true = available, false = unavailable
  const [browserEngineAvailable, setBrowserEngineAvailable] = useState<boolean | null>(null)

  // ── Caption rotation (multi-template selection for auto mode) ─────────────
  const [rotationEnabled, setRotationEnabled] = useState(false)
  const [rotationIds, setRotationIds] = useState<Set<string>>(new Set())
  const [rotationStrategy, setRotationStrategy] = useState("sequential")

  // ── Per-template overrides map ────────────────────────────────────────────
  // Stored as Record<templateId, Partial<CaptionTemplate>> so each template
  // remembers its own tweaks independently. Saved to DB as a JSON string in
  // caption_config.template_overrides. Auto-saved on every change (debounced).
  const [allTmplOverrides, setAllTmplOverrides] = useState<Record<string, Partial<CaptionTemplate>>>({})
  const overrideSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Multi-card config state (for text_cards effect) ─────────────────────
  const [localCards, setLocalCards] = useState<MultiCardConfig>(DEFAULT_MULTI_CARDS)
  const [savedCards, setSavedCards] = useState<MultiCardConfig | null>(null)
  const [savingCards, setSavingCards] = useState(false)
  // Derived: first enabled LOCAL card for the phone preview (live, reflects edits before saving)
  const previewCard: { type: "hook"|"stat"|"cta"; useAi: boolean; text?: string; headline?: string; subtext?: string; templateId?: string } | null =
    localCards.hook.enabled
      ? { type: "hook", useAi: localCards.hook.useAi, text: localCards.hook.text, templateId: localCards.hook.templateId }
    : localCards.stat.enabled
      ? { type: "stat", useAi: localCards.stat.useAi, headline: localCards.stat.headline, subtext: localCards.stat.subtext, templateId: localCards.stat.templateId }
    : localCards.cta.enabled
      ? { type: "cta",  useAi: localCards.cta.useAi,  text: localCards.cta.text, templateId: localCards.cta.templateId }
    : null
  // activeCardCount reflects what's actually saved (for the badge in the effects toggle)
  const activeCardCount = savedCards
    ? [savedCards.hook, savedCards.stat, savedCards.cta].filter(s => s.enabled).length
    : 0

  useEffect(() => {
    fetch("/api/captions/browser/status")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setBrowserEngineAvailable(d.available))
      .catch(() => setBrowserEngineAvailable(false))
  }, [])

  // Load saved multi-card config from API
  useEffect(() => {
    fetch("/api/cards/template")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { card_template: Record<string, unknown> | null } | null) => {
        if (!d?.card_template) return
        const ct = d.card_template
        if (ct.version === 2) {
          // New multi-card format
          const mc = ct as unknown as MultiCardConfig
          setLocalCards(mc)
          setSavedCards(mc)
        } else {
          // Legacy single-card format — migrate into the matching slot
          const legacy = ct as { type: "hook"|"stat"|"cta"; useAi: boolean; text?: string; headline?: string; subtext?: string }
          const mc: MultiCardConfig = {
            ...DEFAULT_MULTI_CARDS,
            [legacy.type]: {
              enabled: true,
              useAi: legacy.useAi,
              text: legacy.text ?? "",
              headline: legacy.headline ?? "",
              subtext: legacy.subtext ?? "",
            },
          }
          setLocalCards(mc)
          setSavedCards(mc)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (config && Object.keys(local).length === 0) {
      setLocal(config)
      // Restore rotation state
      const savedIds = (config.selected_preset_ids as string[] | null) ?? []
      if (savedIds.length > 0) {
        setRotationEnabled(true)
        setRotationIds(new Set(savedIds))
      }
      setRotationStrategy((config.caption_rotation_strategy as string | null) ?? "sequential")
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

  useEffect(() => {
    if (settings?.video_effects) setVideoEffects(settings.video_effects)
  }, [settings])

  const handleToggleEffect = (key: keyof VideoEffects, value: boolean) => {
    const next = { ...videoEffects, [key]: value }
    setVideoEffects(next)
    updateSettings.mutate({ data: { video_effects: next } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() }),
      onError: () => {
        setVideoEffects(videoEffects) // revert
        toast({ title: "Error", description: "No se pudo guardar los efectos.", variant: "destructive" })
      },
    })
  }

  const saveCardConfig = async () => {
    setSavingCards(true)
    try {
      const r = await fetch("/api/cards/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_template: localCards }),
      })
      if (!r.ok) throw new Error("save failed")
      setSavedCards(localCards)
      const n = [localCards.hook, localCards.stat, localCards.cta].filter(s => s.enabled).length
      toast({
        title: "Configuración guardada ✓",
        description: n > 0
          ? `${n} card${n > 1 ? "s" : ""} activa${n > 1 ? "s" : ""} en el próximo video.`
          : "Se desactivaron todas las cards.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo guardar la configuración.", variant: "destructive" })
    } finally {
      setSavingCards(false)
    }
  }

  const set = <K extends keyof CaptionConfig>(key: K, value: CaptionConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  // ── Template override helpers (browser engine only) ───────────────────────
  // Active base template (if browser engine is selected)
  const activeTmpl = local.template_id
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
          description: `Plantilla "${template.name}" aplicada a los próximos videos.`,
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

  const saveRotation = (ids: Set<string>, strategy: string) => {
    updateConfig.mutate(
      { data: { selected_preset_ids: Array.from(ids), caption_rotation_strategy: strategy } as any },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCaptionConfigQueryKey() }) }
    )
  }

  const handleRotationToggle = (enabled: boolean) => {
    setRotationEnabled(enabled)
    if (!enabled) {
      setRotationIds(new Set())
      saveRotation(new Set(), rotationStrategy)
    }
  }

  const toggleRotationTemplate = (id: string) => {
    if (isVideoProcessing) return
    const next = new Set(rotationIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setRotationIds(next)
    // If the user removed the last template, turn rotation off automatically
    if (next.size === 0) setRotationEnabled(false)
    saveRotation(next, rotationStrategy)
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
            Studio de Efectos
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Elige un estilo y se aplica automáticamente a tus videos.
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
            <strong>Video en proceso.</strong> No puedes cambiar la plantilla ni los ajustes mientras un video se está generando o aplicando captions. Espera a que termine.
          </span>
        </div>
      )}

      {/* ── 5-col layout: 4 cols content · 1 col preview sticky ──────────── */}
      <div className="grid grid-cols-5 gap-8 items-start">
        <div className="col-span-4 space-y-6">

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

      {/* ── Captions: rotation banner ─────────────────────────────────────── */}
      {captionsEnabled && (
      <Card className={`border-2 ${rotationEnabled ? "border-primary/40 bg-primary/5" : "border-dashed"}`}>
        <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${rotationEnabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <Shuffle className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-base">Rotar captions en modo automático</p>
              <p className="text-sm text-muted-foreground max-w-md">
                {rotationEnabled
                  ? rotationIds.size > 0
                    ? `${rotationIds.size} plantilla${rotationIds.size !== 1 ? "s" : ""} en rotación. Haz clic en las plantillas para agregarlas o quitarlas.`
                    : "Selecciona al menos una plantilla. Si no eliges ninguna se usa siempre la misma."
                  : "Activa para que cada video use una plantilla diferente de forma automática."}
              </p>
              {rotationEnabled && rotationIds.size === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <span>⚠</span>{" "}
                  {local.template_id
                    ? "Sin selección se usará siempre la plantilla activa por defecto."
                    : "Sin plantillas seleccionadas y sin plantilla por defecto, los videos no recibirán estilo de captions."}
                </p>
              )}
              {rotationEnabled && (
                <div className="flex gap-1.5 mt-2">
                  {[{ value: "sequential", label: "Secuencial" }, { value: "random", label: "Aleatorio" }].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { setRotationStrategy(value); saveRotation(rotationIds, value) }}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                        rotationStrategy === value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Switch checked={rotationEnabled} onCheckedChange={handleRotationToggle} disabled={isVideoProcessing} className="shrink-0" />
        </CardContent>
      </Card>
      )}

      {/* ── Captions: plantillas + ajustes ───────────────────────────────── */}
      {captionsEnabled && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-display font-bold">Plantillas</h2>
              {browserEngineAvailable === false && (
                <span className="w-2 h-2 rounded-full bg-amber-400" title="Canvas no disponible — contactá soporte" />
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              El preview es exactamente lo que queda en el video final. Lo que ves es lo que se renderiza.
            </p>
            <div className="grid grid-cols-4 gap-3">
              {BROWSER_CAPTION_TEMPLATES.map((tmpl) => (
                <BrowserTemplateCard
                  key={tmpl.id}
                  template={allTmplOverrides[tmpl.id] ? { ...tmpl, ...allTmplOverrides[tmpl.id] } : tmpl}
                  selected={rotationEnabled ? rotationIds.has(tmpl.id) : local.template_id === tmpl.id}
                  saving={!rotationEnabled && savingPresetId === tmpl.id}
                  onClick={() => rotationEnabled ? toggleRotationTemplate(tmpl.id) : (!isVideoProcessing && applyBrowserTemplate(tmpl))}
                />
              ))}
            </div>
          </div>

          {/* Browser template advanced settings */}
          {!rotationEnabled && mergedTmpl && (
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
                Ajusta los valores de la plantilla <strong>{activeTmpl?.name}</strong>. El preview se actualiza en tiempo real y los cambios se aplican al video final.
              </p>
              <Card>
                <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>
                      Tamaño de letra:&nbsp;
                      <span className="text-primary font-bold">{ov("fontSize")}px</span>
                      {currentOverrides.fontSize !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider min={60} max={220} step={5} value={[ov("fontSize") ?? 88]} onValueChange={([v]) => setOverride("fontSize", v)} disabled={isVideoProcessing} className="mt-3" />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>60 — compacto</span><span>Default: {activeTmpl?.fontSize}px</span><span>220 — máximo</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Palabras por línea:&nbsp;
                      <span className="text-primary font-bold">{ov("wordsPerLine")}</span>
                      {currentOverrides.wordsPerLine !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider min={1} max={6} step={1} value={[ov("wordsPerLine") ?? 3]} onValueChange={([v]) => setOverride("wordsPerLine", v)} disabled={isVideoProcessing} className="mt-3" />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>1 — una palabra</span><span>Default: {activeTmpl?.wordsPerLine}</span><span>6 — frase larga</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Grosor del outline:&nbsp;
                      <span className="text-primary font-bold">{ov("outlineWidth")}px</span>
                      {currentOverrides.outlineWidth !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider min={0} max={20} step={1} value={[ov("outlineWidth") ?? 0]} onValueChange={([v]) => setOverride("outlineWidth", v)} disabled={isVideoProcessing} className="mt-3" />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0 — sin outline</span><span>Default: {activeTmpl?.outlineWidth}px</span><span>20 — trazo grueso</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Opacidad de palabras inactivas:&nbsp;
                      <span className="text-primary font-bold">{Math.round((ov("inactiveOpacity") ?? 1) * 100)}%</span>
                      {currentOverrides.inactiveOpacity !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <Slider min={0} max={1} step={0.05} value={[ov("inactiveOpacity") ?? 1]} onValueChange={([v]) => setOverride("inactiveOpacity", Math.round(v * 20) / 20)} disabled={isVideoProcessing} className="mt-3" />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0% — invisibles</span><span>Default: {Math.round((activeTmpl?.inactiveOpacity ?? 1) * 100)}%</span><span>100% — igual que activa</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Color de texto
                      {currentOverrides.primaryColor !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={ov("primaryColor") ?? "#FFFFFF"} onChange={(e) => setOverride("primaryColor", e.target.value)} disabled={isVideoProcessing} className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5" />
                      <div>
                        <p className="text-sm font-mono">{ov("primaryColor")}</p>
                        <p className="text-[10px] text-muted-foreground">Default: {activeTmpl?.primaryColor}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Color de palabra activa
                      {currentOverrides.activeWordColor !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={ov("activeWordColor") ?? "#FFFFFF"} onChange={(e) => setOverride("activeWordColor", e.target.value)} disabled={isVideoProcessing} className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5" />
                      <div>
                        <p className="text-sm font-mono">{ov("activeWordColor")}</p>
                        <p className="text-[10px] text-muted-foreground">Default: {activeTmpl?.activeWordColor}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Color del outline
                      {currentOverrides.outlineColor !== undefined && (
                        <span className="ml-1 text-[10px] text-violet-500">(modificado)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={ov("outlineColor") ?? "#000000"} onChange={(e) => setOverride("outlineColor", e.target.value)} disabled={isVideoProcessing} className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5" />
                      <div>
                        <p className="text-sm font-mono">{ov("outlineColor")}</p>
                        <p className="text-[10px] text-muted-foreground">Default: {activeTmpl?.outlineColor}</p>
                      </div>
                    </div>
                  </div>
                  <div className="sm:col-span-2 flex items-start gap-2 p-3 rounded-lg bg-muted/40">
                    <span className="text-base mt-0.5 shrink-0">✥</span>
                    <div>
                      <p className="text-xs font-medium mb-0.5">Posición vertical y margen</p>
                      <p className="text-xs text-muted-foreground leading-snug">Arrastrá el preview del celular para mover los captions.</p>
                      <p className="text-xs text-primary font-medium mt-1">
                        ↕ {Math.round(local.y_position ?? (activeTmpl?.yPercent ?? 75))}% &nbsp;·&nbsp; ← {Math.round(local.margin_x ?? ((activeTmpl?.marginXPercent ?? 5) * 1080 / 100))}px
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Ajustes avanzados (sin plantilla canvas activa) */}
          {!rotationEnabled && !activeTmpl && (
            <div>
              <h2 className="text-xl font-display font-bold mb-4">Ajustes avanzados</h2>
              <div className="relative">
                {isVideoProcessing && (
                  <div className="absolute inset-0 z-10 rounded-xl backdrop-blur-[2px] bg-background/70 flex flex-col items-center justify-center gap-2 pointer-events-auto">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                    <p className="text-sm font-semibold text-center px-6">Ajustes bloqueados</p>
                    <p className="text-xs text-muted-foreground text-center px-8 leading-snug">Espera a que el video termine de procesarse.</p>
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
                      <Label>Margen lateral: <span className="text-primary font-bold">{Math.round(local.margin_x ?? 60)}px</span></Label>
                      <Slider min={0} max={300} step={5} value={[local.margin_x ?? 60]} onValueChange={([v]) => set("margin_x", v)} className="mt-3" />
                      <div className="flex justify-between text-[10px] text-muted-foreground"><span>0 — sin margen</span><span>300 — centrado</span></div>
                    </div>
                    <div className="space-y-2">
                      <Label>Tamaño de letra: <span className="text-primary font-bold">{local.font_size ?? 88}px</span></Label>
                      <Slider min={60} max={220} step={5} value={[local.font_size ?? 88]} onValueChange={([v]) => set("font_size", v)} className="mt-3" />
                      <div className="flex justify-between text-[10px] text-muted-foreground"><span>60 — compacto</span><span>220 — máximo impacto</span></div>
                    </div>
                    <div className="space-y-2">
                      <Label>
                        Espacio entre líneas: <span className="text-primary font-bold">
                          {{ 1.0: "Súper ajustado", 1.1: "Ajustado", 1.2: "Normal", 1.4: "Amplio", 1.7: "Muy amplio", 2.0: "Máximo" }[String(local.line_spacing_factor ?? 1.1)] ?? `${local.line_spacing_factor ?? 1.1}×`}
                        </span>
                      </Label>
                      <Slider min={1.0} max={2.0} step={0.1} value={[local.line_spacing_factor ?? 1.1]} onValueChange={([v]) => set("line_spacing_factor", Math.round(v * 10) / 10)} className="mt-3" />
                      <div className="flex justify-between text-[10px] text-muted-foreground"><span>1.0 — líneas pegadas</span><span>2.0 — muy separadas</span></div>
                    </div>
                    <div className="space-y-2">
                      <Label>Palabras por línea: <span className="text-primary font-bold">{local.words_per_line ?? 3}</span></Label>
                      <Slider min={1} max={6} step={1} value={[local.words_per_line ?? 3]} onValueChange={([v]) => set("words_per_line", v)} className="mt-3" />
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
                        <input type="color" value={local.primary_color ?? "#FFFFFF"} onChange={(e) => set("primary_color", e.target.value)} className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5" />
                        <span className="text-sm text-muted-foreground font-mono">{local.primary_color ?? "#FFFFFF"}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Color de palabra activa</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={local.active_word_color ?? "#FFE600"} onChange={(e) => set("active_word_color", e.target.value)} className="w-10 h-10 rounded-md border cursor-pointer bg-background p-0.5" />
                        <span className="text-sm text-muted-foreground font-mono">{local.active_word_color ?? "#FFE600"}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Video Effects ─────────────────────────────────────────────────── */}
      <Card className={`border-2 ${(videoEffects.zoom || videoEffects.ai_broll || videoEffects.text_cards) ? "border-primary/40 bg-primary/5" : "border-dashed"}`}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${(videoEffects.zoom || videoEffects.ai_broll || videoEffects.text_cards) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-base">Efectos de video</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Se aplican automáticamente a cada video después de que HeyGen termina de renderizar. Los cambios afectan los próximos videos.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 pt-1">
            {/* Zoom */}
            <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="mt-0.5 flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">Zoom / Ken Burns</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Zoom progresivo sincronizado con el guion</p>
              </div>
              <Switch
                checked={videoEffects.zoom}
                onCheckedChange={(v) => handleToggleEffect("zoom", v)}
                disabled={updateSettings.isPending || isVideoProcessing}
                className="shrink-0 mt-0.5"
              />
            </div>
            {/* AI B-roll */}
            <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="mt-0.5 flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">B-Roll IA</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Inserta imágenes fotorrealistas sincronizadas al guion</p>
              </div>
              <Switch
                checked={videoEffects.ai_broll}
                onCheckedChange={(v) => handleToggleEffect("ai_broll", v)}
                disabled={updateSettings.isPending || isVideoProcessing}
                className="shrink-0 mt-0.5"
              />
            </div>
            {/* Text cards */}
            <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="mt-0.5 flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">Cards de texto</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Stats, hooks y CTAs animados sobre el video</p>
              </div>
              <Switch
                checked={videoEffects.text_cards}
                onCheckedChange={(v) => handleToggleEffect("text_cards", v)}
                disabled={updateSettings.isPending || isVideoProcessing}
                className="shrink-0 mt-0.5"
              />
            </div>
          </div>
        </CardContent>
      </Card>

          {/* ── Card Configuration (visible when text_cards effect is enabled) ── */}
          {videoEffects.text_cards && (
            <div className="space-y-4">
              {/* Header */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-display font-bold">Configuración de Cards</h2>
                  {activeCardCount > 0 && (
                    <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded-full font-medium">
                      {activeCardCount} activa{activeCardCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Activá una o más cards. Cada tipo aparece en un momento distinto del video — las captions se pausan mientras la card está visible.
                </p>
              </div>

              <CardSlotPanel
                type="hook"
                label="🎣 Hook"
                description="Genera curiosidad o presenta el problema al inicio del video"
                timingLabel="~6%"
                slot={localCards.hook}
                onChange={(s) => setLocalCards((c) => ({ ...c, hook: s }))}
                disabled={isVideoProcessing}
              />
              <CardSlotPanel
                type="stat"
                label="📊 Dato clave"
                description="Resalta un número o métrica en el punto medio del video"
                timingLabel="~44%"
                slot={localCards.stat}
                onChange={(s) => setLocalCards((c) => ({ ...c, stat: s }))}
                disabled={isVideoProcessing}
              />
              <CardSlotPanel
                type="cta"
                label="📣 CTA"
                description="Invitación directa a seguir o guardar al final del video"
                timingLabel="~81%"
                slot={localCards.cta}
                onChange={(s) => setLocalCards((c) => ({ ...c, cta: s }))}
                disabled={isVideoProcessing}
              />

              <Button
                onClick={saveCardConfig}
                disabled={savingCards || isVideoProcessing}
                className="w-full gap-2"
              >
                {savingCards ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {savingCards ? "Guardando..." : "Guardar configuración"}
              </Button>
            </div>
          )}

        </div>{/* end col-span-4 */}

        {/* 5th col: phone preview — sticky, flota mientras el usuario scrollea */}
        <div className="col-span-1 sticky top-6 self-start space-y-2">
          <p className="text-[11px] font-semibold text-center text-muted-foreground uppercase tracking-widest mb-2">
            Vista previa
          </p>
          <div className="relative">
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
            {videoEffects.text_cards && previewCard && (
              <div
                className="absolute pointer-events-none"
                style={{ top: 274, left: "50%", transform: "translateX(-50%)", width: 180 }}
              >
                <CardOverlayPreview card={previewCard} />
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            <span className="text-violet-500 font-medium">WYSIWYG</span> — lo que ves se renderiza.
          </p>
          {videoEffects.text_cards && activeCardCount > 0 && (
            <p className="text-[10px] text-orange-500 dark:text-orange-400 text-center font-medium">
              + {activeCardCount} card{activeCardCount > 1 ? "s" : ""} activa{activeCardCount > 1 ? "s" : ""}
            </p>
          )}
        </div>

      </div>{/* end 5-col grid */}
    </div>
  )
}
