/**
 * /checkout/success
 *
 * Stripe redirects here after a successful payment.
 * We do NOT grant access here — the webhook is the source of truth.
 */

import { CheckCircle2, Mail, Clock } from "lucide-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function CheckoutSuccess() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl text-center">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-5">
          {/* Icon */}
          <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          </div>

          {/* Title */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold font-display">¡Pago recibido!</h1>
            <p className="text-muted-foreground text-sm">
              Tu compra fue procesada correctamente.
            </p>
          </div>

          {/* What happens next */}
          <div className="w-full rounded-xl border bg-muted/40 p-4 text-left space-y-3">
            <p className="text-sm font-semibold">¿Qué sigue?</p>
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                En unos minutos recibirás un email con un enlace para <strong>crear tu contraseña</strong> y activar tu cuenta.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                Si no ves el email en 10 minutos, revisa tu carpeta de spam o escríbenos.
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            No cierres esta página ni hagas otro pago — el acceso se activa automáticamente.
          </p>

          <Link href="/login">
            <Button variant="outline" size="sm">Ya tengo mi contraseña — iniciar sesión</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
