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
import { BookOpen, Play, Sparkles } from "lucide-react"

// ── Cambia esta URL por la del video de bienvenida cuando esté listo ──────────
const WELCOME_VIDEO_URL = ""
// e.g. "https://www.youtube.com/embed/XXXXXXXXXXX?rel=0&modestbranding=1"

const STORAGE_KEY = "reelsona_welcome_dismissed"

export function WelcomeModal() {
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)
  const [, navigate] = useLocation()

  // Open on first visit — only when the key is not stored
  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY)
    if (!dismissed) setOpen(true)
  }, [])

  function handleClose() {
    if (dontShow) localStorage.setItem(STORAGE_KEY, "1")
    setOpen(false)
  }

  function handleStartCourse() {
    if (dontShow) localStorage.setItem(STORAGE_KEY, "1")
    setOpen(false)
    navigate("/course")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-xl p-0 overflow-hidden gap-0">
        {/* Header gradient strip */}
        <div className="bg-gradient-to-br from-primary/90 to-purple-700 px-6 pt-6 pb-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest opacity-80">Bienvenido a Reelsona</span>
          </div>
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-2xl font-display font-bold text-white leading-tight">
              Tu máquina de contenido<br />con IA está lista
            </DialogTitle>
            <DialogDescription className="text-white/75 text-sm">
              Mira el video de introducción y empieza el curso guiado para tener tu primer Reel publicado hoy.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Video area */}
        <div className="mx-6 -mt-3 rounded-xl overflow-hidden border border-border shadow-md">
          {WELCOME_VIDEO_URL ? (
            <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
              <iframe
                src={WELCOME_VIDEO_URL}
                title="Video de bienvenida a Reelsona"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            </div>
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
        <div className="px-6 py-5 space-y-4">
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
          <div className="flex items-center justify-between">
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
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Ahora no
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
