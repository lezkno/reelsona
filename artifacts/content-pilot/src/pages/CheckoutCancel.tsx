/**
 * /checkout/cancel
 * Stripe redirects here when the user closes or cancels the hosted checkout.
 */
import { Link } from "wouter";
import { XCircle, ArrowLeft } from "lucide-react";

export default function CheckoutCancel() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex flex-col items-center gap-5 max-w-sm">
        <XCircle className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Pago cancelado</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          No se realizó ningún cargo. Podés volver cuando quieras y elegir el
          plan que mejor se adapte a tu ritmo.
        </p>
        <Link
          href="/landing"
          className="inline-flex items-center gap-2 mt-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Ver planes
        </Link>
      </div>
    </div>
  );
}
