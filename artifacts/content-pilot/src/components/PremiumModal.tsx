/**
 * PremiumModal — reusable paywall dialog.
 *
 * Use whenever a gated action is attempted without an active plan.
 * Title, description, CTA label and href are all configurable.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
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
  title       = "Función Premium",
  description = "Necesitas un plan activo de Reelsona para usar esta función.",
  ctaLabel    = "Ver planes",
  ctaHref     = "/billing",
}: PremiumModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-primary shrink-0" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button asChild className="w-full sm:w-auto" onClick={onClose}>
            <Link href={ctaHref}>{ctaLabel} →</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
