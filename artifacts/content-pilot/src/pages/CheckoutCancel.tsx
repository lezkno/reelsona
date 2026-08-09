/**
 * /checkout/cancel
 *
 * Stripe redirects here when the user closes or cancels the checkout.
 */

import { XCircle } from "lucide-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function CheckoutCancel() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl text-center">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <XCircle className="w-8 h-8 text-muted-foreground" />
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold font-display">Pago cancelado</h1>
            <p className="text-muted-foreground text-sm">
              No se realizó ningún cargo. Puedes intentarlo de nuevo cuando quieras.
            </p>
          </div>

          <Link href="/checkout">
            <Button className="mt-2">Volver al checkout</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
