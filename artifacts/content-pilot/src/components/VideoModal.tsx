import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Play, Loader2, Instagram, Sparkles, Check } from "lucide-react"
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
 * Mobile: [video] → [header] → [caption/hashtags] → [footer]
 * Desktop: [video col left] | [header → caption/hashtags → footer right]
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

  // Sync local state when the modal opens or props change
  useEffect(() => {
    if (open) {
      setLocalCaption(caption ?? "")
      setLocalHashtags(hashtags ?? "")
      setUseFallback(false)
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

  // Reusable header markup — rendered in both mobile and desktop slots
  const headerInner = (
    <>
      <DialogTitle className="text-white flex items-center gap-2 text-base font-bold leading-snug">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="line-clamp-2">{title}</span>
      </DialogTitle>
      <p className="text-violet-200 text-xs mt-0.5 leading-snug">{subtitle}</p>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/*
        Layout:
          mobile  → flex-col: video | header | copy | footer
          desktop → flex-row: [video col w-56] | [header + copy + footer]
        The DialogTitle is only in the desktop slot; on mobile we render
        a visually identical div so there is exactly one DialogTitle in the DOM.
      */}
      <DialogContent className="p-0 rounded-2xl overflow-hidden w-[95vw] max-w-[95vw] sm:max-w-2xl flex flex-col sm:flex-row gap-0 max-h-[90dvh]">

        {/* ── Video column ──────────────────────────────────────────────────── */}
        {/* mobile: full-width, height capped; desktop: fixed w-56, stretches full height */}
        <div className="relative bg-black shrink-0 sm:w-56 overflow-hidden
                        max-h-[42vh] sm:max-h-none sm:self-stretch
                        flex items-center justify-center">
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

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* Violet header — desktop: uses DialogHeader/DialogTitle for a11y */}
          <DialogHeader className="bg-violet-700 px-5 py-3 shrink-0 hidden sm:block rounded-none">
            {headerInner}
          </DialogHeader>
          {/* Violet header — mobile: purely visual, no DialogTitle duplication */}
          <div className="bg-violet-700 px-5 py-3 shrink-0 sm:hidden">
            <p className="text-white text-sm font-bold flex items-center gap-2 leading-snug line-clamp-2">
              <Icon className="w-4 h-4 shrink-0" />
              {title}
            </p>
            <p className="text-violet-200 text-xs mt-0.5 leading-snug">{subtitle}</p>
          </div>

          {/* Caption + hashtags ─────────────────────────────────────────────── */}
          {hasCopy && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">

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

              {/* Regenerate + Save row */}
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
          )}

          {/* Footer ────────────────────────────────────────────────────────── */}
          <div className={`px-5 py-4 flex gap-2 flex-col sm:flex-row items-stretch sm:items-center${hasCopy ? " border-t" : " mt-auto"}`}>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isApproving}
              className="w-full sm:w-auto"
            >
              {dismissLabel}
            </Button>

            {onApprove && (
              <Button
                onClick={onApprove}
                disabled={isApproving}
                className="w-full sm:w-auto gap-2 bg-violet-700 hover:bg-violet-800 text-white border-transparent sm:ml-auto"
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
