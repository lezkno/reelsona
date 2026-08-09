/**
 * /access-expired
 *
 * Shown to authenticated users whose tool access has expired.
 * If they still have course access, they can continue to /course.
 */

import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BookOpen, Clock, Mail } from "lucide-react"
import { useEntitlement } from "@/hooks/useEntitlement"

export default function AccessExpired() {
  const { data } = useEntitlement()
  const hasCourse = data?.courseAccess ?? false

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-lg border-amber-200 dark:border-amber-800/40">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-5 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold font-display">Acceso a la herramienta vencido</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Tu período de acceso a la herramienta ha terminado.
              {hasCourse && (
                <> Puedes seguir accediendo al <strong>curso de implementación</strong> sin restricciones.</>
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full">
            {hasCourse && (
              <Link href="/course" className="flex-1">
                <Button variant="default" className="w-full gap-2">
                  <BookOpen className="w-4 h-4" /> Ir al curso
                </Button>
              </Link>
            )}
            <a
              href="mailto:info@reelsona.com"
              className="flex-1"
            >
              <Button variant="outline" className="w-full gap-2">
                <Mail className="w-4 h-4" /> Contactar asesor
              </Button>
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            Para renovar tu acceso, escríbenos a{" "}
            <a href="mailto:info@reelsona.com" className="underline underline-offset-2">
              info@reelsona.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
