import { useState, useEffect } from "react"
import { useLocation, Link } from "wouter"
import { Loader2, Lock, CheckCircle2, XCircle } from "lucide-react"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

export default function ResetPassword() {
  const [, navigate] = useLocation()
  const token = new URLSearchParams(window.location.search).get("token") ?? ""

  const [checking, setChecking]   = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [password, setPassword]   = useState("")
  const [confirm, setConfirm]     = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Validate token on mount
  useEffect(() => {
    if (!token) { setChecking(false); return }
    fetch(`${BASE}/api/auth/reset-password/check?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { setTokenValid(!!d.ok); setChecking(false) })
      .catch(() => { setTokenValid(false); setChecking(false) })
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return }
    if (password !== confirm)  { setError("Las contraseñas no coinciden"); return }
    setError(null)
    setSubmitting(true)
    try {
      const r = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? "Error al restablecer la contraseña"); return }
      setDone(true)
      setTimeout(() => navigate("/"), 3000)
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "#161616", border: "1px solid #2a2a2a", borderRadius: 10,
    padding: "0.65rem 0.9rem", color: "#f0f0f0", fontSize: "0.9rem",
    outline: "none", width: "100%", boxSizing: "border-box",
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: "#080808" }}>
      <div aria-hidden style={{ position:"fixed", top:"10%", left:"50%", transform:"translateX(-50%)", width:600, height:300, background:"radial-gradient(ellipse, rgba(79,110,247,0.12) 0%, transparent 70%)", pointerEvents:"none" }} />

      <div className="w-full relative" style={{ maxWidth: 400 }}>
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img src={`${BASE}/logo.png`} alt="Reelsona" style={{ width:52, height:52, objectFit:"contain" }} />
          <h1 className="font-bold" style={{ fontSize:"1.5rem", fontFamily:"var(--font-display,'Outfit',sans-serif)", background:"linear-gradient(135deg,#ffffff 40%,#9B5CF6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
            Reelsona
          </h1>
        </div>

        <div className="rounded-2xl p-7" style={{ backgroundColor:"#0f0f0f", border:"1px solid #1e1e1e", boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}>

          {checking && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 size={28} className="animate-spin" style={{ color:"#6366f1" }} />
              <p style={{ color:"#888", fontSize:"0.9rem" }}>Verificando enlace…</p>
            </div>
          )}

          {!checking && !tokenValid && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle size={40} style={{ color:"#f87171" }} />
              <p className="font-semibold" style={{ color:"#f0f0f0" }}>Enlace inválido o expirado</p>
              <p style={{ color:"#777", fontSize:"0.85rem" }}>Este enlace ya fue usado o expiró (válido 1 hora).</p>
              <Link href="/" style={{ marginTop:8, color:"#6366f1", fontSize:"0.88rem" }}>← Volver al inicio</Link>
            </div>
          )}

          {!checking && tokenValid && !done && (
            <>
              <h2 className="font-semibold mb-5" style={{ color:"#f0f0f0", fontSize:"1.1rem" }}>Nueva contraseña</h2>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label style={{ color:"#aaa", fontSize:"0.8rem", fontWeight:500 }}>Nueva contraseña</label>
                  <input type="password" placeholder="Mínimo 8 caracteres" value={password} onChange={e => setPassword(e.target.value)} autoFocus style={inputStyle}
                    onFocus={e => (e.target.style.borderColor="#4F6EF7")} onBlur={e => (e.target.style.borderColor="#2a2a2a")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label style={{ color:"#aaa", fontSize:"0.8rem", fontWeight:500 }}>Confirmar contraseña</label>
                  <input type="password" placeholder="Repite la contraseña" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle}
                    onFocus={e => (e.target.style.borderColor="#4F6EF7")} onBlur={e => (e.target.style.borderColor="#2a2a2a")} />
                </div>
                {error && (
                  <p className="text-center rounded-lg py-2.5 px-3" style={{ color:"#f87171", fontSize:"0.82rem", background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.18)" }}>
                    {error}
                  </p>
                )}
                <button type="submit" disabled={submitting || !password || !confirm}
                  className="flex items-center justify-center gap-2 rounded-xl font-bold transition-opacity"
                  style={{ background: submitting||!password||!confirm ? "#1e1e1e" : "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: submitting||!password||!confirm ? "#444" : "#fff", padding:"0.75rem", fontSize:"0.95rem", border:"none", cursor: submitting||!password||!confirm ? "not-allowed" : "pointer" }}>
                  {submitting ? <><Loader2 size={16} className="animate-spin" /> Guardando…</> : <><Lock size={15} /> Guardar contraseña</>}
                </button>
              </form>
            </>
          )}

          {done && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 size={40} style={{ color:"#4ade80" }} />
              <p className="font-semibold" style={{ color:"#f0f0f0" }}>¡Contraseña actualizada!</p>
              <p style={{ color:"#777", fontSize:"0.85rem" }}>Redirigiendo al inicio de sesión…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
