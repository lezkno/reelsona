import * as React from "react"
import { useState, useEffect } from "react"
import { useLocation } from "wouter"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { BookOpen, Play } from "lucide-react"
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"

const WELCOME_VIDEO_URL = "/welcome-video.mp4"

const STORAGE_KEY = "reelsona_welcome_dismissed"

export function WelcomeModal() {
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useGetSettings()
  const { mutate: updateSettings } = useUpdateSettings()

  // Track whether we've already made the open/close decision for this session.
  // Without this guard, any settings invalidation (e.g. toggling video effects)
  // re-runs the effect and can re-open the modal if welcome_dismissed is still false.
  const hasChecked = React.useRef(false)

  // Open on first visit — use server-side flag, fall back to localStorage while loading
  useEffect(() => {
    if (hasChecked.current) return  // Only decide once per session
    if (isLoading) return           // Wait until we have an answer

    hasChecked.current = true       // Lock — no more re-evaluations

    if (settings) {
      // Server value is authoritative
      if (!settings.welcome_dismissed) {
        setOpen(true)
      }
    } else {
      // Settings not yet available — fall back to localStorage
      const dismissed = localStorage.getItem(STORAGE_KEY)
      if (!dismissed) setOpen(true)
    }
  }, [isLoading, settings])

  // Allow programmatic opening from other parts of the app (e.g. Settings page)
  useEffect(() => {
    function handleOpenEvent() {
      setDontShow(false)
      setOpen(true)
    }
    window.addEventListener("open-welcome-modal", handleOpenEvent)
    return () => window.removeEventListener("open-welcome-modal", handleOpenEvent)
  }, [])

  function persistDismissal() {
    // Always persist to localStorage as fast local cache
    localStorage.setItem(STORAGE_KEY, "1")
    // Persist to server account so it's remembered across devices
    updateSettings(
      { data: { welcome_dismissed: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })
        },
      }
    )
  }

  function handleClose() {
    if (dontShow) persistDismissal()
    setOpen(false)
  }

  function handleStartCourse() {
    if (dontShow) persistDismissal()
    setOpen(false)
    navigate("/course")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl p-0 overflow-hidden gap-0 max-h-[90vh] overflow-y-auto">
        {/* Header gradient strip */}
        <div className="bg-gradient-to-br from-primary/90 to-purple-700 px-4 sm:px-6 pt-6 pb-5 text-white">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Reelsona" className="w-16 h-16 object-contain drop-shadow-lg" />
          </div>
          <DialogHeader className="space-y-1 text-center">
            <DialogTitle className="text-2xl font-display font-bold text-white leading-tight">
              Tu máquina de contenido con IA está lista
            </DialogTitle>
            <DialogDescription className="text-white/75 text-sm">
              Mira el video de introducción y empieza el curso guiado para tener tu primer Reel publicado hoy.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Video area */}
        <div className="mx-3 sm:mx-6 -mt-3 rounded-xl overflow-hidden border border-border shadow-md">
          {WELCOME_VIDEO_URL ? (
            <video
              src={WELCOME_VIDEO_URL}
              controls
              playsInline
              preload="metadata"
              className="w-full block"
            />
          ) : (
            /* Placeholder mientras no hay video */
            <div className="aspect-video bg-gradient-to-br from-muted/60 to-muted flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Play className="w-6 h-6 text-primary fill-primary/30" />
              </div>
              <p className="text-sm font-medium">Video de introducción próximamente</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-5 space-y-4">
          {/* Steps summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { num: "1", text: "Conecta APIs y avatar" },
              { num: "2", text: "Genera tu estrategia" },
              { num: "3", text: "Publica tu primer Reel" },
            ].map(({ num, text }) => (
              <div key={num} className="rounded-lg bg-muted/50 border border-border px-2 py-2.5">
                <span className="block text-xs font-bold text-primary mb-0.5">{num}</span>
                <span className="text-[11px] text-muted-foreground leading-tight">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <Button
            className="w-full gap-2 text-sm font-semibold h-10"
            onClick={handleStartCourse}
          >
            <BookOpen className="w-4 h-4" />
            Comenzar curso de implementación
          </Button>

          {/* Don't show again + skip */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="dont-show"
                checked={dontShow}
                onCheckedChange={(v) => setDontShow(Boolean(v))}
              />
              <Label htmlFor="dont-show" className="text-xs text-muted-foreground cursor-pointer select-none">
                No volver a mostrar
              </Label>
            </div>
            <button
              onClick={handleClose}
              className="min-h-[44px] px-3 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Ahora no
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
