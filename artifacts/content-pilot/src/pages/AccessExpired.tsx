/**
 * /access-expired
 *
 * Shown to authenticated users whose tool access has expired.
 * Displays how many days ago access expired so the user knows
 * exactly where they stand before contacting their advisor.
 * If they still have course access, they can continue to /course.
 */

import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BookOpen, Clock, Mail } from "lucide-react"
import { useEntitlement } from "@/hooks/useEntitlement"

function daysOverdue(isoDate: string): number {
  const endsAt = new Date(isoDate)
  const now    = new Date()
  const ms     = now.getTime() - endsAt.getTime()
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

function formatOverdueLabel(isoDate: string): string {
  const days = daysOverdue(isoDate)
  if (days === 1) return "Venció hace 1 día"
  if (days < 7)   return `Venció hace ${days} días`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return "Venció hace 1 semana"
  if (days < 30)  return `Venció hace ${weeks} semanas`
  const months = Math.floor(days / 30)
  if (months === 1) return "Venció hace 1 mes"
  return `Venció hace ${months} meses`
}

export default function AccessExpired() {
  const { data } = useEntitlement()
  const hasCourse  = data?.courseAccess   ?? false
  const endsAt     = data?.toolAccessEndsAt ?? null
  const isExpired  = data?.toolAccessStatus === "expired" ||
                     (endsAt !== null && new Date(endsAt) < new Date())
  const overdueLabel = endsAt && isExpired ? formatOverdueLabel(endsAt) : null

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-lg border-amber-200 dark:border-amber-800/40">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-5 text-center">

          {/* Icon */}
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>

          {/* Title + overdue badge */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold font-display">
              Acceso a la herramienta vencido
            </h2>

            {overdueLabel && (
              <div className="inline-flex items-center gap-1.5 rounded-full
                              bg-amber-100 dark:bg-amber-900/40
                              text-amber-700 dark:text-amber-300
                              text-sm font-semibold px-3 py-1">
                <Clock className="w-3.5 h-3.5" />
                {overdueLabel}
              </div>
            )}

            <p className="text-muted-foreground text-sm leading-relaxed">
              Tu período de acceso a la herramienta ha terminado.
              {hasCourse && (
                <> Puedes seguir accediendo al{" "}
                  <strong>curso de implementación</strong> sin restricciones.
                </>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            {hasCourse && (
              <Link href="/course" className="flex-1">
                <Button variant="default" className="w-full gap-2">
                  <BookOpen className="w-4 h-4" /> Ir al curso
                </Button>
              </Link>
            )}
            <a href="mailto:info@reelsona.com" className="flex-1">
              <Button variant="outline" className="w-full gap-2">
                <Mail className="w-4 h-4" /> Contactar asesor
              </Button>
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            Para renovar tu acceso, escríbenos a{" "}
            <a
              href="mailto:info@reelsona.com"
              className="underline underline-offset-2"
            >
              info@reelsona.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
