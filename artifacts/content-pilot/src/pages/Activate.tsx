/**
 * /activate?token=...
 *
 * Post-purchase activation page. The user arrives here from the email sent by
 * POST /api/admin/provision. They see their name/email and set a password.
 * On success the session is created and they are sent to /course.
 */

import { useEffect, useState } from "react"
import { Link, useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, XCircle, Loader2, KeyRound } from "lucide-react"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

type CheckState =
  | { status: "loading" }
  | { status: "valid"; email: string; fullName: string }
  | { status: "invalid"; message: string }

async function checkToken(token: string): Promise<{ email: string; fullName: string }> {
  const res  = await fetch(`${BASE}/api/auth/activate/check?token=${encodeURIComponent(token)}`, {
    credentials: "include",
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Token inválido")
  return data
}

async function activateAccount(token: string, password: string): Promise<void> {
  const res  = await fetch(`${BASE}/api/auth/activate`, {
    method:      "POST",
    headers:     { "Content-Type": "application/json" },
    credentials: "include",
    body:        JSON.stringify({ token, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Error al activar cuenta")
}

export default function Activate() {
  const [, navigate]    = useLocation()
  const [check, setCheck]   = useState<CheckState>({ status: "loading" })
  const [password, setPassword]   = useState("")
  const [confirm, setConfirm]     = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const token = new URLSearchParams(window.location.search).get("token") ?? ""

  useEffect(() => {
    if (!token) {
      setCheck({ status: "invalid", message: "No se encontró el token de activación en el enlace." })
      return
    }
    checkToken(token)
      .then(({ email, fullName }) => setCheck({ status: "valid", email, fullName }))
      .catch((err: any) => setCheck({ status: "invalid", message: err.message }))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (password !== confirm) { setFormError("Las contraseñas no coinciden"); return }
    if (password.length < 8)  { setFormError("Mínimo 8 caracteres"); return }

    setSubmitting(true)
    try {
      await activateAccount(token, password)
      setDone(true)
      // Give the session a moment to settle, then go to course
      setTimeout(() => navigate("/course"), 1500)
    } catch (err: any) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (check.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // ── Invalid token ────────────────────────────────────────────────────────────
  if (check.status === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm shadow-xl text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold font-display">Enlace inválido</h2>
              <p className="text-muted-foreground text-sm">{check.message}</p>
              <p className="text-muted-foreground text-sm">
                Solicita un nuevo enlace de activación a tu asesor.
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

  // ── Success ──────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm shadow-xl text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold font-display">¡Cuenta activada!</h2>
              <p className="text-muted-foreground text-sm">Iniciando tu curso…</p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Set password form ────────────────────────────────────────────────────────
  const { email, fullName } = check

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center mx-auto mb-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <KeyRound className="w-7 h-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-display">Activa tu cuenta</CardTitle>
          <CardDescription>
            Hola <strong>{fullName}</strong>, elige una contraseña para acceder a Reelsona.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email — display only, not editable */}
            <div className="space-y-1.5">
              <Label>Correo</Label>
              <div className="px-3 py-2 rounded-md border bg-muted text-sm text-muted-foreground">
                {email}
              </div>
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
                autoFocus
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

            {formError && (
              <p className="text-sm text-destructive text-center">{formError}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !password || !confirm}
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Activando…</>
                : "Activar cuenta y entrar al curso"
              }
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
