import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Play, Loader2, Instagram, Sparkles, Check, ChevronUp } from "lucide-react"
import type { LucideIcon } from "lucide-react"

interface VideoModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle: string
  headerIcon: LucideIcon
  videoSrc: string | null | undefined
  fallbackSrc?: string | null | undefined
  thumbnailSrc?: string | null | undefined
  // Copy section (optional — hidden when not provided)
  caption?: string | null
  hashtags?: string | null
  onSaveCaption?: (caption: string, hashtags: string) => Promise<void>
  onRegenerateCaption?: () => Promise<{ caption: string; hashtags: string }>
  // Footer actions
  onApprove?: () => void
  approveLabel?: string
  isApproving?: boolean
  dismissLabel?: string
}

/**
 * Unified video preview modal.
 *
 * Mobile:  full-screen — video fills all available space; collapsible bottom
 *          panel shows title (always) and caption/hashtags (on tap).
 * Desktop: [video col left 224px] | [header → caption/hashtags → footer right]
 */
export function VideoModal({
  open,
  onClose,
  title,
  subtitle,
  headerIcon: Icon,
  videoSrc,
  fallbackSrc,
  thumbnailSrc,
  caption,
  hashtags,
  onSaveCaption,
  onRegenerateCaption,
  onApprove,
  approveLabel = "Aprobar y Publicar en IG",
  isApproving = false,
  dismissLabel = "Cerrar",
}: VideoModalProps) {
  const [useFallback, setUseFallback] = useState(false)
  const [localCaption, setLocalCaption] = useState(caption ?? "")
  const [localHashtags, setLocalHashtags] = useState(hashtags ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [infoExpanded, setInfoExpanded] = useState(false)

  // Sync local state when the modal opens or props change
  useEffect(() => {
    if (open) {
      setLocalCaption(caption ?? "")
      setLocalHashtags(hashtags ?? "")
      setUseFallback(false)
      setInfoExpanded(false)
    }
  }, [open, caption, hashtags])

  const isDirty =
    localCaption.trim() !== (caption ?? "").trim() ||
    localHashtags.trim() !== (hashtags ?? "").trim()

  const hasCopy = onSaveCaption !== undefined || onRegenerateCaption !== undefined

  const src = (useFallback ? fallbackSrc : videoSrc) ?? videoSrc ?? null

  const handleSave = async () => {
    if (!onSaveCaption) return
    setIsSaving(true)
    try { await onSaveCaption(localCaption, localHashtags) }
    finally { setIsSaving(false) }
  }

  const handleRegenerate = async () => {
    if (!onRegenerateCaption) return
    setIsRegenerating(true)
    try {
      const result = await onRegenerateCaption()
      setLocalCaption(result.caption)
      setLocalHashtags(result.hashtags)
    } finally { setIsRegenerating(false) }
  }

  // Caption + hashtags block — shared between mobile and desktop
  const copySection = hasCopy && (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Caption para Instagram
        </p>
        <Textarea
          value={localCaption}
          onChange={(e) => setLocalCaption(e.target.value)}
          rows={4}
          disabled={isRegenerating}
          className="text-sm resize-none"
          placeholder="Caption que se publicará junto al video..."
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Hashtags
        </p>
        <Textarea
          value={localHashtags}
          onChange={(e) => setLocalHashtags(e.target.value)}
          rows={3}
          disabled={isRegenerating}
          className="text-sm resize-none font-mono text-violet-700"
          placeholder="#hashtag1 #hashtag2 ..."
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {onRegenerateCaption && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={isRegenerating || isSaving}
            className="gap-1.5 text-xs"
          >
            {isRegenerating ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generando...</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5 text-violet-600" />Regenerar con IA</>
            )}
          </Button>
        )}

        {onSaveCaption && isDirty && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isRegenerating}
            className="gap-1.5 text-xs ml-auto bg-violet-700 hover:bg-violet-800 text-white"
          >
            {isSaving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Guardando...</>
            ) : (
              <><Check className="w-3.5 h-3.5" />Guardar cambios</>
            )}
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="
          p-0 overflow-hidden gap-0
          flex flex-col sm:flex-row
          /* mobile: full-screen, no border radius */
          w-full max-w-full h-[100dvh] rounded-none
          /* desktop: centered card */
          sm:w-[95vw] sm:max-w-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl
        "
      >
        {/* ── Video panel ───────────────────────────────────────────────────── */}
        {/*
          Mobile:  fills all space above the bottom panel (flex-1)
          Desktop: fixed 224px column that stretches full height
        */}
        <div
          className="
            relative bg-black overflow-hidden
            flex-1 min-h-0
            sm:flex-none sm:w-56 sm:self-stretch
            flex items-center justify-center
          "
        >
          {src ? (
            <video
              key={src}
              src={src}
              poster={thumbnailSrc ?? undefined}
              controls
              playsInline
              preload="auto"
              onError={() => {
                if (!useFallback && fallbackSrc && fallbackSrc !== videoSrc)
                  setUseFallback(true)
              }}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-white/40 py-10">
              <Play className="w-8 h-8 opacity-40" />
              <p className="text-xs">Video no disponible</p>
            </div>
          )}
        </div>

        {/* ── Desktop right column ──────────────────────────────────────────── */}
        <div className="hidden sm:flex flex-col flex-1 min-h-0 overflow-hidden">

          <DialogHeader className="bg-violet-700 px-5 py-3 shrink-0 rounded-none">
            <DialogTitle className="text-white flex items-center gap-2 text-base font-bold leading-snug">
              <Icon className="w-4 h-4 shrink-0" />
              <span className="line-clamp-2">{title}</span>
            </DialogTitle>
            <p className="text-violet-200 text-xs mt-0.5 leading-snug">{subtitle}</p>
          </DialogHeader>

          {hasCopy && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {copySection}
            </div>
          )}

          <div className={`px-5 py-4 flex flex-wrap gap-2 items-center${hasCopy ? " border-t" : " mt-auto"}`}>
            <Button variant="outline" onClick={onClose} disabled={isApproving} className="w-auto">
              {dismissLabel}
            </Button>
            {onApprove && (
              <Button
                onClick={onApprove}
                disabled={isApproving}
                className="gap-2 bg-violet-700 hover:bg-violet-800 text-white border-transparent ml-auto"
              >
                {isApproving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Publicando...</>
                ) : (
                  <><Instagram className="w-4 h-4" />{approveLabel}</>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* ── Mobile bottom panel ───────────────────────────────────────────── */}
        {/*
          Always shows a compact handle bar with title + chevron.
          Tapping the bar expands a scrollable panel with caption/hashtags.
          Footer buttons (Cerrar / Publicar) are always visible below the handle.
        */}
        <div className="sm:hidden shrink-0 bg-white flex flex-col">

          {/* Handle — always visible, tappable to expand */}
          <button
            type="button"
            className="w-full px-4 py-3.5 flex items-center gap-2.5 text-left border-t border-gray-100 active:bg-gray-50 transition-colors"
            onClick={() => setInfoExpanded((v) => !v)}
            aria-expanded={infoExpanded}
          >
            <Icon className="w-4 h-4 text-violet-600 shrink-0" />
            <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{title}</span>
            {hasCopy && (
              <ChevronUp
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                  infoExpanded ? "rotate-0" : "rotate-180"
                }`}
              />
            )}
          </button>

          {/* Expandable copy section */}
          {hasCopy && (
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                infoExpanded ? "max-h-[55vh]" : "max-h-0"
              }`}
            >
              <div className="overflow-y-auto max-h-[55vh] px-4 pt-1 pb-4 border-t border-gray-100">
                {copySection}
              </div>
            </div>
          )}

          {/* Footer — always visible */}
          <div className="px-4 py-3 flex gap-2 border-t border-gray-100">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isApproving}
              className="flex-1"
            >
              {dismissLabel}
            </Button>
            {onApprove && (
              <Button
                onClick={onApprove}
                disabled={isApproving}
                className="flex-1 gap-2 bg-violet-700 hover:bg-violet-800 text-white border-transparent"
              >
                {isApproving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Publicando...</>
                ) : (
                  <><Instagram className="w-4 h-4" />{approveLabel}</>
                )}
              </Button>
            )}
          </div>

        </div>

      </DialogContent>
    </Dialog>
  )
}
