import { useState } from "react"
import { Link, useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, CheckCircle2 } from "lucide-react"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

async function apiRegister(body: {
  fullName: string
  email: string
  password: string
}) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Error al registrarse")
  return data
}

export default function Register() {
  const [, navigate] = useLocation()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError("Las contraseñas no coinciden")
      return
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres")
      return
    }

    setPending(true)
    try {
      await apiRegister({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password })
      setDone(true)
    } catch (err: any) {
      setError(err.message ?? "Error al registrarse")
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm shadow-xl text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold font-display">¡Revisa tu correo!</h2>
              <p className="text-muted-foreground text-sm">
                Te enviamos un enlace de confirmación a <strong>{email}</strong>.
              </p>
              <p className="text-muted-foreground text-sm">
                Haz clic en el enlace para activar tu cuenta. El enlace expira en 24 horas.
              </p>
            </div>
            <Link href="/login">
              <Button variant="outline" size="sm" className="mt-2">Ir al inicio de sesión</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center mx-auto mb-3">
            <img src={`${BASE}/logo.png`} alt="Reelsona" className="w-16 h-16 object-contain" />
          </div>
          <CardTitle className="text-2xl font-display">Crear cuenta</CardTitle>
          <CardDescription>Regístrate para acceder a Reelsona</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Ana García"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="ana@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar contraseña</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={pending || !fullName || !email || !password || !confirm}
            >
              {pending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creando cuenta…</>
              ) : (
                "Crear cuenta"
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground pt-1">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Iniciar sesión
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
