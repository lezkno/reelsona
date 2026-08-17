/**
 * PremiumModal — reusable paywall dialog.
 *
 * Matches the NoAccessWall standard: same title, description and CTA
 * so every access gate looks identical across the app.
 * Title, description, CTA label and href are configurable for edge cases.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Lock, ArrowRight } from "lucide-react"
import { Link } from "wouter"

interface PremiumModalProps {
  open:         boolean
  onClose:      () => void
  title?:       string
  description?: string
  ctaLabel?:    string
  ctaHref?:     string
}

export function PremiumModal({
  open,
  onClose,
  title       = "Función disponible con plan activo",
  description = "Activa un plan de Reelsona para acceder a esta función. Tus proyectos y recursos siguen guardados.",
  ctaLabel    = "Ver planes",
  ctaHref     = "/billing",
}: PremiumModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-5 h-5 text-muted-foreground shrink-0" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button asChild className="gap-2 w-full sm:w-auto" onClick={onClose}>
            <Link href={ctaHref}>{ctaLabel} <ArrowRight className="w-4 h-4" /></Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
