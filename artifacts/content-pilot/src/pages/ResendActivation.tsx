/**
 * /resend-activation
 *
 * Public page for students who didn't receive or couldn't use their activation
 * link. They enter their email and a new link is sent — the response never
 * reveals whether the email exists in the system.
 */

import { useState } from "react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { CheckCircle2, Loader2, Mail } from "lucide-react"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

async function requestNewLink(email: string): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/resend-activation`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).error ?? "Error al enviar el email")
  }
}

export default function ResendActivation() {
  const [email, setEmail]   = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await requestNewLink(email.trim().toLowerCase())
      setDone(true)
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo / brand */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Reelsona</h1>
          <p className="text-sm text-muted-foreground">Reenvío de enlace de activación</p>
        </div>

        <Card>
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              No recibí mi enlace
            </CardTitle>
            <CardDescription>
              Ingresa tu email y te enviaremos un nuevo enlace de activación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">¡Listo!</p>
                  <p className="text-sm text-muted-foreground">
                    Si tu email tiene una cuenta pendiente de activación, recibirás un nuevo enlace en
                    los próximos minutos. Revisa también la carpeta de spam.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setDone(false); setEmail("") }}
                  className="mt-2"
                >
                  Intentar con otro email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ra-email">Email</Label>
                  <Input
                    id="ra-email"
                    type="email"
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    disabled={loading}
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading || !email}>
                  {loading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando…</>
                    : "Reenviar enlace de activación"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link href="/" className="text-primary underline-offset-4 hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
