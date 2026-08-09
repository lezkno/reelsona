/**
 * /checkout
 *
 * Public page. Collects name + email and starts a Stripe Checkout session.
 * The user is redirected to Stripe; no account is created until the webhook fires.
 */

import { useState } from "react"
import { Zap, Loader2, ShieldCheck, BookOpen, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

export default function Checkout() {
  const [form, setForm]     = useState({ email: "", fullName: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res  = await fetch(`${BASE}/api/checkout/create-session`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: form.email.trim(), fullName: form.fullName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "No se pudo iniciar el pago. Intenta de nuevo.")
        return
      }
      // Redirect to Stripe Checkout
      window.location.href = data.url
    } catch {
      setError("No se pudo conectar con el servidor. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-bold font-display">Reelsona</h1>
          <p className="text-muted-foreground">
            Automatiza tu contenido de Instagram con avatar IA
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { icon: BookOpen,    label: "Programa completo" },
            { icon: Wrench,      label: "Herramienta IA"    },
            { icon: ShieldCheck, label: "Acceso inmediato"  },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-xl border bg-muted/40 p-3 space-y-1">
              <Icon className="w-5 h-5 mx-auto text-primary" />
              <p className="text-xs font-medium">{label}</p>
            </div>
          ))}
        </div>

        {/* Form */}
        <Card className="shadow-xl">
          <CardHeader className="pb-2">
            <CardTitle>Inscríbete ahora</CardTitle>
            <CardDescription>Pago único · Acceso inmediato al curso y la herramienta</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input
                  id="fullName"
                  placeholder="Tu nombre"
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                  autoComplete="name"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@email.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  autoComplete="email"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive text-center rounded-md bg-destructive/10 py-2 px-3">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading || !form.email}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirigiendo a Stripe…</>
                  : "Comprar acceso →"}
              </Button>

              <p className="text-xs text-center text-muted-foreground leading-relaxed">
                Pago seguro procesado por Stripe.<br />
                Recibirás un email para crear tu contraseña y activar tu cuenta una vez confirmado el pago.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
