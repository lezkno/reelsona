import { useEffect, useState } from "react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

type Status = "loading" | "success" | "error"

export default function VerifyEmail() {
  const [status, setStatus] = useState<Status>("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get("token")

    if (!token) {
      setStatus("error")
      setMessage("El enlace no es válido. No se encontró el token de verificación.")
      return
    }

    fetch(`${BASE}/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setStatus("success")
        } else {
          setStatus("error")
          setMessage(data.error ?? "El enlace no es válido o ya expiró.")
        }
      })
      .catch(() => {
        setStatus("error")
        setMessage("Error de red. Intenta de nuevo más tarde.")
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl text-center">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          {status === "loading" && (
            <>
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
              <p className="text-muted-foreground text-sm">Verificando tu correo…</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold font-display">¡Correo confirmado!</h2>
                <p className="text-muted-foreground text-sm">
                  Tu cuenta está activa. Ya puedes iniciar sesión.
                </p>
              </div>
              <Link href="/login">
                <Button className="mt-2">Iniciar sesión →</Button>
              </Link>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold font-display">Enlace inválido</h2>
                <p className="text-muted-foreground text-sm">{message}</p>
              </div>
              <Link href="/register">
                <Button variant="outline" className="mt-2">Registrarse de nuevo</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
